// Renders the UI furniture in scripts/ui-set.mjs through the local ComfyUI
// and writes the parts the scroll, the book and the frames are built from.
//
// Cut-outs render on Flux on white, are matted by BEN2 and cut out with
// ImageMagick; flats render as they are, tiling ones through the SDXL base
// and Flux repaint the tile set uses so a parchment wraps. Originals are kept
// under data/ui-src (which git ignores); the shipped WebP goes to
// public/assets/ui/ at half the render size.
//
//   node scripts/generate-ui.mjs --dry-run
//   node scripts/generate-ui.mjs --only scroll,book        (a use, or part of an id)
//   node scripts/generate-ui.mjs --reencode
//   node scripts/generate-ui.mjs

import { execFileSync } from "node:child_process";
import { mkdirSync, existsSync, writeFileSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { UI_LIST } from "./ui-set.mjs";
import { renderImage, renderCutout, uploadImage, seedFor, comfyReachable, requireNodes, DEFAULT_COMFY_URL } from "./lib/comfy-render.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const SRC_DIR = path.join(ROOT, "data", "ui-src");
const OUT_DIR = path.join(ROOT, "public", "assets", "ui");
const REVIEW = path.join(ROOT, "scripts", "ui-review.json");
const WEBP_QUALITY = 86;

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const force = args.includes("--force");
const reencode = args.includes("--reencode");
const flag = (name, fallback) => {
  const arg = args.find((a) => a.startsWith(`--${name}`));
  if (!arg) return fallback;
  return arg.includes("=") ? arg.split("=")[1] : args[args.indexOf(arg) + 1];
};
const seedSalt = flag("seed-salt", "");
const only = flag("only", null);
const review = existsSync(REVIEW) ? JSON.parse(readFileSync(REVIEW, "utf8")) : { rejected: {} };
const terms = only ? only.split(",").map((t) => t.trim()).filter(Boolean) : [];
const selected = terms.length ? UI_LIST.filter((u) => terms.some((t) => u.use === t || u.id.includes(t))) : UI_LIST;
if (!selected.length) {
  console.error(`--only ${only} matched nothing`);
  process.exit(1);
}
const seedOf = (u) => seedFor(u.id + seedSalt + (review.rejected[u.id] ?? ""));
const shippedPath = (u) => path.join(OUT_DIR, `${u.id}.webp`);

if (dryRun) {
  for (const u of selected) console.log(`\n# ${u.use}/${u.id}  ${u.shape}${u.tiling ? " tiling" : ""}  ${u.width}x${u.height}  seed ${seedOf(u)}\n  + ${u.prompt}`);
  console.log(`\n${selected.length} part(s). Nothing rendered.`);
  process.exit(0);
}
if (!reencode) {
  if (!(await comfyReachable())) {
    console.error(`No ComfyUI at ${DEFAULT_COMFY_URL}.`);
    process.exit(1);
  }
  await requireNodes(["UNETLoader", "DualCLIPLoader", "easy imageRemBg", "SeamlessTile", "CircularVAEDecode"]);
}

function cutOut(rawPath, maskPath, cutPath) {
  const bin = `${cutPath}.bin.png`, solid = `${cutPath}.solid.png`, holes = `${cutPath}.holes.png`, alpha = `${cutPath}.alpha.png`;
  execFileSync("magick", [maskPath, "-colorspace", "gray", "-threshold", "45%", bin]);
  execFileSync("magick", [bin, "-bordercolor", "black", "-border", "2", "-fill", "red", "-draw", "color 0,0 floodfill", "-fill", "white", "+opaque", "red", "-fill", "black", "-opaque", "red", "-shave", "2x2", solid]);
  // Small holes are filled, large ones (the empty centre of a plate or a frame) are kept open.
  execFileSync("magick", [solid, bin, "-compose", "Minus_Src", "-composite", "-morphology", "Open", "Disk:9", holes]);
  execFileSync("magick", [solid, holes, "-compose", "Minus_Src", "-composite", "-morphology", "Erode", "Disk:2", solid]);
  execFileSync("magick", [maskPath, "-colorspace", "gray", solid, "-compose", "Lighten", "-composite", "-morphology", "Erode", "Disk:1", alpha]);
  execFileSync("magick", [rawPath, alpha, "-alpha", "off", "-compose", "CopyAlpha", "-composite", "-compose", "Over", "-trim", "+repage", "-bordercolor", "none", "-border", "8", cutPath]);
  for (const tmp of [bin, solid, holes, alpha]) execFileSync("rm", ["-f", tmp]);
}

function encode(src, target, u) {
  const w = Math.round(u.width / 2), h = Math.round(u.height / 2);
  execFileSync("magick", [
    src, "-resize", u.shape === "cutout" ? `${w}x${h}>` : `${w}x${h}!`, "-strip", "-quality", String(WEBP_QUALITY),
    "-define", "webp:method=6", ...(u.shape === "cutout" ? ["-define", "webp:alpha-quality=92", "-define", "webp:exact=1"] : []), target,
  ]);
}

mkdirSync(SRC_DIR, { recursive: true });
mkdirSync(OUT_DIR, { recursive: true });
let rendered = 0;
const failures = [];
for (const [index, u] of selected.entries()) {
  const raw = path.join(SRC_DIR, `${u.id}.png`), mask = path.join(SRC_DIR, `${u.id}.mask.png`), cut = path.join(SRC_DIR, `${u.id}.cut.png`);
  const label = `[${index + 1}/${selected.length}] ${u.use}/${u.id}`;
  try {
    const salt = review.rejected[u.id] ?? "";
    const saltFile = `${raw}.salt`;
    const saltMatches = (existsSync(saltFile) ? readFileSync(saltFile, "utf8") : "") === salt;
    const have = existsSync(raw) && (u.shape !== "cutout" || existsSync(mask));
    if (have && (reencode || (!force && saltMatches))) {
      // kept
    } else if (reencode) {
      continue;
    } else if (u.shape === "cutout") {
      const out = await renderCutout({ model: "flux", prompt: u.prompt, width: u.width, height: u.height, seed: seedOf(u), prefix: `odm-ui-${u.use}` });
      writeFileSync(raw, out.image);
      writeFileSync(mask, out.mask);
      rendered += 1;
    } else if (u.tiling) {
      // The tile set's recipe: SDXL wraps, Flux paints.
      const base = await renderImage({ model: "sdxl", prompt: u.prompt, negative: "text, letters, watermark, border, frame, vignette, photograph", width: u.width, height: u.height, seed: seedOf(u), steps: 26, cfg: 6.5, prefix: "odm-ui-base", tiling: true });
      const uploaded = await uploadImage(base, `odm-ui-base-${u.id}.png`);
      const png = await renderImage({ model: "flux", prompt: u.prompt, seed: seedOf(u), prefix: `odm-ui-${u.use}`, tiling: true, initImage: uploaded, denoise: 0.55 });
      writeFileSync(raw, png);
      rendered += 1;
    } else {
      const png = await renderImage({ model: "flux", prompt: u.prompt, width: u.width, height: u.height, seed: seedOf(u), prefix: `odm-ui-${u.use}` });
      writeFileSync(raw, png);
      rendered += 1;
    }
    if (rendered) writeFileSync(saltFile, salt);
    if (u.shape === "cutout") cutOut(raw, mask, cut);
    encode(u.shape === "cutout" ? cut : raw, shippedPath(u), u);
    console.log(`${label} done`);
  } catch (error) {
    failures.push(`${u.id}: ${error.message}`);
    console.error(`${label} FAILED ${error.message}`);
  }
}

const parts = UI_LIST.filter((u) => existsSync(shippedPath(u))).map((u) => {
  const [w, h] = execFileSync("magick", ["identify", "-format", "%w %h", shippedPath(u)]).toString().trim().split(" ").map(Number);
  return { id: u.id, use: u.use, shape: u.shape, tiling: u.tiling, src: `/assets/ui/${u.id}.webp`, width: w, height: h, bytes: statSync(shippedPath(u)).size, seed: seedOf(u) };
});
writeFileSync(path.join(OUT_DIR, "manifest.json"), `${JSON.stringify({ parts }, null, 2)}\n`);
const files = parts.map((p) => shippedPath(UI_LIST.find((u) => u.id === p.id)));
if (files.length) {
  execFileSync("magick", ["montage", ...files, "-tile", "6x", "-geometry", "200x200+6+6", "-background", "#6b6459", "-fill", "#eee", "-pointsize", "11", "-label", "%t", path.join(SRC_DIR, "contact-ui.png")]);
}
const bytes = parts.reduce((s, p) => s + p.bytes, 0);
console.log(`\n${parts.length} part(s) of ${UI_LIST.length} in public/assets/ui (${rendered} rendered, ${(bytes / 1024 / 1024).toFixed(2)} MB).`);
if (failures.length) {
  console.error(`\n${failures.length} failed:\n${failures.map((f) => `  ${f}`).join("\n")}`);
  process.exit(1);
}
