// Writes the 256 and 1024 px WebP copies (src/lib/image-variants.ts) for
// every picture already in public/generated and public/uploads. Safe to run
// again: a picture whose copies exist is skipped without being read.
//
//   node scripts/backfill-image-variants.mjs            # this checkout's public/
//   node scripts/backfill-image-variants.mjs --dry-run  # only count
//   node scripts/backfill-image-variants.mjs --root /some/other/public
import fs from "node:fs";
import path from "node:path";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { VARIANT_WIDTHS, isVariantFileName, variantFileName } = await import("../src/lib/image-format.ts");
const { writeImageVariants } = await import("../src/lib/image-variants.ts");

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const rootFlag = args.indexOf("--root");
const publicDir = rootFlag >= 0 && args[rootFlag + 1] ? path.resolve(args[rootFlag + 1]) : path.join(process.cwd(), "public");

const ORIGINAL = /\.(png|jpe?g|webp)$/i;
const totals = { seen: 0, complete: 0, written: 0, failed: 0 };

for (const folder of ["generated", "uploads"]) {
  const dir = path.join(publicDir, folder);
  if (!fs.existsSync(dir)) {
    console.log(`${folder}: no such folder, skipped`);
    continue;
  }
  const names = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && ORIGINAL.test(entry.name) && !isVariantFileName(entry.name))
    .map((entry) => entry.name)
    .sort();
  let written = 0;
  let complete = 0;
  let failed = 0;
  for (const name of names) {
    totals.seen += 1;
    const missing = VARIANT_WIDTHS.filter((width) => !fs.existsSync(path.join(dir, variantFileName(name, width))));
    if (!missing.length) {
      complete += 1;
      continue;
    }
    if (dryRun) {
      console.log(`${folder}/${name}: would write ${missing.map((width) => `w${width}`).join(", ")}`);
      continue;
    }
    const started = Date.now();
    const result = await writeImageVariants(path.join(dir, name));
    if (result.error) {
      failed += 1;
      console.warn(`${folder}/${name}: ${result.error}`);
      continue;
    }
    written += result.written.length;
    if (result.written.length) {
      console.log(`${folder}/${name}: ${result.written.map((file) => path.basename(file)).join(", ")} (${Date.now() - started} ms)`);
    } else {
      complete += 1;
    }
  }
  totals.complete += complete;
  totals.written += written;
  totals.failed += failed;
  console.log(`${folder}: ${names.length} pictures, ${complete} already complete, ${written} copies written, ${failed} failed`);
}

console.log(
  `${dryRun ? "Dry run: " : ""}${totals.seen} pictures, ${totals.complete} complete, ${totals.written} copies written, ${totals.failed} failed`,
);
process.exit(totals.failed ? 1 : 0);
