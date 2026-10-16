// M1 of the WorldForge completion plan, checked as a whole: one test per
// line of the plan's acceptance list, each crossing the fixes that meet
// there (WF-01 canon, WF-02 entry conflicts, WF-03/04 reimport and
// identity, WF-05 bundle pictures, WF-06 losses and limits, WF-13 one text).
// Each fix has its own suite; this one is for what they do together.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";

const { test, finish } = suite("test-worldforge-m1");
const { importWorldForge, exportWorldForge } = await import("../src/lib/db/world-forge-io.ts");
const { worldView, createWorldEntity, updateWorldEntity, getWorldDoc, saveWorldDoc } = await import("../src/lib/db/world-forge.ts");
const { exportWorkshopBundle, importWorkshopBundle } = await import("../src/lib/db/workshop-bundle.ts");
const { readBundle } = await import("../src/lib/workshop/bundle.ts");
const { readWorldForge } = await import("../src/lib/worldforge/format.ts");
const { listLoreEntries, updateLoreEntry, getLoreEntry } = await import("../src/lib/db/lore.ts");
const { loreVisibleTo } = await import("../src/lib/dm/world-lore-logic.ts");
const { changesSince, editableOf } = await import("../src/lib/worldforge/entry-merge.ts");
const { accountOf } = await import("../src/lib/worldforge/account.ts");
const { createWorkshop } = await import("../src/lib/db/workshops.ts");

const fixture = JSON.parse(fs.readFileSync(new URL("./fixtures/worldforge-saltmarch.json", import.meta.url), "utf8"));
const world = await openWorld();
const owner = { id: world.owner.id };
const shop = (title) => createWorkshop(owner.id, { title }).id;
const named = (id, name) => worldView(id).entities.find((entity) => entity.name === name);
const playerReads = (id, title) => loreVisibleTo(listLoreEntries(id), false, "a-player").some((entry) => entry.title === title);
const clean = () => {
  const file = structuredClone(fixture);
  delete file.media.entityImages.e_mira; // the fixture's disguised script
  return file;
};
const loreFile = (entities) => {
  const file = clean();
  file.types.push({ id: "t_relic", name: "Relic", fields: [] });
  file.entities.push(...entities);
  return file;
};

await test("Drafts cannot reach players, through a file round trip and a reimport.", () => {
  const id = shop("M1 drafts");
  importWorldForge(id, owner, loreFile([{ id: "e_pact", name: "The Unwritten Pact", type: "Relic", summary: "Not settled.", canon: "draft" }]));
  assert.equal(playerReads(id, "The Unwritten Pact"), false, "a draft from a file reached players");
  const again = shop("M1 drafts, again");
  importWorldForge(again, owner, exportWorldForge(id));
  importWorldForge(again, owner, exportWorldForge(id));
  assert.equal(playerReads(again, "The Unwritten Pact"), false, "a draft reached players after a round trip and a reimport");
  updateWorldEntity(again, named(again, "The Unwritten Pact").ref, { canon: "canon" });
  assert.equal(playerReads(again, "The Unwritten Pact"), true, "making it canon did not publish it");
});

await test("A lore entry kept to the DM stays so through a file, and a campaign that published it keeps its choice on reimport.", () => {
  const from = shop("M1 secret lore");
  const made = createWorldEntity(from, { typeId: "t_other", name: "The Wardens' Debt", text: "Owed to the smugglers." });
  updateLoreEntry(made.entity.id, { visibility: "dm" });
  const into = shop("M1 secret lore, copied");
  importWorldForge(into, owner, exportWorldForge(from));
  assert.equal(playerReads(into, "The Wardens' Debt"), false, "DM-only lore reached players through a file");
  updateLoreEntry(named(into, "The Wardens' Debt").id, { visibility: "party" });
  importWorldForge(into, owner, exportWorldForge(from));
  assert.equal(playerReads(into, "The Wardens' Debt"), true, "a reimport hid again what the campaign had published");
});

await test("Two editors changing different fields keep both; the same field is reported and recoverable, on a lore entry's one text too.", () => {
  const id = shop("M1 editors");
  const made = createWorldEntity(id, { typeId: "t_other", name: "The Drowned Bell", text: "It rings at low tide." });
  const open = () => {
    const values = editableOf(worldView(id).doc, named(id, "The Drowned Bell"));
    return { opened: values, mine: structuredClone(values) };
  };
  const save = (editor) => {
    const { patch, base } = changesSince(editor.opened, editor.mine);
    return updateWorldEntity(id, made.entity.ref, { ...patch, base });
  };
  const ana = open();
  const ben = open();
  ana.mine.text = "It rang once, in the flood.";
  ben.mine.notes = "Ask about the bell-ringer.";
  assert.ok(save(ana).entity);
  assert.ok(save(ben).entity, "a change to another field clashed");
  assert.equal(getLoreEntry(made.entity.id).body, "It rang once, in the flood.");
  assert.equal(named(id, "The Drowned Bell").entry.notes, "Ask about the bell-ringer.");
  const cara = open();
  const dan = open();
  cara.mine.text = "Cara's bell.";
  dan.mine.text = "Dan's bell.";
  assert.ok(save(cara).entity);
  const clash = save(dan);
  assert.equal(clash.status, 409);
  assert.deepEqual(clash.conflicts.map((conflict) => conflict.key), ["text"]);
  assert.equal(getLoreEntry(made.entity.id).body, "Cara's bell.", "a clashing save wrote");
  const again = open();
  again.mine.text = "Dan's bell.";
  assert.ok(save(again).entity, "the second author could not keep theirs");
  assert.equal(getLoreEntry(made.entity.id).body, "Dan's bell.");
});

await test("Reimport preserves the campaign's own lore text, secrets and map edits, and takes what only the source changed.", () => {
  const id = shop("M1 reimport");
  const first = loreFile([{ id: "e_bell", name: "The Drowned Bell", type: "Relic", summary: "It rings at low tide.", canon: "canon" }]);
  importWorldForge(id, owner, first);
  updateLoreEntry(named(id, "The Drowned Bell").id, { body: "The campaign's own account." });
  const doc = getWorldDoc(id);
  doc.secrets[0].partyKnows = true;
  doc.pins[0].x = 0.9;
  saveWorldDoc(id, doc);
  const changed = structuredClone(first);
  changed.entities.find((entity) => entity.id === "e_bell").summary = "The source's new account.";
  changed.entities.find((entity) => entity.id === "e_bell").notes = "A note from the source.";
  changed.secrets[0].notes = "The source's new notes.";
  const result = importWorldForge(id, owner, changed);
  const bell = named(id, "The Drowned Bell");
  assert.equal(accountOf(bell), "The campaign's own account.", "the reimport replaced the campaign's lore text");
  assert.equal(bell.entry.notes, "A note from the source.");
  assert.ok(result.conflicts.some((line) => /The Drowned Bell: kept your text/.test(line)), JSON.stringify(result.conflicts));
  const now = worldView(id).doc;
  assert.equal(now.secrets[0].partyKnows, true);
  assert.equal(now.secrets[0].notes, "The source's new notes.");
  assert.equal(now.pins.find((pin) => pin.name === "Gullhaven").x, 0.9);
});

await test("Two worlds with identical ids coexist, each keeping its own text.", () => {
  const id = shop("M1 two worlds");
  importWorldForge(id, owner, loreFile([{ id: "e_bell", name: "The Drowned Bell", type: "Relic", summary: "World A's bell.", canon: "canon" }]));
  const other = loreFile([{ id: "e_bell", name: "The Other Bell", type: "Relic", summary: "World B's bell.", canon: "canon" }]);
  other.worldName = "The Other March";
  for (const entity of other.entities) if (entity.id !== "e_bell") entity.name = `Other ${entity.name}`;
  other.calendars[0].name = "Other Reckoning";
  importWorldForge(id, owner, other);
  assert.equal(accountOf(named(id, "The Drowned Bell")), "World A's bell.");
  assert.equal(accountOf(named(id, "The Other Bell")), "World B's bell.");
  assert.equal(worldView(id).doc.calendars.length, 2);
});

await test("Export keeps pictures and prose: a place's picture and a 20,000-character lore text survive a bundle and a file.", () => {
  const from = shop("M1 export");
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
  const picture = `/uploads/m1-place-${Date.now()}.png`;
  fs.mkdirSync(path.join(process.cwd(), "public", "uploads"), { recursive: true });
  fs.writeFileSync(path.join(process.cwd(), "public", picture), png);
  createWorldEntity(from, { typeId: "t_location", name: "The Sluice Gate", text: "Iron and weed.", article: "A gate older than the town.", portrait: picture });
  const long = "The tide remembers what the town forgets. ".repeat(600).trim().slice(0, 20_000);
  createWorldEntity(from, { typeId: "t_other", name: "The Long Chronicle", text: long });
  const bundle = exportWorkshopBundle(from, { name: "M1 export", blurb: "A coast in pictures.", inspiredBy: "Original work" });
  assert.ok(bundle.bundle, bundle.error);
  fs.rmSync(path.join(process.cwd(), "public", picture));
  const read = readBundle(JSON.stringify(bundle.bundle));
  assert.ok(!("error" in read), read.error);
  const { workshopId } = importWorkshopBundle(owner.id, read.bundle);
  const gate = named(workshopId, "The Sluice Gate");
  assert.deepEqual(fs.readFileSync(path.join(process.cwd(), "public", gate.portrait)), png, "the place lost its picture");
  assert.equal(gate.text, "Iron and weed.");
  assert.equal(gate.entry.article, "A gate older than the town.");
  assert.equal(accountOf(named(workshopId, "The Long Chronicle")).length, long.length, "the bundle cut the lore text");
  const into = shop("M1 export, by file");
  const file = exportWorldForge(workshopId);
  assert.deepEqual(readWorldForge(file).losses, [], "ODM's own file names a loss");
  importWorldForge(into, owner, file);
  assert.equal(accountOf(named(into, "The Long Chronicle")).length, long.length, "the file cut the lore text");
  assert.equal(named(into, "The Sluice Gate").text, "Iron and weed.");
  assert.ok(named(into, "The Sluice Gate").portrait, "the file lost the place's picture");
});

await test("Incompatible versions and oversize content are named before anything is written.", () => {
  const newer = { ...clean(), version: 9 };
  assert.match(readWorldForge(newer).error ?? "", /format version 9/);
  const id = shop("M1 losses");
  assert.ok("error" in importWorldForge(id, owner, newer));
  assert.equal(worldView(id).entities.length, 0);
  const big = clean();
  big.entities[0].summary = "x".repeat(25_000);
  const read = readWorldForge(big);
  assert.match(read.losses.join(" "), /Ivo Brannock: its text is cut to 20,000 characters/);
  assert.equal(worldView(id).entities.length, 0, "reading a file wrote something");
});

world.close();
finish();
