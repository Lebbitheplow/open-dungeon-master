// Puts the Open5e content pack at data/content/open5e.sqlite, the cheap way
// first: an existing file built at the revision this code needs is kept (an
// older one is replaced, src/lib/content/edition.ts PACK_REVISION), the
// matching GitHub release's asset
// (open5e.sqlite.gz, attached by the release process) is downloaded next,
// and only when neither exists is the pack rebuilt from api.open5e.com by
// scripts/import-open5e.mjs. That API sits behind Cloudflare and answers
// 521 or 524 often enough to have sunk a Docker publish and an app release
// on the same evening; a release asset does not.
//
//   node scripts/fetch-content-pack.mjs
//
// ODM_CONTENT_DIR overrides the data/content directory; CONTENT_PACK_URL
// overrides the asset address (an empty value skips the download).
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { PACK_REVISION } from "../src/lib/content/edition.ts";
import { packRevision } from "./lib/pack-revision.mjs";

const repo = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const contentDir = process.env.ODM_CONTENT_DIR || path.join(repo, "data", "content");
const packPath = path.join(contentDir, "open5e.sqlite");
const pkg = JSON.parse(fs.readFileSync(path.join(repo, "package.json"), "utf8"));
const assetUrl =
  process.env.CONTENT_PACK_URL ??
  `https://github.com/Lebbitheplow/open-dungeon-master/releases/download/v${pkg.version}/open5e.sqlite.gz`;

// A release's assets land a few seconds after the release itself, and the
// Docker publish starts on the release event, so a 404 is retried for a
// short while before it is taken as "this version has no pack attached".
const ATTEMPTS = 6;
const PAUSE_MS = 20_000;

async function download(url) {
  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(120_000) });
      if (response.ok) {
        return gunzipSync(Buffer.from(await response.arrayBuffer()));
      }
      console.log(`  ${url} -> HTTP ${response.status}`);
    } catch (error) {
      console.log(`  ${url} -> ${error instanceof Error ? error.message : error}`);
    }
    if (attempt < ATTEMPTS) {
      await new Promise((resolve) => setTimeout(resolve, PAUSE_MS));
    }
  }
  return null;
}

const held = packRevision(packPath);
if (held !== null && held >= PACK_REVISION) {
  console.log(`Content pack already at ${packPath}`);
  process.exit(0);
}
fs.mkdirSync(contentDir, { recursive: true });
if (held !== null) {
  // A pack from before this revision serves rules the engine no longer
  // plays (revision 1: no 2024 rows). The old file stays beside the new one.
  console.log(`The content pack at ${packPath} is revision ${held}; this code needs ${PACK_REVISION}. Replacing it.`);
  fs.renameSync(packPath, `${packPath}.old`);
}
if (assetUrl) {
  console.log(`Fetching the content pack for ${pkg.version} from ${assetUrl}`);
  const bytes = await download(assetUrl);
  if (bytes) {
    fs.writeFileSync(packPath, bytes);
    const fetched = packRevision(packPath);
    if (fetched !== null && fetched >= PACK_REVISION) {
      console.log(`Content pack written to ${packPath} (${(bytes.byteLength / 1024 / 1024).toFixed(1)} MB)`);
      process.exit(0);
    }
    console.log(`The release asset is revision ${fetched}; building a current pack instead.`);
    fs.rmSync(packPath, { force: true });
  }
}
console.log("No release asset for this version; building the pack from api.open5e.com");
execFileSync(process.execPath, [path.join(repo, "scripts", "import-open5e.mjs")], {
  stdio: "inherit",
  env: { ...process.env, ODM_CONTENT_DIR: contentDir },
});
