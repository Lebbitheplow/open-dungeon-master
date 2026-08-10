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

// The same process.cwd() + env override pattern the SQLite paths use
// (src/lib/content/db.ts, src/lib/db/core.ts). The Dockerfile copies /app/src
// into the runner and data/ is a mounted volume, so both resolve in dev,
// next start, and Docker.
const BUNDLED_DIR = path.join(process.cwd(), "src", "lib", "worlds", "bundled");
export const INSTALLED_DIR =
  process.env.WORLD_PACKS_DIR || path.join(process.cwd(), "data", "worlds");

type LoadedPack = { pack: WorldPack; source: WorldPackSource };

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
      into.set(parsed.data.id, { pack: parsed.data, source });
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
