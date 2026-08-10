// Build a registry index.json from a directory of world pack manifests.
//
//   node scripts/build-world-registry.mjs <dir> <base-url>
//   node scripts/build-world-registry.mjs <dir> --urls <mapping.json>
//
// Examples:
//   node scripts/build-world-registry.mjs /NAS/odm-world-packs https://packs.example.org/worlds
//   node scripts/build-world-registry.mjs /NAS/odm-world-packs --urls /tmp/drive-urls.json
//
// The first form suits a static host where the file lives at
// <base-url>/<id>.json. The second suits hosts that give every file its own
// opaque URL with no path pattern, such as Google Drive or an object store with
// signed links: pass a JSON object of { "<pack id>": "<https url>" }.
//
// Either way it writes <dir>/index.json. Point a server's World registry URL at
// wherever that index ends up.
//
// The manifests are validated on the way through, so a broken pack cannot be
// published by accident.
import fs from "node:fs";
import path from "node:path";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { worldPackSchema, registryIndexSchema } = await import("../src/lib/worlds/types.ts");

const dir = process.argv[2];
const second = process.argv[3];
const usage = "usage: node scripts/build-world-registry.mjs <dir> (<base-url> | --urls <mapping.json>)";

let baseUrl = "";
let urlById = null;
if (!dir || !second) {
  console.error(usage);
  process.exit(1);
}
if (second === "--urls") {
  const mappingPath = process.argv[4];
  if (!mappingPath) {
    console.error(usage);
    process.exit(1);
  }
  urlById = JSON.parse(fs.readFileSync(mappingPath, "utf8"));
} else {
  baseUrl = second.replace(/\/+$/, "");
  if (!baseUrl.startsWith("https://")) {
    console.error("The base URL must be https, because the installer refuses anything else.");
    process.exit(1);
  }
}

const packs = [];
for (const file of fs.readdirSync(dir).filter((name) => name.endsWith(".json") && name !== "index.json").sort()) {
  const parsed = worldPackSchema.safeParse(JSON.parse(fs.readFileSync(path.join(dir, file), "utf8")));
  if (!parsed.success) {
    console.error(`${file} is not a valid world pack; run scripts/validate-world-packs.mjs first.`);
    process.exit(1);
  }
  const pack = parsed.data;
  const downloadUrl = urlById ? urlById[pack.id] : `${baseUrl}/${pack.id}.json`;
  if (!downloadUrl) {
    console.error(`No download URL supplied for "${pack.id}". Add it to the mapping file.`);
    process.exit(1);
  }
  packs.push({
    id: pack.id,
    name: pack.name,
    blurb: pack.blurb,
    version: pack.version,
    author: pack.author,
    homepage: pack.homepage,
    inspiredBy: pack.inspiredBy,
    rightsHolder: pack.rightsHolder,
    franchise: pack.franchise,
    edition: pack.edition,
    editionOrder: pack.editionOrder,
    baseGenre: pack.baseGenre,
    downloadUrl,
  });
}

const index = { packs };
// Round-trip through the schema the installer uses, so a bad index is caught
// here rather than by somebody's server.
const checked = registryIndexSchema.safeParse(index);
if (!checked.success) {
  console.error("The generated index does not satisfy registryIndexSchema:", checked.error.issues);
  process.exit(1);
}

fs.writeFileSync(path.join(dir, "index.json"), `${JSON.stringify(index, null, 2)}\n`);
console.log(`Wrote ${path.join(dir, "index.json")} with ${packs.length} pack(s).`);
if (baseUrl) {
  console.log(`Point the World registry URL at ${baseUrl}/index.json`);
} else {
  console.log("Upload index.json to the same host and point the World registry URL at it.");
}
