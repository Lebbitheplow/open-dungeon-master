// The server half of the large-world measurements (audit WF-24, plan M6;
// docs/worldforge-large-worlds.md). For each size it builds the world from
// scripts/lib/large-world.mjs, brings it into a scratch workshop the way a
// WorldForge file comes in, then times the World tab's first read (the
// world route's answer) and measures what that answer weighs, as sent and
// gzipped, and times the wiki's search over it. The browser half is
// scripts/browser/scenarios/54-large-world-measure.mjs.
//
//   node scripts/measure-large-worlds.mjs                 (100, 1000, 4000)
//   node scripts/measure-large-worlds.mjs --sizes 1000    (one size)
//   node scripts/measure-large-worlds.mjs --json out.json (also as JSON)
import fs from "node:fs";
import zlib from "node:zlib";
import { parseArgs } from "node:util";
import { openWorld } from "./lib/enforce-world.mjs";
import { largeWorld } from "./lib/large-world.mjs";

const { values: args } = parseArgs({ options: { sizes: { type: "string", default: "100,1000,4000" }, json: { type: "string", default: "" }, runs: { type: "string", default: "5" } } });
const sizes = args.sizes.split(",").map(Number).filter(Boolean);
const runs = Math.max(1, Number(args.runs) || 5);

await openWorld();
const { importWorldForge } = await import("../src/lib/db/world-forge-io.ts");
const { worldAnswer, worldView, worldCounts } = await import("../src/lib/db/world-forge.ts");
const { searchIndex, searchEntries } = await import("../src/lib/worldforge/search.ts");
const { createWorkshop } = await import("../src/lib/db/workshops.ts");
const { createUser } = await import("../src/lib/db/users.ts");

const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const timed = (fn) => {
  const times = [];
  let result;
  for (let at = 0; at < runs; at += 1) {
    const started = performance.now();
    result = fn();
    times.push(performance.now() - started);
  }
  return { ms: Math.round(median(times)), result };
};
const kb = (bytes) => Math.round(bytes / 1024);

const admin = createUser(`measure${Date.now().toString(36)}`, "x", { isAdmin: true });
const rows = [];
for (const size of sizes) {
  const { file, needles } = largeWorld(size);
  const workshop = createWorkshop(admin.id, { title: `A world of ${size}` });
  const started = performance.now();
  importWorldForge(workshop.id, { id: admin.id, isAdmin: true }, file);
  const importMs = Math.round(performance.now() - started);
  const counts = worldCounts(workshop.id);
  // What the world route sends (worldAnswer), and the whole view it used to
  // send, entries and all (worldView), for the before-and-after.
  const sent = timed(() => JSON.stringify(worldAnswer(workshop.id)));
  const whole = JSON.stringify(worldView(workshop.id));
  const row = {
    size,
    entries: counts.entries,
    links: counts.links,
    events: counts.events,
    fileKb: kb(Buffer.byteLength(JSON.stringify(file))),
    importMs,
    answerMs: sent.ms,
    answerKb: kb(Buffer.byteLength(sent.result)),
    answerGzipKb: kb(zlib.gzipSync(sent.result).length),
    wholeViewKb: kb(Buffer.byteLength(whole)),
    wholeViewGzipKb: kb(zlib.gzipSync(whole).length),
  };
  // The wiki's search (src/lib/worldforge/search.ts), as the page runs it:
  // the keys built once, then each query.
  const { doc, entities } = worldView(workshop.id);
  const index = timed(() => searchIndex(doc, entities));
  row.searchIndexMs = index.ms;
  for (const [kind, needle] of Object.entries(needles)) {
    const search = timed(() => searchEntries(index.result, needle.query));
    row[`search_${kind}Ms`] = search.ms;
    row[`search_${kind}Found`] = search.result.some((hit) => entities.find((entity) => entity.ref === hit.ref)?.name === needle.holder);
  }
  rows.push(row);
  console.log(JSON.stringify(row));
}
if (args.json) fs.writeFileSync(args.json, JSON.stringify(rows, null, 2));
process.exit(0);
