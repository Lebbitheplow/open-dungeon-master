// One-off generator for the PWA raster icons. Renders src/app/icon.svg onto
// a solid background (the svg's rounded corners are transparent, which app
// icons must not be) and writes the manifest + apple icon set. Run once after
// changing the svg: node scripts/make-pwa-icons.mjs
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const svgPath = path.join(root, "src/app/icon.svg");
const BG = "#181420";

async function render(size, scale, outPath) {
  const svg = await readFile(svgPath);
  const inner = Math.round(size * scale);
  const d20 = await sharp(svg, { density: (72 * inner) / 64 })
    .resize(inner, inner)
    .png()
    .toBuffer();
  const offset = Math.round((size - inner) / 2);
  await sharp({
    create: { width: size, height: size, channels: 4, background: BG },
  })
    .composite([{ input: d20, left: offset, top: offset }])
    .png()
    .toFile(outPath);
  console.log(`wrote ${path.relative(root, outPath)}`);
}

// Full-bleed icons: the svg fills the square, corners flattened onto BG.
await render(192, 1, path.join(root, "public/icon-192.png"));
await render(512, 1, path.join(root, "public/icon-512.png"));
// Maskable icons: the d20 shrinks into the safe zone so circular or squircle
// masks never clip it.
await render(192, 0.8, path.join(root, "public/icon-maskable-192.png"));
await render(512, 0.8, path.join(root, "public/icon-maskable-512.png"));
// Apple touch icon, served via the app-router apple-icon file convention.
await render(180, 1, path.join(root, "src/app/apple-icon.png"));
