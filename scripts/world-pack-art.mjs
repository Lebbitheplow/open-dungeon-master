// Moves art between a world pack manifest and a folder of image files.
//
//   node scripts/world-pack-art.mjs embed   <dir-or-pack.json> [art-root]
//   node scripts/world-pack-art.mjs extract <dir-or-pack.json> [art-root]
//   node scripts/world-pack-art.mjs strip   <dir-or-pack.json>
//   node scripts/world-pack-art.mjs list    <dir-or-pack.json>
//
// The folder layout is <art-root>/<pack id>/<key>.webp (or .png, .jpg), the
// same one scripts/generate-world-art.mjs renders into; art-root defaults to
// data/world-art. Keys are the ones src/lib/worlds/art.ts derives, so a file
// named for something the pack does not name is reported and skipped rather
// than embedded.
//
// `embed` replaces the manifest's `art` map with what the folder holds and
// re-validates the result through worldPackSchema before writing, so a pack
// that would fail to install is never written. `extract` is the reverse, for
// editing a picture by hand. `strip` empties the map, which is how to get a
// diffable manifest back.

import fs from "node:fs";
import path from "node:path";
import { register } from "node:module";
register("./lib/register-alias.mjs", import.meta.url);

const { worldPackSchema } = await import("../src/lib/worlds/types.ts");
const { MAX_PACK_ART_BYTES, PACK_ART_KEY, packArtSlots } = await import("../src/lib/worlds/art.ts");

const ROOT = path.resolve(import.meta.dirname, "..");
const [command, target, artRootArg] = process.argv.slice(2);
const usage = "usage: node scripts/world-pack-art.mjs (embed|extract|strip|list) <dir-or-pack.json> [art-root]";

if (!["embed", "extract", "strip", "list"].includes(command ?? "") || !target) {
  console.error(usage);
  process.exit(1);
}

const artRoot = path.resolve(artRootArg ?? path.join(ROOT, "data", "world-art"));
const targetPath = path.resolve(target);

const MIME_BY_EXT = { ".webp": "image/webp", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg" };
const EXT_BY_MIME = { "image/webp": ".webp", "image/png": ".png", "image/jpeg": ".jpg" };

function packFiles() {
  if (fs.statSync(targetPath).isDirectory()) {
    return fs
      .readdirSync(targetPath)
      .filter((name) => name.endsWith(".json") && name !== "index.json")
      .sort()
      .map((name) => path.join(targetPath, name));
  }
  return [targetPath];
}

function readPack(file) {
  const raw = JSON.parse(fs.readFileSync(file, "utf8"));
  const parsed = worldPackSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    console.error(`${path.basename(file)} is not a valid world pack: ${issue.path.join(".")} ${issue.message}`);
    process.exit(1);
  }
  // Keep the author's own key order and any field the schema would default;
  // only `art` is rewritten. artKeys is the loader's field and never written.
  const { artKeys: _ignored, ...rest } = raw;
  return { raw: rest, pack: parsed.data };
}

function writePack(file, raw) {
  fs.writeFileSync(file, `${JSON.stringify(raw, null, 2)}\n`, "utf8");
}

function embed(file) {
  const { raw, pack } = readPack(file);
  const folder = path.join(artRoot, pack.id);
  const known = new Map(packArtSlots(pack).map((slot) => [slot.key, slot]));
  const art = {};
  let skipped = 0;
  let bytes = 0;
  const files = fs.existsSync(folder) ? fs.readdirSync(folder).sort() : [];
  for (const name of files) {
    const ext = path.extname(name).toLowerCase();
    const mime = MIME_BY_EXT[ext];
    const key = path.basename(name, ext);
    if (!mime || !PACK_ART_KEY.test(key)) {
      continue;
    }
    if (!known.has(key)) {
      console.warn(`  ${pack.id}: ${name} is not art for anything this pack names, skipped`);
      skipped += 1;
      continue;
    }
    const data = fs.readFileSync(path.join(folder, name));
    if (data.length > MAX_PACK_ART_BYTES) {
      console.warn(`  ${pack.id}: ${name} is ${Math.round(data.length / 1024)} KB, over the ${MAX_PACK_ART_BYTES / 1024} KB cap, skipped`);
      skipped += 1;
      continue;
    }
    art[key] = `data:${mime};base64,${data.toString("base64")}`;
    bytes += data.length;
  }
  const next = { ...raw, art };
  const check = worldPackSchema.safeParse(next);
  if (!check.success) {
    const issue = check.error.issues[0];
    console.error(`${pack.id}: embedding would make the pack invalid: ${issue.path.join(".")} ${issue.message}`);
    process.exit(1);
  }
  writePack(file, next);
  const missing = known.size - Object.keys(art).length;
  console.log(
    `${pack.id}: embedded ${Object.keys(art).length} of ${known.size} pictures (${(bytes / 1024).toFixed(0)} KB)` +
      `${missing ? `, ${missing} slot(s) have no file` : ""}${skipped ? `, ${skipped} skipped` : ""}`,
  );
}

function extract(file) {
  const { pack } = readPack(file);
  const folder = path.join(artRoot, pack.id);
  fs.mkdirSync(folder, { recursive: true });
  let count = 0;
  for (const [key, dataUrl] of Object.entries(pack.art)) {
    const mime = dataUrl.slice(5, dataUrl.indexOf(";"));
    const ext = EXT_BY_MIME[mime];
    if (!ext) {
      continue;
    }
    fs.writeFileSync(path.join(folder, `${key}${ext}`), Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64"));
    count += 1;
  }
  console.log(`${pack.id}: extracted ${count} picture(s) to ${folder}`);
}

function strip(file) {
  const { raw, pack } = readPack(file);
  writePack(file, { ...raw, art: {} });
  console.log(`${pack.id}: removed ${Object.keys(pack.art).length} picture(s)`);
}

function list(file) {
  const { pack } = readPack(file);
  const slots = packArtSlots(pack);
  const have = new Set(Object.keys(pack.art));
  const bytes = Object.values(pack.art).reduce((sum, url) => sum + Math.floor((url.length - url.indexOf(",") - 1) * 0.75), 0);
  console.log(`${pack.id}: ${have.size} of ${slots.length} pictures, ${(bytes / 1024).toFixed(0)} KB`);
  for (const slot of slots) {
    if (!have.has(slot.key)) {
      console.log(`  missing ${slot.key}`);
    }
  }
  for (const key of have) {
    if (!slots.some((slot) => slot.key === key)) {
      console.log(`  orphan  ${key}`);
    }
  }
}

const run = { embed, extract, strip, list }[command];
for (const file of packFiles()) {
  run(file);
}
