// A prepared world reaching play, travelling and being edited by two people
// at once (docs/workshop-rulebook-audit-pr169.md F14, F15, F16, F17):
//
//   - What an entry's article and fields say reaches the AI DM when that
//     entry is in play, however late it was written; hidden truths stay the
//     DM's; a draft is marked, a retired entry left out (F14).
//   - Opening the same world again updates the links nobody changed here,
//     drops the ones the source dropped, and names the ones both sides
//     changed instead of overwriting either (F15).
//   - Two editors saving different rows of one slice keep both; a row both
//     changed keeps the first and names the second (F16).
//   - Two bundles with different monsters of one name land side by side,
//     each adventure pointing at its own; an export can carry only what the
//     workshop uses and names what it uses that answers to nothing (F17).
import assert from "node:assert/strict";
import fs from "node:fs";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";

const { test, finish } = suite("test-workshop-world-sync");
const { readBundle } = await import("../src/lib/workshop/bundle.ts");
const { exportWorkshopBundle, importWorkshopBundle } = await import("../src/lib/db/workshop-bundle.ts");
const { applyWorldImport, importWorldForge } = await import("../src/lib/db/world-forge-io.ts");
const { worldView, createWorldEntity, updateWorldEntity, patchWorldDoc } = await import("../src/lib/db/world-forge.ts");
const { runContentImport } = await import("../src/lib/db/content-import.ts");
const { worldForPrompt } = await import("../src/lib/dm/world-prompt.ts");
const { docOps } = await import("../src/lib/worldforge/ops.ts");
const { createWorkshop } = await import("../src/lib/db/workshops.ts");
const { createHomebrewMonster, listHomebrewMonsters } = await import("../src/lib/bestiary/homebrew-monsters.ts");
const { draftFromCr } = await import("../src/lib/bestiary/monster-draft.ts");
const { insertEncounterTemplate, listEncounterTemplates } = await import("../src/lib/db/encounter-templates.ts");
const { createNpcFromDraft, listNpcs } = await import("../src/lib/db/npcs.ts");
const { normalizeNpcDraft } = await import("../src/lib/npcs/forge.ts");
const { resolveMonster } = await import("../src/lib/bestiary/index.ts");

const raw = fs.readFileSync(new URL("./fixtures/worldforge-saltmarch.json", import.meta.url), "utf8");
const world = await openWorld();
const owner = { id: world.owner.id };

function openAsWorkshop(text) {
  const read = readBundle(text);
  assert.ok(!("error" in read), read.error);
  const { workshopId } = importWorkshopBundle(owner.id, read.bundle);
  const result = applyWorldImport(workshopId, owner, read.worldForge);
  assert.ok(!("error" in result), result.error);
  return workshopId;
}

const workshopId = openAsWorkshop(raw);
const view = (id = workshopId) => worldView(id);
const entity = (name, id = workshopId) => view(id).entities.find((entry) => entry.name === name);
const make = (fields) => {
  const made = createWorldEntity(workshopId, fields);
  assert.ok("entity" in made, made.error);
  return made.entity;
};

// ---- F14: what reaches the AI DM ----

await test("F14: a fact written only in an NPC's article reaches the DM when the NPC is named in play, and not otherwise.", () => {
  make({ typeId: "t_character", name: "Mara Quill", article: "Mara keeps the lighthouse key under the third step of the tower." });
  assert.match(worldForPrompt(workshopId, { text: "We ask Mara Quill about the tower." }).block, /third step of the tower/);
  assert.doesNotMatch(worldForPrompt(workshopId, { text: "We walk the sea wall." }).block, /third step/, "an entry nobody named was sent anyway");
});

await test("F14: an entry written after sixty others is found as surely as the first.", () => {
  for (let index = 0; index < 60; index += 1) make({ typeId: "t_other", name: `Ledger Page ${index}`, article: `Page ${index} of the tide ledger.` });
  make({ typeId: "t_other", name: "The Drowned Bell", article: "The bell rings only when the sluice gates fail." });
  const block = worldForPrompt(workshopId, { text: "Someone mentions the Drowned Bell." }).block;
  assert.match(block, /rings only when the sluice gates fail/);
  assert.doesNotMatch(block, /Page 0 of the tide ledger/);
});

await test("F14: an entry's fields go with its article; its hidden truth is marked the DM's.", () => {
  const character = view().doc.types.find((type) => type.id === "t_character");
  const field = character.fields.find((entry) => entry.id === "f_species");
  assert.ok(field && !field.authorOnly, "the Character type has no Species field for players");
  const mara = entity("Mara Quill");
  updateWorldEntity(workshopId, mara.ref, { fields: { [field.id]: "Lamplighter" }, hiddenTruth: "Mara drowned the last keeper." });
  const { block, npcNotes } = worldForPrompt(workshopId, { text: "Mara Quill waves." });
  assert.match(block, new RegExp(`${field.name}: Lamplighter`));
  // A Cast member's hidden truth rides on their own line of the roster.
  assert.match(npcNotes.get("Mara Quill"), /secretly: Mara drowned the last keeper/);
  assert.match(block, /anything marked secretly is the DM's/);
});

await test("F14: a draft entry is marked as not canon yet, and a retired one is left out.", () => {
  make({ typeId: "t_other", name: "The Pale Tithe", article: "A tax paid in salt.", canon: "draft" });
  make({ typeId: "t_other", name: "The Old Tithe", article: "A tax long abolished.", canon: "retired" });
  const block = worldForPrompt(workshopId, { text: "The Pale Tithe and the Old Tithe come up." }).block;
  assert.match(block, /The Pale Tithe \[draft: not canon yet/);
  assert.doesNotMatch(block, /long abolished/);
});

await test("F14: a world that travelled into a campaign reaches that campaign's DM the same way.", () => {
  const outcome = runContentImport({ sourceId: workshopId, campaignId: world.campaignId, selection: ["npcs", "locations", "lore", "world"], houseRulesMode: "replace" });
  assert.ok(!("error" in outcome), outcome.error);
  assert.match(worldForPrompt(world.campaignId, { text: "Mara Quill opens the door." }).block, /third step of the tower/);
});

// ---- F15: opening the same world again ----

const source = JSON.parse(raw);
const ivoLinks = () => source.entities.find((entry) => entry.id === "e_ivo").links;
const linkIn = (label, id = workshopId) => view(id).doc.links.filter((link) => link.label === label);

await test("F15: opening the same world again updates a link's veracity, direction and a membership's rank, with no second copy.", () => {
  Object.assign(ivoLinks().find((link) => link.label === "mentor of"), { veracity: "believed", oneway: true });
  ivoLinks().find((link) => link.label === "member of").rank = "Captain";
  const again = importWorldForge(workshopId, owner, source);
  assert.ok(!("error" in again), again.error);
  const mentor = linkIn("mentor of");
  assert.equal(mentor.length, 1, "the link was doubled");
  assert.deepEqual([mentor[0].veracity, mentor[0].oneway], ["believed", true]);
  assert.equal(linkIn("member of")[0].rank, "Captain");
  assert.ok(again.linksUpdated >= 2);
});

await test("F15: a link the source dropped goes, and one changed on both sides is kept as it is here and named.", () => {
  const [lives] = linkIn("lives in");
  patchWorldDoc(workshopId, { links: view().doc.links.map((link) => (link.id === lives.id ? { ...link, veracity: "believed" } : link)) });
  ivoLinks().find((link) => link.label === "lives in").veracity = "hidden";
  source.entities.find((entry) => entry.id === "e_gull").links = [];
  const again = importWorldForge(workshopId, owner, source);
  assert.ok(!("error" in again), again.error);
  assert.equal(linkIn("road to").length, 0, "a link the source dropped is still here");
  assert.ok(again.linksRemoved >= 1);
  const [kept] = linkIn("lives in");
  assert.equal(kept.veracity, "believed", "the change made here was overwritten");
  assert.ok(again.conflicts.some((line) => /lives in/.test(line)), "the conflict was not named");
});

// ---- F16: two editors ----

await test("F16: two editors saving different links of one slice keep both; one link both changed keeps the first and names the second.", () => {
  const seen = view().doc;
  const [a, b] = seen.links;
  const first = docOps(seen, { links: seen.links.map((link) => (link.id === a.id ? { ...link, label: "First" } : link)) });
  const second = docOps(seen, { links: seen.links.map((link) => (link.id === b.id ? { ...link, label: "Second" } : link)) });
  assert.deepEqual(patchWorldDoc(workshopId, { ops: first }).conflicts, []);
  assert.deepEqual(patchWorldDoc(workshopId, { ops: second }).conflicts, [], "a change to another row was refused");
  const after = view().doc.links;
  assert.equal(after.find((link) => link.id === a.id).label, "First");
  assert.equal(after.find((link) => link.id === b.id).label, "Second", "the second editor's link was lost");
  const late = docOps(seen, { links: seen.links.map((link) => (link.id === a.id ? { ...link, label: "Late" } : link)) });
  const clash = patchWorldDoc(workshopId, { ops: late });
  assert.equal(clash.conflicts.length, 1);
  assert.equal(view().doc.links.find((link) => link.id === a.id).label, "First", "the stale save overwrote the first");
  const gone = docOps(seen, { links: seen.links.filter((link) => link.id !== a.id) });
  assert.equal(patchWorldDoc(workshopId, { ops: gone }).conflicts.length, 1, "a row changed since was deleted silently");
  assert.ok(view().doc.links.some((link) => link.id === a.id));
  const added = docOps(seen, { links: [...seen.links, { id: "l-new", from: a.from, to: a.to, label: "owes", veracity: "known", oneway: false, rank: "" }] });
  assert.deepEqual(patchWorldDoc(workshopId, { ops: added }).conflicts, []);
  assert.equal(view().doc.links.find((link) => link.id === b.id).label, "Second", "an add from a stale view rolled another row back");
});

// ---- F17: bundles with the same monster name ----

const manifest = (name) => ({ name, blurb: `The ${name} adventure.`, version: "1.0.0", author: "A tester", homepage: "", inspiredBy: "Original work", rightsHolder: "" });
const npcDraft = (fields) => {
  const outcome = normalizeNpcDraft(fields);
  assert.ok("draft" in outcome, outcome.error);
  return outcome.draft;
};

function authoredWorkshop(title, hp) {
  const author = world.addUser("author");
  const shop = createWorkshop(author.id, { title });
  const hag = createHomebrewMonster(author.id, { ...draftFromCr("Marsh Hag", 3), stats: { ...draftFromCr("Marsh Hag", 3).stats, maxHp: hp } }, "");
  createHomebrewMonster(author.id, draftFromCr("Unused Ooze", 1), "");
  insertEncounterTemplate({ campaignId: shop.id, name: "The hag's pool", enemies: [{ monster: "Marsh Hag", count: 1 }], battlefield: "", map: { mapId: null, seed: null, theme: null, ambient: null, width: null, height: null }, notes: "", createdByUserId: author.id });
  createNpcFromDraft(shop.id, npcDraft({ name: "Old Wenna", attitude: "hostile", statBlock: `homebrew:${hag.id}` }));
  createNpcFromDraft(shop.id, npcDraft({ name: "Ghost Pilot", attitude: "hostile", statBlock: "Nonexistent Wraithling" }));
  return shop;
}

const recipient = world.addUser("recipient");
const shopA = authoredWorkshop("Fen A", 40);
const shopB = authoredWorkshop("Fen B", 90);

await test("F17: an export can carry only what the workshop uses, and names what it left out and what answers to nothing.", () => {
  const used = exportWorkshopBundle(shopA.id, { ...manifest("Fen A"), shelf: "used" });
  assert.ok(!("error" in used), used.error);
  assert.deepEqual(used.bundle.monsters.map((monster) => monster.name), ["Marsh Hag"]);
  assert.ok(used.shelf.unused.some((line) => /Unused Ooze/.test(line)), "the left-out monster is not named");
  assert.ok(used.shelf.missing.some((line) => /Nonexistent Wraithling/.test(line)), "the missing dependency is not named");
  const all = exportWorkshopBundle(shopA.id, manifest("Fen A"));
  assert.ok(all.bundle.monsters.some((monster) => monster.name === "Unused Ooze"), "the whole shelf did not travel by default");
});

await test("F17: two bundles with different monsters of one name land side by side, each adventure fighting its own.", () => {
  const a = importWorkshopBundle(recipient.id, exportWorkshopBundle(shopA.id, { ...manifest("Fen A"), shelf: "used" }).bundle);
  const b = importWorkshopBundle(recipient.id, exportWorkshopBundle(shopB.id, { ...manifest("Fen B"), shelf: "used" }).bundle);
  assert.ok(!("error" in a) && !("error" in b));
  assert.ok(b.shelf.renamed.some((line) => /Marsh Hag/.test(line)), "the clash was not reported");
  const hpOf = (ref) => resolveMonster(ref, { genre: "high-fantasy" }, { userIds: [recipient.id] })?.stats?.maxHp;
  const [poolA] = listEncounterTemplates(a.workshopId);
  const [poolB] = listEncounterTemplates(b.workshopId);
  assert.equal(hpOf(poolA.enemies[0].monster), 40, "bundle A's fight changed monster");
  assert.equal(hpOf(poolB.enemies[0].monster), 90, "bundle B's fight fights bundle A's hag");
  const wenna = (id) => listNpcs(id).find((npc) => npc.name === "Old Wenna").statBlock;
  assert.equal(hpOf(wenna(a.workshopId)), 40);
  assert.equal(hpOf(wenna(b.workshopId)), 90, "bundle B's NPC fights as bundle A's hag");
});

await test("F17: the same bundle opened twice reuses its monster rather than doubling it.", () => {
  const before = listHomebrewMonsters(recipient.id).length;
  const again = importWorkshopBundle(recipient.id, exportWorkshopBundle(shopA.id, { ...manifest("Fen A"), shelf: "used" }).bundle);
  assert.ok(again.shelf.reused.some((line) => /Marsh Hag/.test(line)));
  assert.equal(listHomebrewMonsters(recipient.id).length, before, "the same monster was copied twice");
});

await test("F17: a campaign import names the monsters its Cast or fights use that answer to nothing at the table.", () => {
  const table = createWorkshop(recipient.id, { title: "Elsewhere" });
  const outcome = runContentImport({ sourceId: shopA.id, campaignId: table.id, selection: ["npcs", "encounters"], houseRulesMode: "replace" });
  assert.ok(!("error" in outcome), outcome.error);
  assert.ok((outcome.unresolved ?? []).includes("Nonexistent Wraithling"), JSON.stringify(outcome.unresolved));
});

world.close();
finish();
