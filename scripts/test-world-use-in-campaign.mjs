// Using a workshop's world in a campaign (audit finding WF-07). Ticking
// WorldForge brings the people, places, factions and lore it describes, so
// its links survive; leaving one of them out on purpose is named with
// exactly what goes. Factions are a choice of their own. A hand-built
// monster that a copied NPC or fight names, and that the campaign's authors
// do not have, is copied into the campaign's bestiary so it still fights.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";

const { test, finish } = suite("test-world-use-in-campaign");
const { runContentImport, planContentImport } = await import("../src/lib/db/content-import.ts");
const { createWorldEntity, getWorldDoc, saveWorldDoc, updateWorldEntity, worldView } = await import("../src/lib/db/world-forge.ts");
const { createHomebrew, listHomebrew } = await import("../src/lib/db/homebrew.ts");
const { createWorkshop } = await import("../src/lib/db/workshops.ts");
const { listFactions } = await import("../src/lib/db/factions.ts");
const { listNpcs } = await import("../src/lib/db/npcs.ts");
const { listLocations } = await import("../src/lib/db/locations.ts");
const { createHomebrewMonster, listHomebrewMonsters } = await import("../src/lib/bestiary/homebrew-monsters.ts");
const { draftFromCr } = await import("../src/lib/bestiary/monster-draft.ts");
const { insertEncounterTemplate, listEncounterTemplates } = await import("../src/lib/db/encounter-templates.ts");
const { resolveMonster } = await import("../src/lib/bestiary/index.ts");
const { tableAuthors } = await import("../src/lib/db/homebrew.ts");
const { getCampaignById } = await import("../src/lib/db/campaigns.ts");
const { getDatabase } = await import("../src/lib/db/core.ts");

const world = await openWorld();
const author = world.addUser("worldbuilder");
const recipient = world.addUser("other-dm");
const EMPTY_MAP = { mapId: null, seed: null, theme: null, ambient: null, width: null, height: null };

// A small world: a captain in a guild, her harbour, a legend, a second
// guild with no members, a link, a pin and a secret.
function builtWorld(title) {
  const id = createWorkshop(author.id, { title }).id;
  const guild = createWorldEntity(id, { typeId: "t_faction", name: "The Reed Court" }).entity;
  createWorldEntity(id, { typeId: "t_faction", name: "The Lantern Guild" });
  const captain = createWorldEntity(id, { typeId: "t_character", name: "Captain Mara" }).entity;
  getDatabase().prepare(`UPDATE npcs SET faction_id = ? WHERE id = ?`).run(guild.id, captain.id);
  const harbour = createWorldEntity(id, { typeId: "t_location", name: "Gullhaven", text: "A harbour." }).entity;
  createWorldEntity(id, { typeId: "t_other", name: "The Drowned Bell", text: "It rings at low tide." });
  const doc = getWorldDoc(id);
  doc.links.push({ id: "l_home", from: captain.ref, to: harbour.ref, label: "lives in", veracity: "known", oneway: false, rank: "" });
  doc.maps.push({ id: "m_coast", name: "The coast", image: "", parentPinId: "", regions: [] });
  doc.pins.push({ id: "p_gull", mapId: "m_coast", x: 0.5, y: 0.5, name: "Gullhaven", ref: harbour.ref, linkedMapId: "", notes: "" });
  doc.secrets.push({ id: "s_bell", title: "The bell is a warning", subject: captain.ref, notes: "", knownBy: [], partyKnows: false });
  saveWorldDoc(id, doc);
  return id;
}

await test("Ticking WorldForge alone brings the people, places, factions and lore it describes, and its links survive.", () => {
  const source = builtWorld("World alone");
  const target = createWorkshop(author.id, { title: "Campaign A" }).id;
  const plan = planContentImport(source, target, ["world"]);
  assert.ok(plan.notes.some((note) => /WorldForge brings what it describes/.test(note.message)), JSON.stringify(plan.notes));
  assert.deepEqual(plan.warnings, []);
  const outcome = runContentImport({ sourceId: source, campaignId: target, selection: ["world"], houseRulesMode: "replace" });
  assert.ok(!outcome.error, outcome.error);
  assert.equal(listNpcs(target).length, 1, "the captain stayed behind");
  assert.equal(listLocations(target).length, 1, "the harbour stayed behind");
  assert.equal(listFactions(target).length, 2, "the factions stayed behind");
  const { doc, entities } = worldView(target);
  assert.equal(entities.length, 5);
  assert.equal(doc.links.length, 1, "the world's link was dropped");
  assert.ok(doc.pins[0].ref, "the pin lost its place");
  assert.ok(doc.secrets[0].subject, "the secret lost its subject");
});

await test("Leaving places out on purpose is named with exactly what WorldForge drops, and they stay behind.", () => {
  const source = builtWorld("Without places");
  const target = createWorkshop(author.id, { title: "Campaign B" }).id;
  const plan = planContentImport(source, target, ["world"], { exclude: ["locations"] });
  const said = plan.warnings.map((warning) => warning.message).join("\n");
  assert.match(said, /Leaving out places: WorldForge drops 1 World entry, 1 link and 1 map pin with them\./);
  const outcome = runContentImport({ sourceId: source, campaignId: target, selection: ["world"], exclude: ["locations"], houseRulesMode: "replace" });
  assert.ok(!outcome.error, outcome.error);
  assert.equal(listLocations(target).length, 0);
  assert.equal(listNpcs(target).length, 1);
  assert.equal(worldView(target).doc.links.length, 0);
});

await test("Factions are a choice of their own, and NPCs alone bring only the factions their members belong to.", () => {
  const source = builtWorld("Factions");
  const onlyFactions = createWorkshop(author.id, { title: "Campaign C" }).id;
  const outcome = runContentImport({ sourceId: source, campaignId: onlyFactions, selection: ["factions"], houseRulesMode: "replace" });
  assert.ok(!outcome.error, outcome.error);
  assert.deepEqual(listFactions(onlyFactions).map((faction) => faction.name).sort(), ["The Lantern Guild", "The Reed Court"]);
  assert.equal(listNpcs(onlyFactions).length, 0);
  const onlyNpcs = createWorkshop(author.id, { title: "Campaign D" }).id;
  runContentImport({ sourceId: source, campaignId: onlyNpcs, selection: ["npcs"], houseRulesMode: "replace" });
  assert.deepEqual(listFactions(onlyNpcs).map((faction) => faction.name), ["The Reed Court"], "a faction with no member came with the NPCs");
  assert.equal(listNpcs(onlyNpcs)[0].factionId, listFactions(onlyNpcs)[0].id);
});

await test("A hand-built monster the campaign's authors do not have comes into its bestiary, and the NPC and the fight fight as it.", () => {
  // The author's campaign, run by the other DM, imported into the other DM's own.
  const hag = createHomebrewMonster(author.id, draftFromCr("Marsh Hag", 3), "She waits in the reeds.");
  const source = createWorkshop(author.id, { title: "The Fen" }).id;
  const npc = createWorldEntity(source, { typeId: "t_character", name: "Old Wenna" }).entity;
  getDatabase().prepare(`UPDATE npcs SET stat_block = ? WHERE id = ?`).run(`homebrew:${hag.id}`, npc.id);
  insertEncounterTemplate({ campaignId: source, name: "The hag's pool", enemies: [{ monster: `homebrew:${hag.id}`, count: 1 }], battlefield: "", map: EMPTY_MAP, notes: "", createdByUserId: author.id });
  const target = createWorkshop(recipient.id, { title: "Other table" }).id;

  const plan = planContentImport(source, target, ["npcs", "encounters"]);
  assert.ok(plan.notes.some((note) => /hand-built monster \(Marsh Hag\) is copied into this table's bestiary/.test(note.message)), JSON.stringify(plan.notes));
  assert.ok(!plan.warnings.some((warning) => /hand-built/.test(warning.message)), "the old warning still says the roster will not resolve");

  const outcome = runContentImport({ sourceId: source, campaignId: target, selection: ["npcs", "encounters"], houseRulesMode: "replace" });
  assert.ok(!outcome.error, outcome.error);
  assert.deepEqual(outcome.monstersBrought, ["Marsh Hag"]);
  assert.equal(outcome.unresolved, undefined, `references left unresolved: ${outcome.unresolved}`);
  const setting = getCampaignById(target).gameSettings;
  const authors = { userIds: tableAuthors(target) };
  const copy = listHomebrewMonsters(recipient.id).find((monster) => monster.draft.name === "Marsh Hag");
  assert.ok(copy, "the hag is not in the other DM's bestiary");
  assert.equal(resolveMonster(listNpcs(target)[0].statBlock, setting, authors)?.slug, copy.slug);
  assert.equal(resolveMonster(listEncounterTemplates(target)[0].enemies[0].monster, setting, authors)?.slug, copy.slug);

  // A second import reuses the copy rather than adding another.
  const again = runContentImport({ sourceId: source, campaignId: target, selection: ["npcs", "encounters"], houseRulesMode: "replace", again: "copy" });
  assert.deepEqual(again.monstersReused, ["Marsh Hag"]);
  assert.equal(listHomebrewMonsters(recipient.id).filter((monster) => monster.draft.name === "Marsh Hag").length, 1);
});

await test("An owner's own monster of the same name with other rules stays theirs; the import's arrives beside it.", () => {
  const imp = createHomebrewMonster(author.id, draftFromCr("Bog Imp", 2), "");
  createHomebrewMonster(recipient.id, draftFromCr("Bog Imp", 5), "Mine.");
  const source = createWorkshop(author.id, { title: "The Bog" }).id;
  const npc = createWorldEntity(source, { typeId: "t_character", name: "Squelch" }).entity;
  getDatabase().prepare(`UPDATE npcs SET stat_block = ? WHERE id = ?`).run(`homebrew:${imp.id}`, npc.id);
  const target = createWorkshop(recipient.id, { title: "Bog table" }).id;
  const outcome = runContentImport({ sourceId: source, campaignId: target, selection: ["npcs"], houseRulesMode: "replace" });
  assert.deepEqual(outcome.monstersBrought, ["Bog Imp [The Bog]"]);
  const mine = listHomebrewMonsters(recipient.id).filter((monster) => monster.draft.name.startsWith("Bog Imp"));
  assert.equal(mine.length, 2, "the owner's own Bog Imp was changed or replaced");
});

await test("The import route sends back what it used to drop: the monsters nothing here answers to.", async () => {
  const source = createWorkshop(author.id, { title: "Loose ends" }).id;
  const npc = createWorldEntity(source, { typeId: "t_character", name: "Ghost Pilot" }).entity;
  getDatabase().prepare(`UPDATE npcs SET stat_block = ? WHERE id = ?`).run("Nonexistent Wraithling", npc.id);
  const target = createWorkshop(author.id, { title: "Loose ends, played" }).id;
  const route = await world.route("campaigns/[campaignId]/import");
  world.signIn({ id: author.id });
  const response = await route.POST(new Request("http://test/", { method: "POST", body: JSON.stringify({ sourceId: source, select: ["npcs"] }) }), {
    params: Promise.resolve({ campaignId: target }),
  });
  const json = await response.json();
  assert.equal(response.status, 200, JSON.stringify(json));
  assert.deepEqual(json.unresolved, ["Nonexistent Wraithling"]);
});

await test("A World entry's links to another author's monster and item arrive working: both are copied into the table's own shelves and the links point at the copies.", () => {
  const wyrm = createHomebrewMonster(author.id, draftFromCr("Tidewyrm", 4), "Coils under the wall.");
  const lantern = createHomebrew(author.id, { kind: "item", name: "Drowned Lantern", data: { desc: "It burns under water." } });
  const source = createWorkshop(author.id, { title: "Linked world" }).id;
  const article = createWorldEntity(source, { typeId: "t_other", name: "The Tidewyrm", text: "It coils under the sea wall." }).entity;
  const linked = updateWorldEntity(source, article.ref, { bindings: [{ kind: "monster", ref: `homebrew:${wyrm.id}` }, { kind: "item", ref: `homebrew:${lantern.id}` }] });
  assert.ok(linked.entity, linked.error);
  const target = createWorkshop(recipient.id, { title: "Linked table" }).id;

  const plan = planContentImport(source, target, ["world"]);
  const notes = plan.notes.map((note) => note.message).join(" ");
  assert.match(notes, /hand-built monster \(Tidewyrm\) is copied into this table's bestiary/);
  assert.match(notes, /hand-built item \(Drowned Lantern\) is copied into this table's Homebrew/);

  const outcome = runContentImport({ sourceId: source, campaignId: target, selection: ["world"], houseRulesMode: "replace" });
  assert.ok(!outcome.error, outcome.error);
  assert.deepEqual(outcome.monstersBrought, ["Tidewyrm"]);
  assert.deepEqual(outcome.itemsBrought, ["Drowned Lantern"]);
  const copy = worldView(target).entities.find((entity) => entity.name === "The Tidewyrm");
  assert.deepEqual(copy.bound.map((record) => [record.kind, record.name, record.found]), [["monster", "Tidewyrm", true], ["item", "Drowned Lantern", true]]);
  assert.ok(copy.bound.every((record) => !record.ref.includes(wyrm.id) && !record.ref.includes(lantern.id)), "a link still points at the other author's record");
  assert.ok(listHomebrew(recipient.id, "item").some((item) => item.name === "Drowned Lantern"));
});

await test("The same author's links need nothing copied: they already work at the table.", () => {
  const ooze = createHomebrewMonster(author.id, draftFromCr("Silt Ooze", 1), "");
  const source = createWorkshop(author.id, { title: "Own world" }).id;
  const article = createWorldEntity(source, { typeId: "t_other", name: "The Silt Ooze" }).entity;
  updateWorldEntity(source, article.ref, { bindings: [{ kind: "monster", ref: `homebrew:${ooze.id}` }] });
  const target = createWorkshop(author.id, { title: "Own table" }).id;
  const outcome = runContentImport({ sourceId: source, campaignId: target, selection: ["world"], houseRulesMode: "replace" });
  assert.equal(outcome.monstersBrought, undefined);
  const copy = worldView(target).entities.find((entity) => entity.name === "The Silt Ooze");
  assert.equal(copy.bound[0].ref, `homebrew:${ooze.id}`);
  assert.equal(copy.bound[0].found, true);
});

world.close();
finish();
