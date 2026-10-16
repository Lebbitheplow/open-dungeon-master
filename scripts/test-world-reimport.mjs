// A world brought in again, and two worlds side by side. Audit findings
// WF-03 (a reimport overwrote what the campaign changed) and WF-04 (worlds
// that happen to use the same ids merged into one). Every value an import
// brings remembers how it read; the next import of the same source takes
// what nobody changed here, keeps what was changed here, and reports what
// both changed. Another world's rows keep their own ids.
import assert from "node:assert/strict";
import fs from "node:fs";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";

const { test, finish } = suite("test-world-reimport");
const { importWorldForge, exportWorldForge } = await import("../src/lib/db/world-forge-io.ts");
const { worldView, createWorldEntity, updateWorldEntity, getWorldDoc, saveWorldDoc } = await import("../src/lib/db/world-forge.ts");
const { runContentImport } = await import("../src/lib/db/content-import.ts");
const { createWorkshop } = await import("../src/lib/db/workshops.ts");
const { getDatabase } = await import("../src/lib/db/core.ts");

const fixture = JSON.parse(fs.readFileSync(new URL("./fixtures/worldforge-saltmarch.json", import.meta.url), "utf8"));
const world = await openWorld();
const owner = { id: world.owner.id };
const shop = (title) => createWorkshop(owner.id, { title }).id;
const fresh = () => structuredClone(fixture);
const named = (campaignId, name) => worldView(campaignId).entities.find((entity) => entity.name === name);
const bring = (campaignId, file) => {
  const result = importWorldForge(campaignId, owner, file);
  assert.ok(!("error" in result), result.error);
  return result;
};

await test("Two WorldForge worlds that use the same ids keep two of everything.", () => {
  const id = shop("Two worlds");
  bring(id, fresh());
  const other = fresh();
  other.worldName = "The Other March";
  for (const entity of other.entities) entity.name = `Other ${entity.name}`;
  for (const pin of other.pins) pin.name = `Other ${pin.name}`;
  for (const event of other.events) event.title = `Other ${event.title}`;
  other.calendars[0].name = "Other Reckoning";
  other.maps[0].name = "The Other Map";
  other.secrets[0].title = "Other secret";
  bring(id, other);
  const { doc, entities } = worldView(id);
  assert.ok(entities.some((entity) => entity.name === "Ivo Brannock"), "the first world's Ivo is gone");
  assert.ok(entities.some((entity) => entity.name === "Other Ivo Brannock"), "the second world's Ivo became the first's");
  assert.equal(doc.calendars.length, 2);
  assert.equal(doc.maps.length, 2);
  assert.equal(doc.secrets.length, 2);
  const otherCalendar = doc.calendars.find((calendar) => calendar.name === "Other Reckoning");
  for (const event of doc.events.filter((entry) => entry.title.startsWith("Other "))) {
    assert.equal(event.when.calendarId, otherCalendar.id, "an event of the second world counts in the first world's calendar");
  }
  const otherMap = doc.maps.find((atlas) => atlas.name === "The Other Map");
  for (const pin of doc.pins.filter((entry) => entry.name.startsWith("Other "))) {
    assert.equal(pin.mapId, otherMap.id, "a pin of the second world stands on the first world's map");
  }
  const character = doc.types.find((type) => type.name === "Character");
  assert.ok(character.fields.some((field) => field.name === "Real Name"), "a field of the shared type was lost");
});

await test("Reimporting a file keeps what was changed here, takes what only the file changed, and reports what both changed.", () => {
  const id = shop("Edited here");
  bring(id, fresh());
  const ivo = named(id, "Ivo Brannock");
  updateWorldEntity(id, ivo.ref, { notes: "Mine: ask about the sluice." });
  // The campaign learns the secret and moves a pin.
  const doc = getWorldDoc(id);
  doc.secrets[0].partyKnows = true;
  doc.pins[0].x = 0.9;
  saveWorldDoc(id, doc);

  const changed = fresh();
  const source = changed.entities.find((entity) => entity.id === "e_ivo");
  source.notes = "The file's own notes.";
  source.tags = ["warden", "traitor"];
  changed.secrets[0].notes = "Sold the codes for his daughter's debts.";
  changed.maps[0].name = "The Saltmarch, charted";
  const again = bring(id, changed);

  const after = named(id, "Ivo Brannock");
  assert.equal(after.entry.notes, "Mine: ask about the sluice.", "the reimport overwrote the notes written here");
  assert.ok(after.entry.tags.includes("traitor") || after.tags.includes("traitor"), "a change only the file made was not taken");
  assert.ok(again.conflicts.some((line) => /Ivo Brannock: kept your notes/.test(line)), JSON.stringify(again.conflicts));
  const { doc: now } = worldView(id);
  assert.equal(now.secrets[0].partyKnows, true, "the reimport reset what the party learned");
  assert.equal(now.secrets[0].notes, "Sold the codes for his daughter's debts.");
  assert.equal(now.pins.find((pin) => pin.name === "Gullhaven").x, 0.9, "the reimport moved the pin back");
  assert.equal(now.maps[0].name, "The Saltmarch, charted");
  assert.equal(now.calendars.length, 1, "the same world's calendar was doubled");
  assert.equal(worldView(id).entities.length, fixture.entities.length, "the same world's entries were doubled");
});

await test("Reimporting the same file again changes nothing and reports nothing.", () => {
  const id = shop("Twice the same");
  bring(id, fresh());
  const before = worldView(id);
  const again = bring(id, fresh());
  const after = worldView(id);
  assert.deepEqual(again.conflicts, []);
  assert.deepEqual(again.matched, []);
  assert.deepEqual(after.entities.map((entity) => [entity.name, entity.portrait, entity.entry.notes]), before.entities.map((entity) => [entity.name, entity.portrait, entity.entry.notes]));
  assert.deepEqual(after.doc.maps.map((atlas) => atlas.image), before.doc.maps.map((atlas) => atlas.image), "a map's picture was written again");
});

await test("An ODM export keeps its world's identity when the workshop is renamed.", () => {
  const from = shop("Before the rename");
  bring(from, fresh());
  const into = shop("The copy");
  bring(into, exportWorldForge(from));
  getDatabase().prepare(`UPDATE campaigns SET title = ? WHERE id = ?`).run("After the rename", from);
  updateWorldEntity(from, named(from, "Ivo Brannock").ref, { hiddenTruth: "A new truth." });
  const again = bring(into, exportWorldForge(from));
  assert.deepEqual(again.matched, [], "entries were matched by name instead of by their world");
  assert.equal(worldView(into).entities.length, fixture.entities.length);
  assert.equal(named(into, "Ivo Brannock").entry.hiddenTruth, "A new truth.");
});

await test("Copying a workshop into a campaign again keeps the campaign's article and takes the source's other changes.", () => {
  const source = shop("The source");
  const made = createWorldEntity(source, { typeId: "t_character", name: "Captain Rell", article: "Source article" });
  assert.ok(made.entity, made.error);
  const campaign = shop("The campaign");
  const copy = () => runContentImport({ sourceId: source, campaignId: campaign, selection: ["npcs", "locations", "lore", "world"], houseRulesMode: "replace" });
  assert.ok(!("error" in copy()));
  const here = named(campaign, "Captain Rell");
  updateWorldEntity(campaign, here.ref, { article: "Campaign article" });
  updateWorldEntity(source, made.entity.ref, { article: "Source updated article", notes: "New source notes" });
  const outcome = copy();
  assert.ok(!("error" in outcome), outcome.error);
  const after = named(campaign, "Captain Rell");
  assert.equal(after.entry.article, "Campaign article", "the reimport replaced the campaign's article");
  assert.equal(after.entry.notes, "New source notes");
  assert.ok((outcome.worldConflicts ?? []).some((line) => /Captain Rell: kept your article/.test(line)), JSON.stringify(outcome.worldConflicts));
});

await test("Copying a second workshop keeps the campaign's own field on a shared type.", () => {
  const campaign = shop("Custom fields");
  const first = shop("First source");
  createWorldEntity(first, { typeId: "t_character", name: "Someone" });
  runContentImport({ sourceId: first, campaignId: campaign, selection: ["npcs", "locations", "lore", "world"], houseRulesMode: "replace" });
  const doc = getWorldDoc(campaign);
  doc.types.find((type) => type.id === "t_character").fields.push({ id: "audit-field", name: "Audit field", kind: "text", options: [], authorOnly: false, role: "" });
  saveWorldDoc(campaign, doc);
  const second = shop("Second source");
  createWorldEntity(second, { typeId: "t_character", name: "Someone else" });
  runContentImport({ sourceId: second, campaignId: campaign, selection: ["npcs", "locations", "lore", "world"], houseRulesMode: "replace" });
  const fields = getWorldDoc(campaign).types.find((type) => type.id === "t_character").fields.map((field) => field.id);
  assert.ok(fields.includes("audit-field"), `the campaign's field was dropped: ${fields.join(", ")}`);
});

world.close();
finish();
