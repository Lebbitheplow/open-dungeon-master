// Where each storyboard card came from, and a WorldForge file opened again
// (audit WF-19). A card made here has no origin; one from a WorldForge file
// names the world and its scene; one from a bundle its key; one copied with
// a workshop that workshop and its card. Opening the same file again finds
// the cards it brought by their scenes, not by their titles: nothing is
// doubled, what nobody changed here takes the file's word, an edit made
// here stands, and what only the board holds (kind, arrows, routes, picks)
// is never touched.
import assert from "node:assert/strict";
import fs from "node:fs";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";

const { test, finish } = suite("test-scene-origins");
const world = await openWorld();
const { createWorkshop } = await import("../src/lib/db/workshops.ts");
const { importWorldForge, exportWorldForge } = await import("../src/lib/db/world-forge-io.ts");
const { scenesWithoutRoom } = await import("../src/lib/db/world-forge-scenes.ts");
const { readWorldForge } = await import("../src/lib/worldforge/format.ts");
const { beatOrigins, copyBeats, getBeat, insertBeat, listBeats, updateBeat } = await import("../src/lib/db/workshop-beats.ts");
const { exportWorkshopBundle, importWorkshopBundle } = await import("../src/lib/db/workshop-bundle.ts");
const { readBundle } = await import("../src/lib/workshop/bundle.ts");
const { MAX_BEATS } = await import("../src/lib/workshop/board.ts");
const { getWorldDoc } = await import("../src/lib/db/world-forge.ts");
const { buildAdventure } = await import("./lib/branching-adventure.mjs");

const fixture = JSON.parse(fs.readFileSync(new URL("./fixtures/worldforge-saltmarch.json", import.meta.url), "utf8"));
const owner = { id: world.owner.id };
const shop = (title) => createWorkshop(owner.id, { title }).id;
const fresh = () => structuredClone(fixture);
const bring = (campaignId, file) => {
  const result = importWorldForge(campaignId, owner, file);
  assert.ok(!("error" in result), result.error);
  return result;
};
const card = (campaignId, title) => listBeats(campaignId).find((beat) => beat.title === title);
const edit = (campaignId, id, change) => {
  const { id: beatId, ...rest } = getBeat(id);
  updateBeat(campaignId, beatId, { ...rest, ...change });
};
const manifest = { name: "Origins", blurb: "Cards and where they came from.", version: "1.0.0", author: "A tester", homepage: "", inspiredBy: "Original work", rightsHolder: "" };

await test("A card made here has no origin; a WorldForge card names its world and its scene.", () => {
  const id = shop("Origins of a file");
  const own = insertBeat(id, { kind: "hook", title: "Made by hand", body: "", links: {}, edges: [], routes: {}, x: 0, y: 0 });
  bring(id, fresh());
  const origins = beatOrigins(id);
  assert.equal(origins[own.id], undefined, "a card made here was given an origin");
  assert.deepEqual(origins[card(id, "The Missing Codes").id], { kind: "worldforge", world: "The Saltmarch", scene: "s1" });
  assert.deepEqual(origins[card(id, "Into the Fen").id], { kind: "worldforge", world: "The Saltmarch", scene: "s2" });
});

await test("A bundle card names its key, and a card copied with a workshop names that workshop and its card.", () => {
  const id = shop("Origins of a bundle");
  const { cards } = buildAdventure(id, owner.id);
  const exported = exportWorkshopBundle(id, manifest);
  const landed = importWorkshopBundle(owner.id, readBundle(JSON.stringify(exported.bundle)).bundle);
  const fork = exported.bundle.storyboard.find((entry) => entry.title === "The fork in the fen");
  assert.deepEqual(beatOrigins(landed.workshopId)[card(landed.workshopId, "The fork in the fen").id], { kind: "bundle", ref: fork.ref });
  const copy = shop("A copy");
  copyBeats(id, copy, new Map());
  assert.deepEqual(beatOrigins(copy)[card(copy, "The fork in the fen").id], { kind: "copy", workshopId: id, title: "Origins of a bundle" });
  assert.ok(cards.fork);
});

await test("Opening the same file again doubles no card and updates what nobody changed here.", () => {
  const id = shop("Again");
  bring(id, fresh());
  const before = listBeats(id).map((beat) => beat.id);
  const again = fresh();
  again.scenes.find((scene) => scene.id === "s2").gist = "Mira follows the lanterns to the old sluice.";
  const result = bring(id, again);
  assert.equal(result.beats, 0, "a card was added again");
  assert.equal(result.beatsUpdated, 2);
  assert.deepEqual(listBeats(id).map((beat) => beat.id), before);
  assert.equal(card(id, "Into the Fen").body, "Mira follows the lanterns to the old sluice.");
});

await test("A scene renamed in the file is found by its scene, not by its title, and takes the new title.", () => {
  const id = shop("Renamed");
  bring(id, fresh());
  const was = card(id, "Into the Fen").id;
  const renamed = fresh();
  renamed.scenes.find((scene) => scene.id === "s2").title = "Into the Black Fen";
  const result = bring(id, renamed);
  assert.equal(result.beats, 0);
  assert.equal(listBeats(id).length, 2);
  assert.equal(getBeat(was).title, "Into the Black Fen");
});

await test("An edit made here stands, a value both changed is reported, and the board's own parts are never touched.", () => {
  const id = shop("Edited here");
  bring(id, fresh());
  const codes = card(id, "The Missing Codes");
  const fen = card(id, "Into the Fen");
  edit(id, codes.id, { title: "The Stolen Codes", kind: "hook", routes: { [fen.id]: { kind: "optional", label: "if they look" } }, links: { ...codes.links, mapId: "a-map" } });
  edit(id, fen.id, { body: "The author's own telling." });
  const again = fresh();
  again.scenes.find((scene) => scene.id === "s1").gist = "The codes are gone, and the drawer is scratched.";
  again.scenes.find((scene) => scene.id === "s2").gist = "The file's new telling.";
  const result = bring(id, again);
  const codesNow = getBeat(codes.id);
  assert.equal(codesNow.title, "The Stolen Codes", "the file's title overwrote the author's");
  assert.match(codesNow.body, /drawer is scratched/, "the file's new text, unchanged here, was not taken");
  assert.equal(codesNow.kind, "hook");
  assert.deepEqual(codesNow.routes, { [fen.id]: { kind: "optional", label: "if they look" } });
  assert.deepEqual(codesNow.edges, [fen.id]);
  assert.equal(codesNow.links.mapId, "a-map");
  assert.equal(getBeat(fen.id).body, "The author's own telling.");
  assert.ok(result.conflicts.includes("Scene “Into the Fen”: kept your text over the file's."), JSON.stringify(result.conflicts));
  // The title changed only here: kept, and nothing to report.
  assert.deepEqual(result.conflicts.filter((line) => line.startsWith("Scene ")), ["Scene “Into the Fen”: kept your text over the file's."]);
  // Reported once per change at the source: the same file again is quiet.
  assert.ok(!bring(id, again).conflicts.some((line) => line.startsWith("Scene ")));
});

await test("A Who taken away in the file goes, unless the author changed it here.", () => {
  const id = shop("Who goes");
  bring(id, fresh());
  const again = fresh();
  delete again.scenes.find((scene) => scene.id === "s2").povEntityId;
  bring(id, again);
  assert.equal(card(id, "Into the Fen").links.npcId, undefined);
  assert.ok(card(id, "The Missing Codes").links.npcId, "the other scene's Who went too");
});

await test("A card brought in before cards remembered their scene is matched by title once, then by its scene.", () => {
  const id = shop("Older import");
  // What the old import left: cards with the scenes' titles and no origin.
  const older = insertBeat(id, { kind: "event", title: "The Missing Codes", body: "The sluice codes are gone from Ivo's desk.", links: {}, edges: [], routes: {}, x: 40, y: 40 });
  const result = bring(id, fresh());
  assert.deepEqual(result.scenesMatched, ["The Missing Codes"]);
  assert.equal(result.beats, 1, "only the scene the old import had not brought is new");
  assert.deepEqual(beatOrigins(id)[older.id], { kind: "worldforge", world: "The Saltmarch", scene: "s1" });
  const renamed = fresh();
  renamed.scenes.find((scene) => scene.id === "s1").title = "The Lost Codes";
  const second = bring(id, renamed);
  assert.deepEqual(second.scenesMatched, []);
  assert.equal(listBeats(id).length, 2);
});

await test("A scene new to the file comes in once, drawn into the line after the scene before it.", () => {
  const id = shop("A new scene");
  bring(id, fresh());
  const grown = fresh();
  grown.scenes.push({ id: "s3", storyId: "st1", title: "The Sluice Opens", gist: "The tide comes in.", order: 2, povEntityId: "e_mira", castEntityIds: [] });
  const result = bring(id, grown);
  assert.equal(result.beats, 1);
  const fen = card(id, "Into the Fen");
  const opens = card(id, "The Sluice Opens");
  assert.deepEqual(fen.edges, [opens.id]);
  assert.ok(opens.y > card(id, "The Missing Codes").y, "the new card was laid over the old ones");
  assert.equal(bring(id, grown).beats, 0, "the new scene came in twice");
  assert.equal(listBeats(id).length, 3);
});

await test("A workshop's own WorldForge file opened elsewhere and again finds its cards by the card ids it wrote.", () => {
  const from = shop("The source");
  buildAdventure(from, owner.id);
  const into = shop("The receiver");
  bring(into, exportWorldForge(from));
  assert.equal(listBeats(into).length, 8);
  const fork = card(from, "The fork in the fen");
  edit(from, fork.id, { title: "The fork in the black fen" });
  const result = bring(into, exportWorldForge(from));
  assert.equal(result.beats, 0);
  assert.equal(listBeats(into).length, 8);
  assert.ok(card(into, "The fork in the black fen"), "the renamed card was not found again");
  assert.deepEqual(beatOrigins(into)[card(into, "The fork in the black fen").id], { kind: "worldforge", world: `odm-${from}`, scene: fork.id });
});

await test("Scenes a full board has no room for are counted before the import and named after it.", () => {
  const id = shop("Full board");
  for (let index = 0; index < MAX_BEATS - 1; index += 1) {
    insertBeat(id, { kind: "event", title: `Card ${index}`, body: "", links: {}, edges: [], routes: {}, x: 0, y: 0 });
  }
  const read = readWorldForge(fresh());
  assert.equal(scenesWithoutRoom(id, "wf:The Saltmarch", read.beats), 1);
  const result = bring(id, fresh());
  assert.equal(result.beats, 1);
  assert.match(result.skipped.join(" "), /1 scene: a storyboard holds 120 cards/);
  assert.equal(listBeats(id).length, MAX_BEATS);
  // The scene that did come in is found again, and needs no room.
  assert.equal(scenesWithoutRoom(id, "wf:The Saltmarch", read.beats), 1);
  assert.equal(bring(id, fresh()).beatsUpdated, 1);
});

await test("A reimport's readings live in the world document, keyed by card, and travel nowhere else.", () => {
  const id = shop("Readings");
  bring(id, fresh());
  const doc = getWorldDoc(id);
  const keys = Object.keys(doc.origins ?? {}).filter((key) => key.startsWith("beats/"));
  assert.deepEqual(keys.sort(), listBeats(id).map((beat) => `beats/${beat.id}`).sort());
});

world.close();
finish();
