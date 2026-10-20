// The far side of scripts/test-scene-bundle-round-trip.mjs: a bundle file
// opened on a fresh server, in a process of its own with a database of its
// own. It writes what landed (the board in words, where each card came
// from, and the bundle the new workshop exports again) to a JSON file.
//
//   node scripts/lib/scene-bundle-fresh-store.mjs <bundle.json> <out.json>
import fs from "node:fs";
import { openWorld } from "./enforce-world.mjs";

const [, , bundlePath, outPath] = process.argv;
const world = await openWorld();
const { readBundle } = await import("../../src/lib/workshop/bundle.ts");
const { importWorkshopBundle, exportWorkshopBundle } = await import("../../src/lib/db/workshop-bundle.ts");
const { beatOrigins, listBeats } = await import("../../src/lib/db/workshop-beats.ts");
const { describeBoard } = await import("./branching-adventure.mjs");
const { getDatabase } = await import("../../src/lib/db/core.ts");

const read = readBundle(fs.readFileSync(bundlePath, "utf8"));
if ("error" in read) throw new Error(read.error);
const landed = importWorkshopBundle(world.owner.id, read.bundle);
if ("error" in landed) throw new Error(landed.error);
const origins = beatOrigins(landed.workshopId);
const again = exportWorkshopBundle(landed.workshopId, read.bundle.manifest);
if ("error" in again) throw new Error(again.error);
fs.writeFileSync(
  outPath,
  JSON.stringify({
    // A fresh server holds nothing but what the bundle brought.
    workshops: getDatabase().prepare(`SELECT COUNT(*) AS n FROM campaigns WHERE kind = 'workshop'`).get().n,
    droppedLinks: landed.droppedLinks,
    board: await describeBoard(landed.workshopId),
    origins: listBeats(landed.workshopId).map((beat) => origins[beat.id] ?? null),
    reexported: again.bundle.storyboard,
  }),
);
world.close();
