// Renders the icon set in scripts/icon-set.mjs through the local ComfyUI and
// writes the cut-outs the cards, sheets and pickers show.
//
// Every icon is rendered on Flux schnell on flat black, matted by BEN2, cut
// out with ImageMagick (the same flood fill and erosion the map objects use),
// trimmed square with a margin, and shipped as a 128px alpha WebP under
// public/assets/icons/<group>/. The 768px raw render and the matte are kept
// under data/icon-src (which git ignores).
//
//   node scripts/generate-icons.mjs --dry-run
//   node scripts/generate-icons.mjs --only spell            (a group: spell, item, feature, option, condition, action, feat, family, glyph)
//   node scripts/generate-icons.mjs --only fireball,cure-wounds
//   node scripts/generate-icons.mjs --reencode
//   node scripts/generate-icons.mjs --sheet
//   node scripts/generate-icons.mjs

import { execFileSync } from "node:child_process";
import { mkdirSync, existsSync, writeFileSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { buildIconList } from "./icon-set.mjs";
import { renderCutout, seedFor, comfyReachable, requireNodes, DEFAULT_COMFY_URL } from "./lib/comfy-render.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const SRC_DIR = path.join(ROOT, "data", "icon-src");
const OUT_DIR = path.join(ROOT, "public", "assets", "icons");
const REVIEW = path.join(ROOT, "scripts", "icon-review.json");

const RENDER_PX = 768;
const SHIP_PX = 128;
const WEBP_QUALITY = 84;
// Icons may glow, but a whole spell list must not shout.
const SATURATION_CEILING = 0.62;

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const force = args.includes("--force");
const reencode = args.includes("--reencode");
const sheetOnly = args.includes("--sheet");
const flag = (name, fallback) => {
  const arg = args.find((a) => a.startsWith(`--${name}`));
  if (!arg) return fallback;
  return arg.includes("=") ? arg.split("=")[1] : args[args.indexOf(arg) + 1];
};
const seedSalt = flag("seed-salt", "");
const only = flag("only", null);
const review = existsSync(REVIEW) ? JSON.parse(readFileSync(REVIEW, "utf8")) : { rejected: {} };

const ALL = await buildIconList();
const terms = only ? only.split(",").map((t) => t.trim()).filter(Boolean) : [];
const selected = terms.length ? ALL.filter((e) => terms.some((t) => e.group === t || e.id.includes(t) || e.key.toLowerCase().includes(t.toLowerCase()))) : ALL;
if (!selected.length) {
  console.error(`--only ${only} matched nothing`);
  process.exit(1);
}
const seedOf = (e) => seedFor(e.id + seedSalt + (review.rejected[e.id] ?? ""));
const shippedPath = (e) => path.join(OUT_DIR, e.group, `${e.id.slice(e.group.length + 1)}.webp`);

if (dryRun) {
  for (const e of selected) console.log(`\n# ${e.group}/${e.id}  "${e.label}"  seed ${seedOf(e)}\n  + ${e.prompt}`);
  console.log(`\n${selected.length} icon(s) of ${ALL.length}. Nothing rendered.`);
  process.exit(0);
}

function saturationScale(sourcePath) {
  const measured = Number(execFileSync("magick", [sourcePath, "-alpha", "off", "-colorspace", "HSL", "-channel", "G", "-separate", "-format", "%[fx:mean]", "info:"]).toString());
  if (!Number.isFinite(measured) || measured <= SATURATION_CEILING) return 100;
  return Math.round((SATURATION_CEILING / measured) * 100);
}

// The cut-out, then a square canvas so every icon lands centred in its plate.
function cutOut(rawPath, maskPath, cutPath) {
  const bin = `${cutPath}.bin.png`, solid = `${cutPath}.solid.png`, holes = `${cutPath}.holes.png`, alpha = `${cutPath}.alpha.png`;
  execFileSync("magick", [maskPath, "-colorspace", "gray", "-threshold", "40%", bin]);
  execFileSync("magick", [bin, "-bordercolor", "black", "-border", "2", "-fill", "red", "-draw", "color 0,0 floodfill", "-fill", "white", "+opaque", "red", "-fill", "black", "-opaque", "red", "-shave", "2x2", solid]);
  // Small holes are filled, large ones (the inside of a ring) are kept open.
  execFileSync("magick", [solid, bin, "-compose", "Minus_Src", "-composite", "-morphology", "Open", "Disk:7", holes]);
  execFileSync("magick", [solid, holes, "-compose", "Minus_Src", "-composite", "-morphology", "Erode", "Disk:2", solid]);
  execFileSync("magick", [maskPath, "-colorspace", "gray", solid, "-compose", "Lighten", "-composite", alpha]);
  execFileSync("magick", [
    rawPath, alpha, "-alpha", "off", "-compose", "CopyAlpha", "-composite", "-compose", "Over",
    "-trim", "+repage", "-bordercolor", "none", "-border", "24",
    "-gravity", "center", "-background", "none", "-extent", "%[fx:max(w,h)]x%[fx:max(w,h)]", cutPath,
  ]);
  for (const tmp of [bin, solid, holes, alpha]) execFileSync("rm", ["-f", tmp]);
}

function encode(cutPath, target) {
  execFileSync("magick", [
    cutPath, "-modulate", `100,${saturationScale(cutPath)},100`, "-resize", `${SHIP_PX}x${SHIP_PX}`, "-strip",
    "-quality", String(WEBP_QUALITY), "-define", "webp:method=6", "-define", "webp:alpha-quality=90", "-define", "webp:exact=1", target,
  ]);
}

function contactSheets() {
  for (const group of [...new Set(ALL.map((e) => e.group))]) {
    const files = ALL.filter((e) => e.group === group && existsSync(shippedPath(e))).map(shippedPath);
    if (!files.length) continue;
    const out = path.join(SRC_DIR, `contact-${group}.png`);
    execFileSync("magick", ["montage", ...files, "-tile", "12x", "-geometry", "96x96+4+4", "-background", "#2a2a2a", "-fill", "#ddd", "-pointsize", "9", "-label", "%t", out]);
    console.log(`contact sheet ${out}`);
  }
}

if (sheetOnly) {
  contactSheets();
  process.exit(0);
}
if (!reencode) {
  if (!(await comfyReachable())) {
    console.error(`No ComfyUI at ${DEFAULT_COMFY_URL}. Start it, or pass --reencode to rebuild from kept originals.`);
    process.exit(1);
  }
  await requireNodes(["UNETLoader", "DualCLIPLoader", "easy imageRemBg"]);
}

mkdirSync(SRC_DIR, { recursive: true });
let rendered = 0, reused = 0;
const failures = [];
const startedAt = Date.now();
for (const [index, e] of selected.entries()) {
  const srcDir = path.join(SRC_DIR, e.group);
  mkdirSync(srcDir, { recursive: true });
  mkdirSync(path.dirname(shippedPath(e)), { recursive: true });
  const base = e.id.slice(e.group.length + 1);
  const raw = path.join(srcDir, `${base}.png`), mask = path.join(srcDir, `${base}.mask.png`), cut = path.join(srcDir, `${base}.cut.png`);
  const label = `[${index + 1}/${selected.length}] ${e.group}/${base}`;
  try {
    const salt = review.rejected[e.id] ?? "";
    const saltFile = `${raw}.salt`;
    const saltMatches = (existsSync(saltFile) ? readFileSync(saltFile, "utf8") : "") === salt;
    if (existsSync(raw) && existsSync(mask) && (reencode || (!force && saltMatches))) {
      reused += 1;
    } else if (reencode) {
      continue;
    } else {
      const out = await renderCutout({ model: "flux", prompt: e.prompt, width: RENDER_PX, height: RENDER_PX, seed: seedOf(e), prefix: `odm-icon-${e.group}` });
      writeFileSync(raw, out.image);
      writeFileSync(mask, out.mask);
      writeFileSync(saltFile, salt);
      rendered += 1;
      const each = (Date.now() - startedAt) / 1000 / rendered;
      console.log(`${label} rendered (${each.toFixed(0)}s each, ~${(((selected.length - index - 1) * each) / 60).toFixed(0)} min left)`);
    }
    cutOut(raw, mask, cut);
    encode(cut, shippedPath(e));
  } catch (error) {
    failures.push(`${e.id}: ${error.message}`);
    console.error(`${label} FAILED ${error.message}`);
  }
}

// The manifest: what iconFor() reads. Merged, so a partial run keeps the rest.
const manifestPath = path.join(OUT_DIR, "manifest.json");
const icons = [];
for (const e of ALL) {
  const file = shippedPath(e);
  if (!existsSync(file)) continue;
  icons.push({
    id: e.id, group: e.group, key: e.key, label: e.label,
    src: `/assets/icons/${e.group}/${e.id.slice(e.group.length + 1)}.webp`, bytes: statSync(file).size, seed: seedOf(e),
    ...(e.school ? { school: e.school, level: e.level } : {}), ...(e.kind ? { kind: e.kind } : {}), ...(e.classId ? { classId: e.classId } : {}),
  });
}
mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(manifestPath, `${JSON.stringify({ px: SHIP_PX, icons }, null, 2)}\n`);
contactSheets();
const bytes = icons.reduce((s, i) => s + i.bytes, 0);
console.log(`\n${icons.length} icon(s) of ${ALL.length} in public/assets/icons (${rendered} rendered, ${reused} from kept originals, ${(bytes / 1024 / 1024).toFixed(2)} MB).`);
if (failures.length) {
  console.error(`\n${failures.length} failed:\n${failures.map((f) => `  ${f}`).join("\n")}`);
  process.exit(1);
}
