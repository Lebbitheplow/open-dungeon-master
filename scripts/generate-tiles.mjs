// Renders the map tile set in scripts/tile-set.mjs through the local ComfyUI
// and writes the swatches the editor paints with.
//
// Artefacts per tile variant. The 1024px renders are kept under data/tile-src
// (which git ignores) so a swatch can be re-cropped or re-encoded later
// without paying for the GPU again, and the shipped WebP goes to
// public/assets/tiles. That split is the same one scripts/generate-placeholders.mjs uses.
//
// Surfaces are generated already wrapping, by patching the SDXL model's
// convolutions to pad circularly (see `tiling` in scripts/lib/comfy-render.mjs).
// That wrapping render is the base; Flux then repaints it at partial denoise
// with the circular decode, so the paint is Flux's (gouache, muted, one
// palette) and the wrap is SDXL's. Measured 2026-09-16: column wrap 0.92 and
// row wrap 1.32 against the texture's own interior, where 1.0 is seamless;
// Flux alone wraps one axis and not the other, and Flux inpainting of the
// seam paints a frame. Fittings (a door, a stair) are one object in one square,
// do not wrap, and render on Flux directly.
//
// Every material ships in several variants (different seeds) so the renderer
// can break content repetition by picking one per texture-bomb layer.
//
//   node scripts/generate-tiles.mjs --dry-run
//   node scripts/generate-tiles.mjs --only floor
//   node scripts/generate-tiles.mjs --only cyberpunk     (a genre; "fantasy" is the base set)
//   node scripts/generate-tiles.mjs --variants 3           (default)
//   node scripts/generate-tiles.mjs --paint sdxl           (skip the Flux repaint)
//   node scripts/generate-tiles.mjs --reencode
//   node scripts/generate-tiles.mjs

import { execFileSync } from "node:child_process";
import { mkdirSync, existsSync, writeFileSync, readFileSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { TILES, CATEGORIES } from "./tile-set.mjs";
import { renderImage, seedFor, comfyReachable, requireNodes, uploadImage, DEFAULT_COMFY_URL } from "./lib/comfy-render.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const SRC_DIR = path.join(ROOT, "data", "tile-src");
const OUT_DIR = path.join(ROOT, "public", "assets", "tiles");

// 1024 is what both models are trained for, so it is what gets rendered.
const RENDER_PX = 1024;
// 256 is what ships: four times the 64px a zoomed-in board draws a square at,
// which leaves the swatch crisp under the zoom the VTT allows and still keeps
// a surface from looking obviously repeated the way a 128px one does.
const TILE_PX = 256;
const WEBP_QUALITY = 82;
// How much of the SDXL base Flux is allowed to repaint. 0.55 keeps the stones
// where the base put them (so the wrap survives) and still hands the paint
// over; 0.7 measured a row wrap of 1.57 and the stones start to drift.
const REPAINT_DENOISE = 0.55;

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const force = args.includes("--force");
const reencode = args.includes("--reencode");
const flag = (name, fallback) => {
  const arg = args.find((a) => a.startsWith(`--${name}`));
  if (!arg) return fallback;
  return arg.includes("=") ? arg.split("=")[1] : args[args.indexOf(arg) + 1];
};
// Re-rendering a tile that came back wrong reuses its id seed, which keeps the
// composition that was wrong in the first place: a tweaked prompt on a stubborn
// seed tends to return the same mistake. A salt rolls a different picture while
// keeping the result reproducible, so a reviewed tile can still be regenerated.
const seedSalt = flag("seed-salt", "");
// Tiles rejected on the contact sheets carry a salt in the review file; the
// salt marker beside the kept final makes the next plain run re-render them.
const REVIEW = path.join(ROOT, "scripts", "tile-review.json");
const review = existsSync(REVIEW) ? JSON.parse(readFileSync(REVIEW, "utf8")) : { rejected: {} };
const only = flag("only", null);
const paint = flag("paint", "flux");
const variantCount = Math.max(1, Math.min(6, Number(flag("variants", "3")) || 3));
if (!["flux", "sdxl"].includes(paint)) {
  console.error(`--paint must be flux or sdxl, not ${paint}`);
  process.exit(1);
}

// A comma separated list, so the pass that fixes a review's findings can name
// exactly the tiles that came back wrong instead of re-rendering a category.
const terms = only ? only.split(",").map((t) => t.trim()).filter(Boolean) : [];
const selected = terms.length
  ? TILES.filter((t) => terms.some((term) => t.category === term || t.genre === term || (term === "fantasy" && !t.genre) || t.id.includes(term) || t.themes.includes(term)))
  : TILES;

if (!selected.length) {
  console.error(`--only ${only} matched no tile. Categories: ${Object.keys(CATEGORIES).join(", ")}`);
  process.exit(1);
}

// Variant 1 keeps the tile's plain id so the set already reviewed keeps its
// seeds and its files; later variants carry a suffix.
function variantKey(tile, variant) {
  return variant === 1 ? tile.id : `${tile.id}-${variant}`;
}

if (dryRun) {
  for (const tile of selected) {
    console.log(`\n# ${tile.category}/${tile.id}  (${tile.label}, terrain "${tile.terrain}", ${tile.themes.join("/")})`);
    console.log(`  seamless: ${tile.seamless}  paint: ${paint}  variants: ${tile.seamless ? variantCount : 1}`);
    console.log(`  seeds: ${Array.from({ length: tile.seamless ? variantCount : 1 }, (_, i) => seedFor(variantKey(tile, i + 1) + seedSalt)).join(", ")}`);
    console.log(`  + base: ${tile.prompt}`);
    console.log(`  + paint: ${tile.fluxPrompt}`);
  }
  console.log(`\n${selected.length} tile(s). Nothing rendered.`);
  process.exit(0);
}

if (!reencode) {
  if (!(await comfyReachable())) {
    console.error(`No ComfyUI at ${DEFAULT_COMFY_URL}. Start it, or pass --reencode to rebuild the WebP set from kept originals.`);
    process.exit(1);
  }
  await requireNodes(["SeamlessTile", "CircularVAEDecode", ...(paint === "flux" ? ["UNETLoader", "DualCLIPLoader"] : [])]);
}

// Cover-fit to the square and re-encode. Unlike the placeholder set there is
// nothing to crop to, since every render is already square, but the sharpening
// matters: a 1024px surface shrunk to 256 goes soft, and a soft floor under a
// crisp token reads as a blurry map rather than a distant one.
// One art direction across hundreds of independently generated tiles needs a
// ceiling on saturation, or an acid pool and a lava fissure shout over every
// stone floor beside them and the set stops reading as one map. Only tiles
// above the ceiling are touched, and only by the amount that brings them to
// it, so a muted floor is left exactly as rendered.
//
// This is a per-pixel operation, so it cannot disturb a seam.
const SATURATION_CEILING = 0.46;

function saturationScale(sourcePath) {
  const measured = Number(
    execFileSync("magick", [
      sourcePath, "-colorspace", "HSL", "-channel", "G", "-separate",
      "-format", "%[fx:mean]", "info:",
    ]).toString(),
  );
  if (!Number.isFinite(measured) || measured <= SATURATION_CEILING) {
    return 100;
  }
  return Math.round((SATURATION_CEILING / measured) * 100);
}

function encodeTile(sourcePath, targetPath) {
  const saturation = saturationScale(sourcePath);
  execFileSync("magick", [
    sourcePath,
    "-modulate", `100,${saturation},100`,
    "-resize", `${TILE_PX}x${TILE_PX}!`,
    "-unsharp", "0x0.75+0.6+0.02",
    "-strip",
    "-quality", String(WEBP_QUALITY),
    "-define", "webp:method=6",
    "-define", "webp:sharp-yuv=1",
    targetPath,
  ]);
}

// Renders (or reuses) the SDXL base for a wrapping surface. A `.png` left by
// the earlier SDXL-only run is that base under its old name.
async function surfaceBase(tile, key, srcDir, seed, fresh) {
  const base = path.join(srcDir, `${key}.base.png`);
  const legacy = path.join(srcDir, `${key}.png`);
  if (existsSync(base) && !force && !fresh) return { path: base, rendered: false };
  if (existsSync(legacy) && !force && !fresh) return { path: legacy, rendered: false };
  const png = await renderImage({
    model: "sdxl",
    prompt: tile.prompt,
    negative: tile.negative,
    width: RENDER_PX,
    height: RENDER_PX,
    seed,
    steps: 26,
    cfg: 6.5,
    prefix: `odm-tile-base-${tile.category}`,
    tiling: true,
  });
  writeFileSync(base, png);
  return { path: base, rendered: true };
}

const manifest = [];
let rendered = 0;
let reused = 0;
const failures = [];
const startedAt = Date.now();

function progress(label, index, total) {
  const each = (Date.now() - startedAt) / 1000 / Math.max(1, rendered);
  const left = ((total - index - 1) * each) / 60;
  console.log(`${label} rendered (${each.toFixed(0)}s each, ~${left.toFixed(0)} min left)`);
}

const jobs = selected.flatMap((tile) =>
  Array.from({ length: tile.seamless ? variantCount : 1 }, (_, i) => ({ tile, variant: i + 1, key: variantKey(tile, i + 1) })),
);


for (const [index, { tile, variant, key }] of jobs.entries()) {
  const srcDir = path.join(SRC_DIR, tile.category);
  const outDir = path.join(OUT_DIR, tile.category);
  mkdirSync(srcDir, { recursive: true });
  mkdirSync(outDir, { recursive: true });

  // A review entry is a salt string, or an object: { salt, keepBase, denoise }.
  // A wrong picture re-rolls everything; a seam that only the repaint broke
  // keeps the wrapping base and repaints it more gently.
  const entry = review.rejected[tile.id] ?? "";
  const verdict = typeof entry === "string" ? { salt: entry } : entry;
  const salt = verdict.salt ?? "";
  const seed = seedFor(key + seedSalt + salt);
  const final = path.join(srcDir, paint === "flux" ? `${key}.flux.png` : `${key}.png`);
  const saltFile = `${final}.salt`;
  const saltMatches = (existsSync(saltFile) ? readFileSync(saltFile, "utf8") : "") === salt;
  const shipped = path.join(outDir, `${key}.webp`);
  const label = `[${index + 1}/${jobs.length}] ${tile.category}/${key}`;

  try {
    if (existsSync(final) && (reencode || (!force && saltMatches))) {
      reused += 1;
    } else if (reencode) {
      console.log(`${label} no original to re-encode, skipped`);
      continue;
    } else if (tile.seamless) {
      const base = await surfaceBase(tile, key, srcDir, seed, !saltMatches && !verdict.keepBase);
      if (base.rendered) rendered += 1;
      if (paint === "flux") {
        const uploaded = await uploadImage(readFileSync(base.path), `odm-tile-base-${key}.png`);
        const png = await renderImage({
          model: "flux",
          prompt: tile.fluxPrompt,
          seed,
          prefix: `odm-tile-${tile.category}`,
          tiling: true,
          initImage: uploaded,
          denoise: verdict.denoise ?? REPAINT_DENOISE,
        });
        writeFileSync(final, png);
        rendered += 1;
      }
      writeFileSync(saltFile, salt);
      progress(label, index, jobs.length);
    } else {
      const png = await renderImage(
        paint === "flux"
          ? { model: "flux", prompt: tile.fluxPrompt, width: RENDER_PX, height: RENDER_PX, seed, prefix: `odm-tile-${tile.category}`, tiling: false }
          : { model: "sdxl", prompt: tile.prompt, negative: tile.negative, width: RENDER_PX, height: RENDER_PX, seed, steps: 26, cfg: 6.5, prefix: `odm-tile-${tile.category}`, tiling: false },
      );
      writeFileSync(final, png);
      writeFileSync(saltFile, salt);
      rendered += 1;
      progress(label, index, jobs.length);
    }

    const flat = path.join(srcDir, `${key}.tiled.png`);
    if (existsSync(flat)) {
      // Left over from the mirror-blend era.
      rmSync(flat);
    }
    encodeTile(final, shipped);

    let entry = manifest.find((t) => t.id === tile.id);
    if (!entry) {
      entry = {
        id: tile.id,
        category: tile.category,
        genre: tile.genre,
        label: tile.label,
        terrain: tile.terrain,
        themes: tile.themes,
        seamless: tile.seamless,
        paint,
        seed,
        src: `/assets/tiles/${tile.category}/${tile.id}.webp`,
        variants: [],
        bytes: 0,
      };
      manifest.push(entry);
    }
    entry.variants[variant - 1] = `/assets/tiles/${tile.category}/${key}.webp`;
    entry.bytes += statSync(shipped).size;
  } catch (error) {
    failures.push(`${tile.category}/${key}: ${error.message}`);
    console.error(`${label} FAILED ${error.message}`);
  }
}

for (const entry of manifest) {
  entry.variants = entry.variants.filter(Boolean);
}

// The manifest is what a palette reads: the editor should never have to guess
// a filename or re-derive which terrain character a swatch stands for.
//
// A --only pass covers a handful of tiles, so its entries are merged into
// whatever is already on disk rather than replacing it. Writing the subset
// straight out would leave the palette believing the set had shrunk to the
// few tiles the last review happened to re-render.
if (manifest.length) {
  const existing = path.join(OUT_DIR, "manifest.json");
  if (existsSync(existing)) {
    const kept = JSON.parse(readFileSync(existing, "utf8")).tiles ?? [];
    const fresh = new Set(manifest.map((t) => t.id));
    for (const tile of kept) {
      if (!fresh.has(tile.id) && existsSync(path.join(OUT_DIR, tile.category, `${tile.id}.webp`))) {
        manifest.push({ variants: [tile.src], ...tile });
      }
    }
    manifest.sort((a, b) => a.category.localeCompare(b.category) || a.id.localeCompare(b.id));
  }
}
if (manifest.length) {
  const byCategory = Object.fromEntries(
    Object.entries(CATEGORIES).map(([key, meta]) => [
      key,
      { ...meta, tiles: manifest.filter((t) => t.category === key).map((t) => t.id) },
    ]),
  );
  writeFileSync(
    path.join(OUT_DIR, "manifest.json"),
    `${JSON.stringify({ tilePx: TILE_PX, categories: byCategory, tiles: manifest }, null, 2)}\n`,
  );
}

const bytes = manifest.reduce((sum, t) => sum + t.bytes, 0);
console.log(
  `\n${manifest.length} tile(s) written to public/assets/tiles ` +
    `(${rendered} renders, ${reused} finals from kept originals, ${(bytes / 1024 / 1024).toFixed(2)} MB total).`,
);
if (failures.length) {
  console.error(`\n${failures.length} failed:\n${failures.map((f) => `  ${f}`).join("\n")}`);
  process.exit(1);
}
