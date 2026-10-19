// A full branching adventure in a workshop bundle, to a fresh server and
// back (audit WF-19). A WorldForge file holds scenes in a line; a bundle is
// where the whole adventure travels, so nothing on the board may be lost to
// one: every card's kind, title, text and place on the board, every arrow
// and what it means, and what each card picked. The far side runs in a
// process of its own with a database of its own (a fresh server), and its
// own export of what landed carries the same card keys again.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";

const { test, finish } = suite("test-scene-bundle-round-trip");
const world = await openWorld();
const { createWorkshop } = await import("../src/lib/db/workshops.ts");
const { exportWorkshopBundle, importWorkshopBundle } = await import("../src/lib/db/workshop-bundle.ts");
const { readBundle } = await import("../src/lib/workshop/bundle.ts");
const { beatOrigins, listBeats } = await import("../src/lib/db/workshop-beats.ts");
const { checkWorldForgeExport } = await import("../src/lib/db/world-forge-io.ts");
const { buildAdventure, describeBoard, CARD_TITLES } = await import("./lib/branching-adventure.mjs");

const owner = world.owner.id;
const manifest = { name: "The Low Tide", blurb: "A fen, a fork and a leak.", version: "1.0.0", author: "A tester", homepage: "", inspiredBy: "Original work", rightsHolder: "" };
const source = createWorkshop(owner, { title: "The Low Tide" }).id;
buildAdventure(source, owner);
const before = await describeBoard(source);

const exported = exportWorkshopBundle(source, manifest);
assert.ok(!("error" in exported), exported.error);
const text = JSON.stringify(exported.bundle);
// The reader writes a pick a card did not make as null: the same nothing.
const plain = (cards) => cards.map((card) => ({ ...card, links: Object.fromEntries(Object.entries(card.links).filter(([, index]) => index !== null)) }));

await test("The adventure on its own board is what the suite says it is: branching, routed and picked.", () => {
  assert.deepEqual(before.map((card) => card.title), CARD_TITLES);
  const fork = before.find((card) => card.title === "The fork in the fen");
  assert.deepEqual(fork.leadsTo, ["Side with the guild", "Trust the wardens", "A detour through the reeds"]);
  assert.equal(fork.routes["A detour through the reeds"].kind, "optional");
  const ambush = before.find((card) => card.title === "The ambush at the sluice");
  assert.deepEqual(ambush.picks, { mapId: "Sluice battle map", encounterId: "Smugglers at the sluice", locationId: "The Sluice Gate" });
  // The same board as a WorldForge file would lose its branches: the bundle
  // is the way to keep them.
  assert.ok(checkWorldForgeExport(source).scenes.length > 0, "a WorldForge file of this board names no loss");
});

await test("Every card goes into the bundle with a key of its own, and the bundle reads back whole.", () => {
  const cards = exported.bundle.storyboard;
  assert.equal(cards.length, CARD_TITLES.length);
  assert.ok(cards.every((card) => /^r-[0-9a-f]{24}$/.test(card.ref)), "a card went out without its key");
  assert.equal(new Set(cards.map((card) => card.ref)).size, cards.length, "two cards share a key");
  const read = readBundle(text);
  assert.ok(!("error" in read), read.error);
  assert.deepEqual(plain(read.bundle.storyboard), cards, "reading the bundle changed a card");
});

await test("On a fresh server the board lands whole: every card, arrow, route and pick, nothing dropped.", () => {
  const dir = fs.mkdtempSync(path.join(process.cwd(), "fresh-"));
  const bundlePath = path.join(dir, "bundle.json");
  const outPath = path.join(dir, "landed.json");
  fs.writeFileSync(bundlePath, text);
  const far = fileURLToPath(new URL("./lib/scene-bundle-fresh-store.mjs", import.meta.url));
  const run = spawnSync(process.execPath, [far, bundlePath, outPath], { encoding: "utf8", env: { ...process.env, SQLITE_DB_PATH: "", DB_ENCRYPTION_KEY: "" } });
  assert.equal(run.status, 0, `the fresh server failed:\n${run.stderr}`);
  const landed = JSON.parse(fs.readFileSync(outPath, "utf8"));
  assert.equal(landed.workshops, 1, "the fresh server was not fresh");
  assert.equal(landed.droppedLinks, 0, "a pick was dropped on the way");
  assert.deepEqual(landed.board, before, "the board changed between the two servers");
  // Each card there remembers the bundle it came from, by its key.
  assert.deepEqual(landed.origins, exported.bundle.storyboard.map((card) => ({ kind: "bundle", ref: card.ref })));
  // And the fresh server's own bundle of it is the same adventure, keys
  // and all, so a third server receives the same cards again.
  assert.deepEqual(plain(landed.reexported), exported.bundle.storyboard);
});

await test("Landing the same bundle twice on one server makes two workshops whose cards both name their key.", () => {
  const read = readBundle(text);
  const first = importWorkshopBundle(owner, read.bundle);
  const second = importWorkshopBundle(owner, read.bundle);
  for (const landed of [first, second]) {
    assert.ok(!("error" in landed), landed.error);
    const origins = beatOrigins(landed.workshopId);
    assert.deepEqual(
      listBeats(landed.workshopId).map((beat) => origins[beat.id]?.ref),
      exported.bundle.storyboard.map((card) => card.ref),
    );
  }
});

await test("A bundle written before cards had keys still lands whole, its cards with no origin to name.", async () => {
  const old = JSON.parse(text);
  for (const card of old.storyboard) delete card.ref;
  const read = readBundle(JSON.stringify(old));
  assert.ok(!("error" in read), read.error);
  const landed = importWorkshopBundle(owner, read.bundle);
  assert.ok(!("error" in landed), landed.error);
  assert.deepEqual(await describeBoard(landed.workshopId), before);
  assert.deepEqual(beatOrigins(landed.workshopId), {});
});

world.close();
finish();
