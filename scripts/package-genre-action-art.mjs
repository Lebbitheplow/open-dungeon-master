// Re-encode the selected, already generated PNGs; no network or image generation.
// node scripts/package-genre-action-art.mjs <directory-containing-source-PNGs>
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";

const root = path.resolve(import.meta.dirname, "..");
const sourceDir = process.argv[2];
if (!sourceDir) throw new Error("Pass the directory containing the source PNGs recorded in the art manifest.");
const reportPath = path.join(root, "docs/art/genre-action-cards-2026-10-26.json");
const report = JSON.parse(readFileSync(reportPath, "utf8"));
const subjects = JSON.parse(readFileSync(path.join(root, "scripts/genre-action-subjects.json"), "utf8"));
assert.equal(report.records.length, 75);
assert.equal(new Set(report.records.map((r) => r.id)).size, 75);
const ids = new Set(subjects.map((r) => r.id));
for (const record of report.records) {
  assert.ok(ids.has(record.id), record.id);
  assert.equal(path.basename(record.sourceImage), record.sourceImage);
  assert.ok(existsSync(path.join(sourceDir, record.sourceImage)), record.sourceImage);
}
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
for (const record of report.records) {
  const source = readFileSync(path.join(sourceDir, record.sourceImage));
  const output = await sharp(source)
    .resize(256, 128, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .webp({ quality: 92, alphaQuality: 100, effort: 6 }).toBuffer();
  const meta = await sharp(output).metadata();
  const stats = await sharp(output).stats();
  assert.equal(meta.width, 256);
  assert.equal(meta.height, 128);
  assert.ok(meta.hasAlpha && stats.channels[3].min === 0 && stats.channels[3].max === 255, record.id);
  record.src = `/assets/icons/action/${record.id}.webp`;
  record.sourceSha256 = hash(source);
  record.finalSha256 = hash(output);
  record.bytes = output.length;
  writeFileSync(path.join(root, "public", record.src), output);
}

// Preserve every unrelated manifest entry and update only this authored set.
const manifestPath = path.join(root, "public/assets/icons/manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const replaced = new Set(report.records.map((r) => `action-${r.id}`));
manifest.icons = manifest.icons.filter((icon) => !replaced.has(icon.id));
for (const record of report.records) {
  const subject = subjects.find((s) => s.id === record.id);
  manifest.icons.push({ id: `action-${record.id}`, group: "action", key: record.id,
    label: subject.label, src: record.src, bytes: record.bytes,
    generator: "image_gen", width: 256, height: 128, genre: subject.genre });
}
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
const indexPath = path.join(root, "src/lib/painted-icons.json");
const index = JSON.parse(readFileSync(indexPath, "utf8"));
index.action = [...new Set([...index.action, ...report.records.map((r) => r.id)])].sort();
writeFileSync(indexPath, `${JSON.stringify(index)}\n`);

// Review at the actual compact sizes on both light and dark surfaces.
const genres = ["cyberpunk", "steampunk", "mystery", "horror", "post_apocalyptic"];
const actions = ["attack", "cast", "dash", "disengage", "dodge", "help", "hide", "ready", "grapple", "shove", "use-object", "end-turn", "search", "escape", "stand-up"];
report.reviewPreviews = [];
for (const genre of genres) {
  const overlays = [];
  for (const [i, action] of actions.entries()) {
    const x = (i % 5) * 272, y = Math.floor(i / 5) * 156;
    const title = Buffer.from(`<svg width="272" height="156"><rect width="136" height="156" fill="#171a23"/><rect x="136" width="136" height="156" fill="#eee8dc"/><text x="8" y="18" fill="#eee8dc" font-family="sans-serif" font-size="12">${action}</text><text x="144" y="18" fill="#171a23" font-family="sans-serif" font-size="12">${action}</text></svg>`);
    overlays.push({ input: title, left: x, top: y });
    const file = path.join(root, "public/assets/icons/action", `${genre.replaceAll("_", "-")}-${action}.webp`);
    for (const width of [112, 80]) {
      const small = await sharp(file).resize(width, width / 2).png().toBuffer();
      for (const offset of [0, 136]) overlays.push({ input: small, left: x + offset + (136 - width) / 2, top: y + (width === 112 ? 28 : 96) });
    }
  }
  const relative = `docs/art/genre-actions-${genre.replaceAll("_", "-")}.webp`;
  await sharp({ create: { width: 1360, height: 468, channels: 4, background: "#171a23" } })
    .composite(overlays).webp({ quality: 95 }).toFile(path.join(root, relative));
  report.reviewPreviews.push(relative);
}
report.encoding = { format: "WebP", width: 256, height: 128, fit: "contain", quality: 92, alphaQuality: 100, effort: 6 };
report.validation = { assetCount: 75, dimensions: "256x128", alpha: "transparent and opaque pixels verified in all 75", totalBytes: report.records.reduce((n, r) => n + r.bytes, 0) };
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(`Packaged ${report.records.length} genre action paintings (${(report.validation.totalBytes / 1048576).toFixed(2)} MiB), indexed them and wrote five compact review sheets.`);
