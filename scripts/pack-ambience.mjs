// Builds the sound pack: public/ambience zipped with its credits, for the
// release to attach as ambience-pack.zip so an install that cannot run
// scripts (the desktop and Android apps bundle a server) gets the library
// from the admin panel in one tap, and `npm run fetch-ambience -- --pack`
// gets it on any other.
//
// Only tracks made here go in by default (origin "generated" in the lock):
// those are the project's to ship. Archive downloads were accepted under a
// licence for one install and are left out unless --all says otherwise.
//
// Usage:
//   node scripts/pack-ambience.mjs                  -> ambience-pack.zip in the repo root
//   node scripts/pack-ambience.mjs --out /tmp/x.zip
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

const entries = packableEntries({ all });
if (!entries.length) {
  console.error(
    all
      ? "[ambience] public/ambience holds no tracks."
      : "[ambience] no generated tracks to pack; run npm run generate-ambience first, or pass --all.",
  );
  process.exit(1);
}
const zip = await buildPack(entries);
writeFileSync(out, zip);
const cues = new Set(entries.map((entry) => entry.file.replace(/(-\d+)?\.[a-z0-9]+$/, "")));
console.log(
  `[ambience] ${entries.length} tracks for ${cues.size} cues, ${(zip.length / 1024 / 1024).toFixed(1)} MB -> ${out}`,
);
