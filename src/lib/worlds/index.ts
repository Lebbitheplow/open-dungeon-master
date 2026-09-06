// Server-side world pack loader.
//
// Packs come from two places, and the split is a licensing boundary, not just
// a filesystem one:
//
//   bundled   src/lib/worlds/bundled/ ships with the app under its MIT
//             license. Original works only. Never third-party IP.
//   installed data/worlds/ is added at runtime by an admin, from a registry
//             or a file. It is gitignored, is NOT part of this repository,
//             and is NOT covered by the MIT license. Community campaign
//             plugins built on somebody else's setting live here.
//
// Both are discovered by SCANNING their directory rather than by an import
// registry, so adding a world is adding one file with nothing to register.
// An installed pack wins over a bundled one with the same id, which is what
// lets somebody replace a shipped world with their own build of it.
//
// This module reads the filesystem, so it is server-only. Client components
// import ./types (schema and pure helpers) and fetch /api/worlds instead.
import fs from "node:fs";
import path from "node:path";
import {
  worldPackSchema,
  summarizePack,
  type WorldPack,
  type WorldPackSource,
  type WorldPackSummary,
} from "@/lib/worlds/types";
import { MAX_PACK_ART_BYTES, PACK_ART_DATA_URL, PACK_ART_KEY } from "@/lib/worlds/art";

// The same process.cwd() + env override pattern the SQLite paths use
// (src/lib/content/db.ts, src/lib/db/core.ts). The Dockerfile copies /app/src
// into the runner and data/ is a mounted volume, so both resolve in dev,
// next start, and Docker.
const BUNDLED_DIR = path.join(process.cwd(), "src", "lib", "worlds", "bundled");
export const INSTALLED_DIR =
  process.env.WORLD_PACKS_DIR || path.join(process.cwd(), "data", "worlds");

// One decoded picture, held in memory for the art route. A pack's art is a
// megabyte or two of WebP, and lifting it out of the manifest at load time is
// what keeps the pack itself (which the character builder downloads whole)
// prose-sized.
export type PackArtImage = { mime: string; bytes: Buffer };

type LoadedPack = {
  pack: WorldPack;
  source: WorldPackSource;
  art: Map<string, PackArtImage>;
};

// Splits a parsed manifest into the pack every consumer sees (art emptied,
// artKeys filled) and the decoded images. A data URL the schema accepted but
// that decodes to nothing, or to more than the per-picture cap, is dropped
// here rather than served, so the cap is on the bytes the disk pays and not
// only on the base64 the schema measured.
function liftArt(parsed: WorldPack): LoadedPack["art"] {
  const art = new Map<string, PackArtImage>();
  for (const [key, dataUrl] of Object.entries(parsed.art)) {
    const match = dataUrl.match(PACK_ART_DATA_URL);
    if (!match) {
      continue;
    }
    const bytes = Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64");
    if (!bytes.length || bytes.length > MAX_PACK_ART_BYTES) {
      continue;
    }
    art.set(key, { mime: `image/${match[1]}`, bytes });
  }
  return art;
}

// The pack as everything past the loader sees it: no inline images, and
// artKeys saying which pictures the art route can answer for.
export function withArtLifted(parsed: WorldPack): { pack: WorldPack; art: Map<string, PackArtImage> } {
  const art = liftArt(parsed);
  return { pack: { ...parsed, art: {}, artKeys: [...art.keys()].sort() }, art };
}

let cache: Map<string, LoadedPack> | null = null;

function readDirectory(dir: string, source: WorldPackSource, into: Map<string, LoadedPack>) {
  let files: string[] = [];
  try {
    // index.json is the registry listing written by build-world-registry.mjs,
    // not a pack. Publishing from the same folder the server installs into is
    // the documented workflow, so without this the loader would warn about a
    // failed validation on every cold load. Both the builder and
    // scripts/validate-world-packs.mjs skip it for the same reason, which does
    // mean "index" is a reserved pack id even though the schema allows it.
    files = fs
      .readdirSync(dir)
      .filter((file) => file.endsWith(".json") && file !== "index.json");
  } catch {
    // A missing directory is a valid deployment: no bundled worlds, or
    // nothing installed yet. Every world surface simply renders empty.
    return;
  }
  for (const file of files.sort()) {
    const full = path.join(dir, file);
    try {
      const parsed = worldPackSchema.safeParse(JSON.parse(fs.readFileSync(full, "utf8")));
      if (!parsed.success) {
        // A malformed pack is skipped rather than fatal, so one bad file
        // cannot take the server down. scripts/test-world-packs.mjs is what
        // turns this into a build failure for packs we ship.
        console.warn(`world pack ${file} failed validation, skipping:`, parsed.error.message);
        continue;
      }
      if (parsed.data.id !== path.basename(file, ".json")) {
        console.warn(`world pack ${file} declares id ${parsed.data.id}, skipping`);
        continue;
      }
      const { pack, art } = withArtLifted(parsed.data);
      into.set(pack.id, { pack, source, art });
    } catch (error) {
      console.warn(`world pack ${file} could not be read, skipping:`, error);
    }
  }
}

function loadAll(): Map<string, LoadedPack> {
  if (cache) {
    return cache;
  }
  const packs = new Map<string, LoadedPack>();
  readDirectory(BUNDLED_DIR, "bundled", packs);
  // Installed second, so it overwrites a bundled id rather than being
  // dropped as a duplicate.
  readDirectory(INSTALLED_DIR, "installed", packs);
  cache = packs;
  return packs;
}

// Installing and removing a pack changes what is on disk under a long-lived
// process, so both call this.
export function resetWorldPackCache(): void {
  cache = null;
}

export function listWorldPacks(): WorldPack[] {
  return [...loadAll().values()]
    .map((entry) => entry.pack)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function listWorldPackSummaries(): WorldPackSummary[] {
  return [...loadAll().values()]
    .map((entry) => summarizePack(entry.pack, entry.source))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function worldPack(id: string): WorldPack | null {
  if (!id) {
    return null;
  }
  return loadAll().get(id)?.pack ?? null;
}

export function worldPackSource(id: string): WorldPackSource | null {
  return loadAll().get(id)?.source ?? null;
}

// One of a pack's pictures, for the art route. The key is re-checked against
// the same pattern the schema enforces, because this is reached from a URL.
export function worldPackArt(id: string, key: string): PackArtImage | null {
  if (!PACK_ART_KEY.test(key)) {
    return null;
  }
  return loadAll().get(id)?.art.get(key) ?? null;
}

// The absolute path a pack id maps to inside the installed directory.
//
// The id is already constrained by worldPackSchema to [a-z][a-z0-9_]{2,49},
// which cannot express a separator or a dot segment. This resolves and
// re-checks anyway, because the cost of being wrong here is an arbitrary
// file write on the server.
export function installedPackPath(id: string): string | null {
  if (!/^[a-z][a-z0-9_]{2,49}$/.test(id)) {
    return null;
  }
  const target = path.resolve(INSTALLED_DIR, `${id}.json`);
  const root = path.resolve(INSTALLED_DIR);
  if (path.dirname(target) !== root) {
    return null;
  }
  return target;
}
