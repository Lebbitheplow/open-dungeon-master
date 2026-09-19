// Renders the object set (scripts/prop-set.mjs) and the decal set
// (scripts/decal-set.mjs) through the local ComfyUI and writes the cut-outs
// the map renderer composes with.
//
// Every asset is rendered on Flux schnell on a plain white backdrop, matted by
// BEN2, then cut out here with ImageMagick: the matte is thresholded, its
// holes filled by flood, eroded a touch so no white halo survives, and the
// raw render is trimmed to the object plus a small margin. The 1024px raw
// render and the matte are kept under data/prop-src (which git ignores) so a
// cut-out can be redone without paying for the GPU again; the shipped alpha
// WebP goes to public/assets/props.
//
//   node scripts/generate-props.mjs --dry-run
//   node scripts/generate-props.mjs --only barrel,tree-oak,shore-foam
//   node scripts/generate-props.mjs --only objects        (or edges, scatters)
//   node scripts/generate-props.mjs --reencode
//   node scripts/generate-props.mjs --sheet                (contact sheets only)
//   node scripts/generate-props.mjs

import { execFileSync } from "node:child_process";
import { mkdirSync, existsSync, writeFileSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { OBJECT_LIST } from "./prop-set.mjs";
import { DECAL_LIST } from "./decal-set.mjs";
import { renderCutout, seedFor, comfyReachable, requireNodes, DEFAULT_COMFY_URL } from "./lib/comfy-render.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const SRC_DIR = path.join(ROOT, "data", "prop-src");
const OUT_DIR = path.join(ROOT, "public", "assets", "props");
const REVIEW = path.join(ROOT, "scripts", "prop-review.json");

// Shipped sizes. An object spans at most about two squares, and a square is
// 64px at the board's closest zoom, so 256px keeps a big object crisp and a
// small one small. Edge strips ship wide and short; scatter decals are small
// things and ship small.
const SHIP = { object: 256, edge: { width: 512, height: 128 }, scatter: 160 };
const WEBP_QUALITY = 84;
// Objects may be a little livelier than the ground they sit on, but not so
// much that a berry bush shouts over a whole map.
const SATURATION_CEILING = 0.55;

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const force = args.includes("--force");
const reencode = args.includes("--reencode");
const sheetOnly = args.includes("--sheet");
const saltArg = args.find((a) => a.startsWith("--seed-salt"));
const seedSalt = saltArg ? (saltArg.includes("=") ? saltArg.split("=")[1] : args[args.indexOf(saltArg) + 1]) : "";
const onlyArg = args.find((a) => a.startsWith("--only"));
const only = onlyArg ? (onlyArg.includes("=") ? onlyArg.split("=")[1] : args[args.indexOf(onlyArg) + 1]) : null;

// A rejected asset is re-rolled with the salt recorded here, so a review's
// verdicts are reproducible: the same salt always gives the same re-roll.
const review = existsSync(REVIEW) ? JSON.parse(readFileSync(REVIEW, "utf8")) : { rejected: {} };

const ALL = [
  ...OBJECT_LIST.map((o) => ({ ...o, shape: "object", width: 1024, height: 1024 })),
  ...DECAL_LIST,
];
const terms = only ? only.split(",").map((t) => t.trim()).filter(Boolean) : [];
const GROUP_TERMS = { objects: "object", edges: "edge", scatters: "scatter" };
const selected = terms.length
  ? ALL.filter((a) => terms.some((term) => a.id.includes(term) || GROUP_TERMS[term] === a.shape || (a.sets || []).includes(term)))
  : ALL;

if (!selected.length) {
  console.error(`--only ${only} matched nothing. Groups: objects, edges, scatters; or an object set, or part of an id.`);
  process.exit(1);
}

function seedOf(asset) {
  return seedFor(asset.id + seedSalt + (review.rejected[asset.id] ?? ""));
}

if (dryRun) {
  for (const asset of selected) {
    console.log(`\n# ${asset.shape}/${asset.id}  seed ${seedOf(asset)}  ${asset.width}x${asset.height}`);
    console.log(`  + ${asset.prompt}`);
  }
  console.log(`\n${selected.length} asset(s). Nothing rendered.`);
  process.exit(0);
}

function shippedPath(asset) {
  return path.join(OUT_DIR, `${asset.shape}s`, `${asset.id}.webp`);
}

function saturationScale(sourcePath) {
  const measured = Number(
    execFileSync("magick", [sourcePath, "-alpha", "off", "-colorspace", "HSL", "-channel", "G", "-separate", "-format", "%[fx:mean]", "info:"]).toString(),
  );
  if (!Number.isFinite(measured) || measured <= SATURATION_CEILING) {
    return 100;
  }
  return Math.round((SATURATION_CEILING / measured) * 100);
}

// The cut-out. BEN2's matte is soft and occasionally leaves a hole in the
// middle of a solid object (a bright plate on a table). Flood-filling from
// the border finds every enclosed region; the small ones are filled and the
// large ones (the middle of a rope coil, the gaps in a wheel, the inside of a
// frame) are kept open, since those are real. A short erosion takes the
// white fringe with it. `-compose Over` is reset after CopyAlpha, or the
// later border wipes the colour.
function cutOut(rawPath, maskPath, cutPath, shape) {
  const bin = `${cutPath}.bin.png`, solid = `${cutPath}.solid.png`, holes = `${cutPath}.holes.png`, alpha = `${cutPath}.alpha.png`;
  execFileSync("magick", [maskPath, "-colorspace", "gray", "-threshold", "45%", bin]);
  execFileSync("magick", [
    bin, "-bordercolor", "black", "-border", "2",
    "-fill", "red", "-draw", "color 0,0 floodfill", "-fill", "white", "+opaque", "red", "-fill", "black", "-opaque", "red",
    "-shave", "2x2", solid,
  ]);
  // holes = solid minus the matte; opening removes the small ones, so what is
  // left is the large holes to punch back out.
  execFileSync("magick", [solid, bin, "-compose", "Minus_Src", "-composite", "-morphology", "Open", "Disk:9", holes]);
  execFileSync("magick", [solid, holes, "-compose", "Minus_Src", "-composite", "-morphology", "Erode", "Disk:3", solid]);
  execFileSync("magick", [maskPath, "-colorspace", "gray", solid, "-compose", "Lighten", "-composite", "-morphology", "Erode", "Disk:1.5", alpha]);
  const margin = shape === "edge" ? "0x8" : "12";
  execFileSync("magick", [
    rawPath, alpha, "-alpha", "off", "-compose", "CopyAlpha", "-composite", "-compose", "Over",
    ...(shape === "edge" ? [] : ["-trim", "+repage"]),
    "-bordercolor", "none", "-border", margin, cutPath,
  ]);
  for (const tmp of [bin, solid, holes, alpha]) {
    execFileSync("rm", ["-f", tmp]);
  }
}

function encode(cutPath, target, shape) {
  const saturation = saturationScale(cutPath);
  const resize = shape === "edge" ? `${SHIP.edge.width}x${SHIP.edge.height}!` : shape === "scatter" ? `${SHIP.scatter}x${SHIP.scatter}>` : `${SHIP.object}x${SHIP.object}>`;
  execFileSync("magick", [
    cutPath,
    "-modulate", `100,${saturation},100`,
    "-resize", resize,
    "-strip",
    "-quality", String(WEBP_QUALITY),
    "-define", "webp:method=6",
    "-define", "webp:alpha-quality=90",
    "-define", "webp:exact=1",
    target,
  ]);
}

function contactSheet(shape) {
  const dir = path.join(OUT_DIR, `${shape}s`);
  if (!existsSync(dir)) {
    return;
  }
  const files = ALL.filter((a) => a.shape === shape && existsSync(shippedPath(a))).map((a) => shippedPath(a));
  if (!files.length) {
    return;
  }
  const geometry = shape === "edge" ? "512x128+6+10" : "150x150+6+6";
  const out = path.join(SRC_DIR, `contact-${shape}s.png`);
  execFileSync("magick", [
    "montage", ...files, "-tile", shape === "edge" ? "2x" : "8x", "-geometry", geometry,
    "-background", "#3a3a3a", "-fill", "#ddd", "-pointsize", "12", "-label", "%t", out,
  ]);
  console.log(`contact sheet ${out}`);
}

if (sheetOnly) {
  for (const shape of ["object", "edge", "scatter"]) contactSheet(shape);
  process.exit(0);
}

if (!reencode) {
  if (!(await comfyReachable())) {
    console.error(`No ComfyUI at ${DEFAULT_COMFY_URL}. Start it, or pass --reencode to rebuild the WebP set from kept originals.`);
    process.exit(1);
  }
  await requireNodes(["UNETLoader", "DualCLIPLoader", "easy imageRemBg"]);
}

mkdirSync(SRC_DIR, { recursive: true });
let rendered = 0;
let reused = 0;
const failures = [];
const startedAt = Date.now();

for (const [index, asset] of selected.entries()) {
  const srcDir = path.join(SRC_DIR, `${asset.shape}s`);
  mkdirSync(srcDir, { recursive: true });
  mkdirSync(path.dirname(shippedPath(asset)), { recursive: true });
  const raw = path.join(srcDir, `${asset.id}.png`);
  const mask = path.join(srcDir, `${asset.id}.mask.png`);
  const cut = path.join(srcDir, `${asset.id}.cut.png`);
  const label = `[${index + 1}/${selected.length}] ${asset.shape}/${asset.id}`;
  try {
    const salt = review.rejected[asset.id] ?? "";
    const saltFile = `${raw}.salt`;
    const saltMatches = (existsSync(saltFile) ? readFileSync(saltFile, "utf8") : "") === salt;
    if (existsSync(raw) && existsSync(mask) && (reencode || (!force && saltMatches))) {
      reused += 1;
    } else if (reencode) {
      console.log(`${label} no original to re-encode, skipped`);
      continue;
    } else {
      const out = await renderCutout({
        model: "flux",
        prompt: asset.prompt,
        width: asset.width,
        height: asset.height,
        seed: seedOf(asset),
        prefix: `odm-${asset.shape}`,
      });
      writeFileSync(raw, out.image);
      writeFileSync(mask, out.mask);
      writeFileSync(saltFile, salt);
      rendered += 1;
      const each = (Date.now() - startedAt) / 1000 / Math.max(1, rendered);
      const left = ((selected.length - index - 1) * each) / 60;
      console.log(`${label} rendered (${each.toFixed(0)}s each, ~${left.toFixed(0)} min left)`);
    }
    cutOut(raw, mask, cut, asset.shape);
    encode(cut, shippedPath(asset), asset.shape);
  } catch (error) {
    failures.push(`${asset.shape}/${asset.id}: ${error.message}`);
    console.error(`${label} FAILED ${error.message}`);
  }
}

// The manifest is what the renderer and the stamp picker read. A partial run
// merges into what is on disk rather than replacing it.
const manifestPath = path.join(OUT_DIR, "manifest.json");
const existing = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : { objects: [], decals: [] };
const known = new Map([...existing.objects, ...existing.decals].map((e) => [e.id, e]));
for (const asset of ALL) {
  const file = shippedPath(asset);
  if (!existsSync(file)) {
    known.delete(asset.id);
    continue;
  }
  const dims = execFileSync("magick", ["identify", "-format", "%w %h", file]).toString().trim().split(" ").map(Number);
  const entry = {
    id: asset.id,
    shape: asset.shape,
    src: `/assets/props/${asset.shape}s/${asset.id}.webp`,
    width: dims[0],
    height: dims[1],
    bytes: statSync(file).size,
    seed: seedOf(asset),
  };
  if (asset.shape === "object") {
    Object.assign(entry, { label: asset.label, sets: asset.sets, span: asset.span, kind: asset.kind, align: asset.align, hazard: asset.hazard });
  } else if (asset.shape === "edge") {
    Object.assign(entry, { family: asset.family });
  } else {
    Object.assign(entry, { on: asset.on, blend: asset.blend });
  }
  known.set(asset.id, entry);
}
const all = [...known.values()].sort((a, b) => a.shape.localeCompare(b.shape) || a.id.localeCompare(b.id));
const manifest = { objects: all.filter((e) => e.shape === "object"), decals: all.filter((e) => e.shape !== "object") };
mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

for (const shape of ["object", "edge", "scatter"]) contactSheet(shape);

const bytes = all.reduce((sum, e) => sum + e.bytes, 0);
console.log(
  `\n${manifest.objects.length} object(s) and ${manifest.decals.length} decal(s) in public/assets/props ` +
    `(${rendered} rendered, ${reused} from kept originals, ${(bytes / 1024 / 1024).toFixed(2)} MB total).`,
);
if (failures.length) {
  console.error(`\n${failures.length} failed:\n${failures.map((f) => `  ${f}`).join("\n")}`);
  process.exit(1);
}
