// Builds the sound pack: public/ambience zipped with its credits, for the
// release to attach as ambience-pack.zip so an install that cannot run
// scripts (the desktop and Android apps bundle a server) gets the library
// from the admin panel in one tap, and `npm run fetch-ambience -- --pack`
// gets it on any other.
//
// Public-domain and attribution-licensed recordings go in with their
// credits (src/lib/ambience/pack.ts packable). Files the operator declared
// themselves stay behind, and takes made with a music model go in only with
// --include-generated.
//
// Usage:
//   node scripts/pack-ambience.mjs                  -> ambience-pack.zip in the repo root
//   node scripts/pack-ambience.mjs --out /tmp/x.zip
//   node scripts/pack-ambience.mjs --include-generated
//   node scripts/pack-ambience.mjs --all            include every track on disk
import { writeFileSync } from "node:fs";
import path from "node:path";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { buildPack, packableEntries, PACK_FILE } = await import("../src/lib/ambience/pack.ts");

const args = process.argv.slice(2);
const index = args.indexOf("--out");
const out = index >= 0 && args[index + 1] ? args[index + 1] : path.join(process.cwd(), PACK_FILE);
const all = args.includes("--all");
const includeGenerated = args.includes("--include-generated");

const entries = packableEntries({ all, includeGenerated });
if (!entries.length) {
  console.error(
    all
      ? "[ambience] public/ambience holds no tracks."
      : "[ambience] nothing redistributable to pack; run npm run fetch-ambience first, or pass --all.",
  );
  process.exit(1);
}
const zip = await buildPack(entries);
writeFileSync(out, zip);
const cues = new Set(entries.map((entry) => entry.file.replace(/(-\d+)?\.[a-z0-9]+$/, "")));
console.log(
  `[ambience] ${entries.length} tracks for ${cues.size} cues, ${(zip.length / 1024 / 1024).toFixed(1)} MB -> ${out}`,
);
