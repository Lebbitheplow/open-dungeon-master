// Issue 580, through the engine the way the DM reaches it: the Bonds panel
// listed nobody the party travelled with, because a bond opened only when a
// roll or a moment named one character.
//   - a companion who joins has a bond with every character, and so does an
//     NPC the party meets (a reaction roll, a social check, an attitude the
//     story gives someone already registered), never one only registered;
//   - a deed lands on whoever it was done to, harder than on a witness;
//   - a death closes every character's bond with the dead, a fallen
//     companion's too, and nobody is asked to bring them back;
//   - a renamed or merged NPC keeps their bonds.
import assert from "node:assert/strict";
import "./lib/enforce-campaign.mjs";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";

const { test, finish } = suite("test-enforce-bonds-580");
const npcs = await import("../src/lib/db/npcs.ts");
const relationships = await import("../src/lib/db/relationships.ts");
const facts = await import("../src/lib/db/facts.ts");
const { advanceRelationships } = await import("../src/lib/dm/relationship-tick.ts");
const { doneToDelta } = await import("../src/lib/dm/companion-values-logic.ts");
const { endedByDeath } = await import("../src/lib/dm/relationship-logic.ts");

async function table({ gameSettings = {} } = {}) {
  const world = await openWorld({ gameSettings: { companions: "full", ...gameSettings } });
  const kael = world.addHero({ name: "Kael", gender: "Male" });
  const lyra = world.addHero({ name: "Lyra", gender: "Female" });
  const bond = (who, subject) => relationships.getRelationship(world.campaignId, who.id, subject);
  const prepare = (name, attitude) => npcs.upsertNpc({ campaignId: world.campaignId, name, attitude, gender: "Female" });
  return { world, kael, lyra, bond, prepare };
}

await test("a companion who joins has a bond with every character, at neutral; a guest for one fight has none", async () => {
  const { world, kael, lyra, bond } = await table();
  const added = await world.invoke("add_companion", { name: "Seren", class: "paladin", gender: "Female", personality: "Stern and devout.", kind: "party" });
  assert.equal(added.ok, true, added.error);
  for (const hero of [kael, lyra]) {
    const row = bond(hero, "Seren");
    assert.ok(row, `${hero.name} has no bond with the companion`);
    assert.equal(row.approval, 0);
    assert.equal(row.subjectKind, "companion");
    assert.equal(row.status, "active");
  }
  const guest = await world.invoke("add_companion", { name: "Dace", class: "fighter", gender: "Male", personality: "Hired blade.", kind: "guest" });
  assert.equal(guest.ok, true, guest.error);
  assert.equal(bond(kael, "Dace"), null, "a guest is scene-scoped");
});

await test("an NPC a bundle prepared as friendly opens every bond once the story gives their attitude, and is met", async () => {
  const { world, kael, lyra, bond, prepare } = await table();
  prepare("Mira", "friendly");
  const told = await world.invoke("set_npc", { name: "Mira", attitude: "friendly" });
  assert.equal(told.ok, true, told.error);
  assert.ok(bond(kael, "Mira") && bond(lyra, "Mira"), "both characters have a bond");
  assert.notEqual(npcs.getNpcByName(world.campaignId, "Mira").metAt, "", "set_npc's attitude on someone registered is meeting them");
});

await test("registering someone the party has only heard of opens nothing, attitude or not", async () => {
  const { world, kael, bond } = await table();
  const villain = await world.invoke("set_npc", { name: "The Ashen Abbot", attitude: "hostile", gender: "Male" });
  assert.equal(villain.ok, true, villain.error);
  assert.equal(bond(kael, "The Ashen Abbot"), null, "a first registration is not a meeting");
  assert.equal(npcs.getNpcByName(world.campaignId, "The Ashen Abbot").metAt, "");
  const update = await world.invoke("set_npc", { name: "The Ashen Abbot", location: "The abbey" });
  assert.equal(update.ok, true, update.error);
  assert.equal(bond(kael, "The Ashen Abbot"), null, "an update with no attitude is not a meeting either");
});

await test("an attitude the story shifts opens any bond still missing", async () => {
  const { world, kael, lyra, bond, prepare } = await table();
  const npc = prepare("Osric", "indifferent");
  npcs.markNpcMet(npc.id);
  relationships.ensureRelationship({ campaignId: world.campaignId, characterId: kael.id, characterName: kael.name, subjectKind: "npc", subjectName: "Osric" });
  await world.invoke("set_npc", { name: "Osric", attitude: "hostile" });
  assert.ok(bond(lyra, "Osric"), "the shift is the whole party's business");
});

await test("a reaction roll and a first social check open the whole party's bonds", async () => {
  const { world, kael, lyra, bond, prepare } = await table();
  world.dice(4, 4);
  const met = await world.invoke("npc_reaction", { name: "Brother Aldo", gender: "Male" });
  assert.equal(met.ok, true, met.error);
  assert.ok(bond(kael, "Brother Aldo") && bond(lyra, "Brother Aldo"));
  prepare("Tamsin", "indifferent");
  world.dice(10);
  const talked = await world.invoke("social_check", { characterId: kael.id, npc: "Tamsin", approach: "persuade" });
  assert.equal(talked.ok, true, talked.error);
  assert.ok(bond(lyra, "Tamsin"), "the character who did not talk has a bond too");
});

await test("a deed lands on whoever it was done to, at face value and harder than on a witness", async () => {
  const { world, kael, bond, prepare } = await table();
  prepare("Witness C", "indifferent");
  prepare("Captive D", "indifferent");
  const deed = await world.invoke("relationship_beat", { characterId: kael.id, subject: "Witness C", beat: "cruelty", severity: "minor", victims: ["Captive D"] });
  assert.equal(deed.ok, true, deed.error);
  const captive = bond(kael, "Captive D");
  assert.ok(captive, "the captive keeps a bond");
  assert.equal(captive.approval, doneToDelta("cruelty", -10, "minor"));
  assert.ok(captive.approval < bond(kael, "Witness C").approval, "it costs more with the one it was done to");
  assert.deepEqual(deed.result.victims.map((victim) => victim.subject), ["Captive D"]);
  // The one spared is grateful, whatever their nature.
  prepare("Bandit E", "hostile");
  const spared = await world.invoke("relationship_beat", { characterId: kael.id, subject: "Witness C", beat: "mercy", victims: ["Bandit E"] });
  assert.equal(spared.ok, true, spared.error);
  assert.ok(bond(kael, "Bandit E").approval > 0);
});

await test("a name in both lists counts once, as a victim, the subject's included", async () => {
  const { world, kael, bond, prepare } = await table();
  prepare("Prisoner F", "indifferent");
  const deed = await world.invoke("relationship_beat", { characterId: kael.id, subject: "Prisoner F", beat: "torture", victims: ["Prisoner F"], witnesses: ["Prisoner F"] });
  assert.equal(deed.ok, true, deed.error);
  assert.equal(bond(kael, "Prisoner F").approval, doneToDelta("torture", -12, "serious"));
  assert.ok(!deed.result.witnesses, "not also a witness");
});

await test("a deed done to the dead lands on nobody's regard", async () => {
  const { world, kael, bond, prepare } = await table();
  prepare("Priest G", "friendly");
  prepare("Old Corpse", "indifferent");
  const deed = await world.invoke("relationship_beat", { characterId: kael.id, subject: "Priest G", beat: "laid_to_rest", victims: ["Old Corpse"] });
  assert.equal(deed.ok, true, deed.error);
  assert.equal(bond(kael, "Old Corpse"), null);
  assert.match(deed.result.note, /done to the dead/);
});

await test("a death closes every character's bond with the dead, says died, and nobody is asked to bring them back", async () => {
  const { world, kael, lyra, bond, prepare } = await table();
  prepare("Hesper", "friendly");
  for (const hero of [kael, lyra]) {
    const row = relationships.ensureRelationship({ campaignId: world.campaignId, characterId: hero.id, characterName: hero.name, subjectKind: "npc", subjectName: "Hesper" });
    relationships.patchRelationship(row.id, { approval: 70 });
  }
  const ended = await world.invoke("relationship_end", { characterId: kael.id, subject: "Hesper", reason: "death" });
  assert.equal(ended.ok, true, ended.error);
  for (const hero of [kael, lyra]) {
    assert.equal(bond(hero, "Hesper").status, "ended", `${hero.name}'s bond is still open`);
    assert.ok(endedByDeath(bond(hero, "Hesper")));
  }
  for (let chapter = 0; chapter < 4; chapter += 1) {
    advanceRelationships(world.campaignId, "The party travels north.");
  }
  assert.ok(!facts.listActiveFacts(world.campaignId).some((fact) => /Hesper/.test(fact.fact)), "the GM was asked to bring the dead back");
  const after = await world.invoke("relationship_beat", { characterId: lyra.id, subject: "Hesper", beat: "helped" });
  assert.match(after.error, /Hesper is dead/);
  world.signIn(world.owner);
  const route = await world.route("campaigns/[campaignId]/relationships");
  const view = await (await route.GET(new Request("http://test/"), { params: Promise.resolve({ campaignId: world.campaignId }) })).json();
  assert.ok(view.relationships.filter((row) => row.subjectName === "Hesper").every((row) => row.died === true), "the Bonds panel says died");
});

await test("a companion who fell and is dismissed is dead, not away, and comes back whole if brought back", async () => {
  const { world, kael, lyra, bond } = await table();
  await world.invoke("add_companion", { name: "Seren", class: "paladin", gender: "Female", personality: "Stern and devout.", kind: "party" });
  const sheet = world.sheets().find((entry) => entry.name === "Seren");
  relationships.patchRelationship(bond(kael, "Seren").id, { approval: 65 });
  world.patch(sheet.id, { deathSaves: { successes: 0, failures: 3, stable: false, dead: true } });
  const dismissed = await world.invoke("dismiss_companion", { characterId: sheet.id, reason: "she fell at the bridge" });
  assert.equal(dismissed.ok, true, dismissed.error);
  assert.ok(endedByDeath(bond(kael, "Seren")) && endedByDeath(bond(lyra, "Seren")), "a fallen companion's bonds close on the death");
  const raised = await world.invoke("add_companion", { name: "Seren", class: "paladin", gender: "Female", personality: "Stern and devout.", kind: "party" });
  assert.equal(raised.ok, true, raised.error);
  assert.equal(bond(kael, "Seren").status, "active", "brought back to life, the bond opens again");
  assert.equal(bond(kael, "Seren").approval, 65, "where it stopped");
});

await test("a companion who walks away alive is parted, as before", async () => {
  const { world, kael, bond } = await table();
  await world.invoke("add_companion", { name: "Seren", class: "paladin", gender: "Female", personality: "Stern and devout.", kind: "party" });
  const sheet = world.sheets().find((entry) => entry.name === "Seren");
  await world.invoke("dismiss_companion", { characterId: sheet.id, reason: "she goes home" });
  assert.equal(bond(kael, "Seren").status, "parted");
});

await test("a renamed NPC keeps their bonds, and a merged one folds into the keeper", async () => {
  const { world, kael, lyra, bond, prepare } = await table();
  const stranger = prepare("Hooded Stranger", "indifferent");
  const early = relationships.ensureRelationship({ campaignId: world.campaignId, characterId: kael.id, characterName: kael.name, subjectKind: "npc", subjectName: "Hooded Stranger" });
  relationships.patchRelationship(early.id, { approval: 20 });
  npcs.renameNpc(stranger.id, "Vesna", ["Hooded Stranger"]);
  assert.equal(bond(kael, "Hooded Stranger"), null);
  assert.equal(bond(kael, "Vesna")?.approval, 20, "the bond followed the name");
  const twin = prepare("Vesna the Elder", "indifferent");
  const theirs = relationships.ensureRelationship({ campaignId: world.campaignId, characterId: lyra.id, characterName: lyra.name, subjectKind: "npc", subjectName: "Vesna the Elder" });
  relationships.patchRelationship(theirs.id, { approval: -15 });
  const doubled = relationships.ensureRelationship({ campaignId: world.campaignId, characterId: kael.id, characterName: kael.name, subjectKind: "npc", subjectName: "Vesna the Elder" });
  relationships.patchRelationship(doubled.id, { approval: -50, memories: [{ kind: "insult", text: "Kael mocked her", at: new Date().toISOString() }] });
  npcs.mergeNpcs(world.campaignId, npcs.getNpcByName(world.campaignId, "Vesna").id, twin.id, ["Hooded Stranger", "Vesna the Elder"]);
  assert.equal(bond(lyra, "Vesna")?.approval, -15, "a bond only the absorbed row had moves across");
  assert.equal(bond(kael, "Vesna").approval, 20, "the keeper's own bond stands");
  assert.ok(bond(kael, "Vesna").memories.some((memory) => memory.text === "Kael mocked her"), "and keeps the other's memories");
  assert.equal(relationships.listRelationshipsForSubject(world.campaignId, "Vesna the Elder").length, 0);
});

await test("the chapter's close opens a companion's missing bonds: one who joined before this, a character who joined after", async () => {
  const { world, kael, bond } = await table();
  await world.invoke("add_companion", { name: "Seren", class: "paladin", gender: "Female", personality: "Stern and devout.", kind: "party" });
  const { getDatabase } = await import("../src/lib/db/core.ts");
  getDatabase().prepare(`DELETE FROM relationships WHERE campaign_id = ?`).run(world.campaignId);
  const late = world.addHero({ name: "Tor", gender: "Male" });
  advanceRelationships(world.campaignId, "");
  assert.ok(bond(kael, "Seren") && bond(late, "Seren"));
});

await test("an NPC who speaks to the party in the narration has met it, a person's narration as well as the AI's", async () => {
  const { world, kael, lyra, bond, prepare } = await table();
  const { meetSpeakers } = await import("../src/lib/dm/party-bonds.ts");
  const mira = prepare("Mira Vell", "friendly");
  const line = { line: "You made it back.", speaker: { kind: "npc", id: mira.id, name: "Mira Vell" } };
  assert.equal(meetSpeakers(world.campaign(), [line]), 2);
  assert.ok(bond(kael, "Mira Vell") && bond(lyra, "Mira Vell"));
  assert.notEqual(npcs.getNpcByName(world.campaignId, "Mira Vell").metAt, "");
  assert.equal(meetSpeakers(world.campaign(), [line]), 0, "a second line is not a second meeting");
  const abbot = prepare("The Ashen Abbot", "hostile");
  assert.equal(meetSpeakers(world.campaign(), [], { kind: "npc", id: abbot.id, name: "The Ashen Abbot" }), 2, "the person a GM narrates as");
});

await test("a person narrating at a human GM's table meets whoever speaks in it", async () => {
  const { world, kael, bond, prepare } = await table({ gameSettings: { dmMode: "human" } });
  prepare("Captain Rhee", "indifferent");
  world.signIn(world.owner);
  const route = await world.route("campaigns/[campaignId]/dm/narrate");
  const response = await route.POST(
    new Request("http://test/", { method: "POST", body: JSON.stringify({ content: 'Captain Rhee steps out of the gatehouse. "State your business," says Captain Rhee.' }) }),
    { params: Promise.resolve({ campaignId: world.campaignId }) },
  );
  assert.ok(response.ok, await response.clone().text());
  assert.ok(bond(kael, "Captain Rhee"), "the captain who spoke has met them");
});

// ---- found reviewing the change ----

await test("a companion a deed is done to still weighs it on its conscience, as a witness would", async () => {
  const { world, kael, bond } = await table({ gameSettings: { companionConscience: "talk" } });
  await world.invoke("add_companion", { name: "Seren", class: "paladin", gender: "Female", personality: "Stern and devout.", kind: "party" });
  const { companionNpcFor } = await import("../src/lib/db/companion-npcs.ts");
  const { setCompanionValues, companionConscience } = await import("../src/lib/db/companion-conscience.ts");
  const row = companionNpcFor(world.sheets().find((entry) => entry.name === "Seren"));
  setCompanionValues(row.id, [{ value: "protects_innocent", strength: "red_line", faction: "" }]);
  const deed = await world.invoke("relationship_beat", { characterId: kael.id, subject: "Seren", beat: "torture", victims: ["Seren"] });
  assert.equal(deed.ok, true, deed.error);
  assert.ok(companionConscience(row.id).held > 0, "the red line the deed crossed moved her conscience");
  assert.ok(bond(kael, "Seren").approval < 0, "and her regard is the victim's");
});

await test("a person named by an old name they answer to is landed on once, as a victim", async () => {
  const { world, kael, bond, prepare } = await table();
  const stranger = prepare("Hooded Stranger", "indifferent");
  npcs.renameNpc(stranger.id, "Vesna", ["Hooded Stranger"]);
  prepare("Witness C", "indifferent");
  const deed = await world.invoke("relationship_beat", { characterId: kael.id, subject: "Vesna", beat: "cruelty", victims: ["Hooded Stranger"], witnesses: ["Vesna", "Witness C", "Hooded Stranger"] });
  assert.equal(deed.ok, true, deed.error);
  assert.equal(bond(kael, "Vesna").approval, doneToDelta("cruelty", -10, "serious"), "one landing, the victim's");
  assert.deepEqual(deed.result.witnesses.map((entry) => entry.subject), ["Witness C"], "a victim is not also a witness, by any of their names");
  assert.ok(!deed.result.victims, "and is not counted twice among the victims");
});

await test("an NPC merged in keeps the bond that holds something over one opened at neutral", async () => {
  const { world, kael, bond, prepare } = await table();
  const stranger = prepare("Hooded Stranger", "indifferent");
  const keep = prepare("Vesna", "indifferent");
  const real = relationships.ensureRelationship({ campaignId: world.campaignId, characterId: kael.id, characterName: kael.name, subjectKind: "npc", subjectName: "Hooded Stranger" });
  relationships.patchRelationship(real.id, { approval: 40, romance: "courting" });
  relationships.ensureRelationship({ campaignId: world.campaignId, characterId: kael.id, characterName: kael.name, subjectKind: "npc", subjectName: "Vesna" });
  npcs.mergeNpcs(world.campaignId, keep.id, stranger.id, ["Hooded Stranger"]);
  assert.equal(bond(kael, "Vesna").approval, 40, "the courting bond survived the merge");
  assert.equal(bond(kael, "Vesna").romance, "courting");
});

await test("a bond that ended in a falling-out stays ended through a death and a return", async () => {
  const { world, kael, lyra, bond } = await table();
  await world.invoke("add_companion", { name: "Seren", class: "paladin", gender: "Female", personality: "Stern and devout.", kind: "party" });
  const fell = await world.invoke("relationship_end", { characterId: kael.id, subject: "Seren", reason: "falling_out" });
  assert.equal(fell.ok, true, fell.error);
  const sheet = world.sheets().find((entry) => entry.name === "Seren");
  world.patch(sheet.id, { deathSaves: { successes: 0, failures: 3, stable: false, dead: true } });
  await world.invoke("dismiss_companion", { characterId: sheet.id, reason: "she fell" });
  await world.invoke("add_companion", { name: "Seren", class: "paladin", gender: "Female", personality: "Stern and devout.", kind: "party" });
  assert.equal(bond(kael, "Seren").status, "ended", "the falling-out stands");
  assert.equal(bond(lyra, "Seren").status, "active", "the bond the death closed opens again");
});

await test("a rename in the NPC editor moves the bonds, and the Bonds panel hears of it", async () => {
  const { world, kael, bond, prepare } = await table();
  const npc = prepare("Osric", "indifferent");
  const early = relationships.ensureRelationship({ campaignId: world.campaignId, characterId: kael.id, characterName: kael.name, subjectKind: "npc", subjectName: "Osric" });
  relationships.patchRelationship(early.id, { approval: 15 });
  const { subscribe } = await import("../src/lib/events.ts");
  const heard = [];
  const stop = subscribe(world.campaignId, (chunk) => heard.push(/^event: (.+)$/m.exec(chunk)?.[1] ?? ""));
  const { blankDraft } = await import("../src/lib/npcs/forge.ts");
  npcs.updateNpcFromDraft(world.campaignId, npc.id, { ...blankDraft(), name: "Osric the Elder", attitude: "indifferent" });
  stop();
  assert.equal(bond(kael, "Osric the Elder")?.approval, 15);
  assert.ok(heard.includes("relationships_updated"));
});

await test("a companion's bonds stay under its sheet's name when its row is renamed", async () => {
  const { world, kael, bond } = await table();
  await world.invoke("add_companion", { name: "Seren", class: "paladin", gender: "Female", personality: "Stern and devout.", kind: "party" });
  const row = npcs.listNpcs(world.campaignId).find((npc) => npc.name === "Seren");
  npcs.renameNpc(row.id, "Seren the Grey", ["Seren"]);
  assert.ok(bond(kael, "Seren"), "the bond stays with the sheet");
});

await test("a bond opened at neutral reads as no bond to whatever weighs a party's standing", async () => {
  const { world, kael, lyra, bond } = await table();
  await world.invoke("add_companion", { name: "Seren", class: "paladin", gender: "Female", personality: "Stern and devout.", kind: "party" });
  relationships.patchRelationship(bond(kael, "Seren").id, { approval: 60 });
  assert.equal(bond(lyra, "Seren").approval, 0);
  const { worstApproval } = await import("../src/lib/dm/conscience.ts");
  assert.equal(worstApproval(world.campaignId, "Seren", world.sheets()), 60, "Lyra's untouched bond is not a 0 standing");
  const { hasStanding } = await import("../src/lib/dm/relationship-logic.ts");
  assert.equal(hasStanding(bond(lyra, "Seren")), false);
  assert.equal(hasStanding(bond(kael, "Seren")), true);
});

await test("restating the default attitude is not meeting a stranger, so the reaction roll still happens", async () => {
  const { world, kael, bond, prepare } = await table();
  prepare("Tamsin", "indifferent");
  await world.invoke("set_npc", { name: "Tamsin", attitude: "indifferent", location: "The mill" });
  assert.equal(npcs.getNpcByName(world.campaignId, "Tamsin").metAt, "");
  assert.equal(bond(kael, "Tamsin"), null);
});

await test("with bonds off nothing opens", async () => {
  const { world, kael, bond } = await table({ gameSettings: { relationships: "off" } });
  await world.invoke("add_companion", { name: "Seren", class: "paladin", gender: "Female", personality: "Stern and devout.", kind: "party" });
  assert.equal(bond(kael, "Seren"), null);
});

finish();
