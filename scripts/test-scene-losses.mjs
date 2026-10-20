// What a narrative conversion of the storyboard cannot carry, named scene by
// scene before anything is written (audit WF-19, following WF-06). A
// WorldForge file holds scenes in a line: out, a card loses its kind, its
// branches, what its routes mean and its picks of a battle map and a fight;
// in, a scene loses the cast beyond its point of view and any point of
// view or place that is not a Cast member or a place. Both are said before
// the file is written or the import applied, and the panel's routes answer
// with them first.
import assert from "node:assert/strict";
import fs from "node:fs";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";

const { test, finish } = suite("test-scene-losses");
const world = await openWorld();
const { createWorkshop } = await import("../src/lib/db/workshops.ts");
const { checkWorldForgeExport, exportWorldForge } = await import("../src/lib/db/world-forge-io.ts");
const { readWorldForge } = await import("../src/lib/worldforge/format.ts");
const { planSceneExport, sceneLossLines } = await import("../src/lib/worldforge/scenes.ts");
const { insertBeat, listBeats, getBeat, updateBeat } = await import("../src/lib/db/workshop-beats.ts");
const { createWorldEntity } = await import("../src/lib/db/world-forge.ts");
const { buildAdventure } = await import("./lib/branching-adventure.mjs");

const fixture = JSON.parse(fs.readFileSync(new URL("./fixtures/worldforge-saltmarch.json", import.meta.url), "utf8"));
const fresh = () => structuredClone(fixture);
const owner = world.owner;
const shop = (title) => createWorkshop(owner.id, { title }).id;
const lostBy = (scenes, title) => scenes.find((scene) => scene.scene === title)?.lost ?? [];

// ---- out: the board as a WorldForge file ----

const adventure = shop("A branching adventure");
buildAdventure(adventure, owner.id);
const check = checkWorldForgeExport(adventure);

await test("Each card names what it loses as a scene: its kind, its branches and what its routes mean.", () => {
  assert.deepEqual(lostBy(check.scenes, "The summons"), ["its kind, “A reason to go” (it comes back as “Something happens”)"]);
  assert.deepEqual(lostBy(check.scenes, "The fork in the fen"), [
    "what its arrow to “Side with the guild” means (One route of several: “if they side with the guild”)",
    "its arrow to “Trust the wardens” (One route of several: “if they trust the wardens”)",
    "its arrow to “A detour through the reeds” (Only if...: “if they search the reeds”)",
  ]);
});

await test("A card names the battle map and the fight it picked, which a scene has no room for.", () => {
  const lost = lostBy(check.scenes, "The ambush at the sluice");
  assert.ok(lost.includes("its battle map, “Sluice battle map”"), JSON.stringify(lost));
  assert.ok(lost.includes("its prepared fight, “Smugglers at the sluice”"), JSON.stringify(lost));
  assert.ok(lost.includes("its kind, “A fight” (it comes back as “Something happens”)"));
});

await test("A card whose place in the line would give it an arrow it does not have says so.", () => {
  // Reading order walks the guild's branch to its end before the wardens',
  // so the confession is followed by the wardens' card it does not lead to.
  const lost = lostBy(check.scenes, "Ivo's confession");
  assert.ok(lost.some((line) => /comes back leading to “Trust the wardens”, which it does not lead to here/.test(line)), JSON.stringify(lost));
});

await test("A plain line of cards that are all 'Something happens' loses nothing, and its Who and Where travel.", () => {
  const id = shop("A plain line");
  const npc = createWorldEntity(id, { typeId: "t_character", name: "Mira Fenn" }).entity.ref.slice(4);
  const one = insertBeat(id, { kind: "event", title: "One", body: "", links: { npcId: npc }, edges: [], routes: {}, x: 0, y: 0 });
  const two = insertBeat(id, { kind: "event", title: "Two", body: "", links: {}, edges: [], routes: {}, x: 0, y: 0 });
  const { id: oneId, ...rest } = getBeat(one.id);
  updateBeat(id, oneId, { ...rest, edges: [two.id] });
  assert.deepEqual(checkWorldForgeExport(id).scenes, []);
  const file = exportWorldForge(id);
  assert.deepEqual(file.scenes.map((scene) => scene.title), ["One", "Two"]);
  assert.ok(file.scenes[0].povEntityId, "the Who did not travel as the point of view");
});

await test("A Who from outside the world is named as lost, not quietly dropped.", () => {
  const plan = planSceneExport(
    [{ id: "a", kind: "event", title: "Alone", body: "", links: { npcId: "elsewhere" }, edges: [], routes: {}, x: 0, y: 0 }],
    () => false,
    () => "Someone Else",
  );
  assert.deepEqual(plan.scenes, [{ scene: "Alone", lost: ["its Who, “Someone Else”, who is not in this world"] }]);
});

await test("The file lists the cards in reading order, so the line follows the board's arrows.", () => {
  const file = exportWorldForge(adventure);
  assert.deepEqual(file.scenes.slice(0, 3).map((scene) => scene.title), ["The summons", "The fork in the fen", "Side with the guild"]);
  assert.deepEqual(file.scenes.map((scene) => scene.order), file.scenes.map((_, index) => index));
});

await test("Asked first, the export route answers with the losses and writes no file; then the file downloads.", async () => {
  const route = await world.route("campaigns/[campaignId]/world/export");
  world.signIn(owner);
  const params = { params: Promise.resolve({ campaignId: adventure }) };
  const asked = await route.GET(new Request(`http://test/api/campaigns/${adventure}/world/export?check=1`), params);
  assert.equal(asked.status, 200);
  assert.match(asked.headers.get("content-type") ?? "", /json/);
  assert.equal(asked.headers.get("content-disposition"), null, "the check came back as a download");
  const body = await asked.json();
  assert.deepEqual(body.scenes, check.scenes);
  const file = await route.GET(new Request(`http://test/api/campaigns/${adventure}/world/export`), params);
  assert.match(file.headers.get("content-disposition") ?? "", /attachment/);
});

// ---- in: a WorldForge file's scenes as cards ----

await test("A scene's cast beyond its point of view is named as lost, by name.", () => {
  assert.deepEqual(readWorldForge(fresh()).sceneLosses, [{ scene: "The Missing Codes", lost: ["its cast beyond its point of view: “Mira Fenn” (a card names one Who)"] }]);
});

await test("A point of view that is not a Cast member, a place that is not a place, and a missing entry are each named.", () => {
  const file = fresh();
  const fen = file.scenes.find((scene) => scene.id === "s2");
  fen.povEntityId = "e_fen";
  fen.locationEntityId = "e_mira";
  fen.castEntityIds = ["e_nobody"];
  const lost = lostBy(readWorldForge(file).sceneLosses, "Into the Fen");
  assert.ok(lost.some((line) => /^its point of view, “.+”, which is not a Cast member$/.test(line)), JSON.stringify(lost));
  assert.ok(lost.includes("its place, “Mira Fenn”, which is not a place"), JSON.stringify(lost));
  assert.ok(lost.some((line) => /its cast beyond its point of view: an entry the file does not have/.test(line)), JSON.stringify(lost));
});

await test("A scene's gist and its written text both come in when they fit; the text that does not fit is named.", () => {
  const read = readWorldForge(fresh());
  assert.equal(read.beats.find((beat) => beat.wfId === "s1").body, "The sluice codes are gone from Ivo's desk.\n\nThe desk drawer was open.");
  const long = fresh();
  long.sceneBodies.s1 = "x".repeat(4_500);
  const cut = readWorldForge(long);
  assert.equal(cut.beats.find((beat) => beat.wfId === "s1").body, "The sluice codes are gone from Ivo's desk.");
  assert.ok(lostBy(cut.sceneLosses, "The Missing Codes").includes("its written text (4,500 characters), which does not fit on a card beside its gist"));
  const huge = fresh();
  huge.scenes[0].gist = "y".repeat(5_000);
  huge.scenes[0].title = "T".repeat(130);
  const lost = lostBy(readWorldForge(huge).sceneLosses, "T".repeat(120));
  assert.ok(lost.includes("the end of its text (a card holds 4,000 characters)"), JSON.stringify(lost));
  assert.ok(lost.includes("the end of its title (a card's title holds 120 characters)"), JSON.stringify(lost));
});

await test("Scenes with no title or no order are counted as left out, with the file's other losses.", () => {
  const file = fresh();
  file.scenes.push({ id: "s9", storyId: "st1", title: "", order: 3 }, { id: "s8", storyId: "st1", title: "No order" });
  assert.match(readWorldForge(file).losses.join(" "), /2 scenes have no title or no place in its story's order, and are left out/);
});

await test("The workshop's own WorldForge file reads back with no scene losses: it holds only what scenes can.", () => {
  assert.deepEqual(readWorldForge(exportWorldForge(adventure)).sceneLosses, []);
});

await test("The import route answers a file whose scenes lose something with them first, and writes nothing.", async () => {
  const route = await world.route("campaigns/[campaignId]/world/import");
  world.signIn(owner);
  const id = shop("Held for the author's yes");
  const file = fresh();
  delete file.media.entityImages.e_mira;
  const send = (accept) =>
    route.POST(
      new Request(`http://test/api/campaigns/${id}/world/import`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: JSON.stringify(file), accept }) }),
      { params: Promise.resolve({ campaignId: id }) },
    );
  const held = await (await send(false)).json();
  assert.equal(held.preview, true, "a scene loss alone did not hold the import");
  assert.deepEqual(held.losses, []);
  assert.deepEqual(held.scenes, readWorldForge(file).sceneLosses);
  assert.equal(listBeats(id).length, 0, "a card was written before the author agreed");
  const applied = await (await send(true)).json();
  assert.equal(applied.beats, 2);
  assert.deepEqual(applied.losses, sceneLossLines(held.scenes), "the report did not repeat what did not come in whole");
});

world.close();
finish();
