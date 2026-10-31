// Issue 657, through the engine the way the GM and the players reach it:
//   - meeting someone opened bonds for every sheet in play, the dead
//     included, and a fallen hero kept the advances and pacts switches;
//   - a hero who joined later had no bond with anyone the party had met;
//   - a foe the party knew, killed in a fight, stayed on the Bonds tab at
//     Neutral, since only relationship_end closed bonds on a death.
// And what the audit found beside them: the dead were courted, recruited,
// longed for, counted in a companion's regard and walked in the formation;
// the lead's force-end skipped the fight's cleanup; a lobby edit left its
// bonds under the old sheet; a newcomer opened a live bond with the dead; a
// namesake companion reopened a dead NPC's bonds.
import assert from "node:assert/strict";
import "./lib/enforce-campaign.mjs";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { LEGAL_FIGHTER, PORTRAIT } from "./lib/enforce-creation.mjs";

const { test, finish } = suite("test-enforce-bonds-657");
const npcs = await import("../src/lib/db/npcs.ts");
const relationships = await import("../src/lib/db/relationships.ts");
const facts = await import("../src/lib/db/facts.ts");
const sheetsDb = await import("../src/lib/db/sheets.ts");
const proposals = await import("../src/lib/db/item-proposals.ts");
const advances = await import("../src/lib/db/advances.ts");
const { getParty } = await import("../src/lib/db/party.ts");
const { advanceRelationships } = await import("../src/lib/dm/relationship-tick.ts");
const { endedByDeath } = await import("../src/lib/dm/relationship-logic.ts");
const { livingHero } = await import("../src/lib/characters/fallen-logic.ts");
const { joinerSubjects, foeBondName, deathMemory, subjectDied } = await import("../src/lib/dm/party-bonds-logic.ts");
const { meetSpeakers } = await import("../src/lib/dm/party-bonds.ts");
const { openToAdvanceNames } = await import("../src/lib/dm/advance-logic.ts");
const { tickAdvances } = await import("../src/lib/dm/advance-tick.ts");
const { openToPactNames } = await import("../src/lib/dm/pacts.ts");
const { worstApproval } = await import("../src/lib/dm/conscience.ts");
const { relationshipRosterForPrompt } = await import("../src/lib/dm/relationship-tools.ts");
const { formationPartyIds } = await import("../src/lib/dm/roster.ts");
const { getDatabase } = await import("../src/lib/db/core.ts");

const DEAD = { successes: 0, failures: 3, stable: false, dead: true };

async function table({ gameSettings = {}, status } = {}) {
  const world = await openWorld({ gameSettings: { companions: "full", ...gameSettings }, ...(status ? { status } : {}) });
  const kael = world.addHero({ name: "Kael", gender: "Male" });
  const lyra = world.addHero({ name: "Lyra", gender: "Female" });
  const bond = (who, subject) => relationships.getRelationship(world.campaignId, who.id, subject);
  const prepare = (name, attitude = "indifferent") => npcs.upsertNpc({ campaignId: world.campaignId, name, attitude, gender: "Female" });
  const kill = (sheet) => world.patch(sheet.id, { deathSaves: DEAD, currentHp: 0 });
  const liking = (sheet, subject, approval, subjectKind = "npc") => {
    const row = relationships.ensureRelationship({ campaignId: world.campaignId, characterId: sheet.id, characterName: sheet.name, subjectKind, subjectName: subject });
    return relationships.patchRelationship(row.id, { approval });
  };
  // Someone the party knows who fights as a bandit: a Cast NPC fields under
  // their own name (encounter-spawn.ts), the way a town NPC turns hostile.
  const armed = (name) =>
    getDatabase().prepare(`UPDATE npcs SET stat_block = 'bandit' WHERE campaign_id = ? AND name = ?`).run(world.campaignId, name);
  async function call(user, name, method, body, extra = {}) {
    world.signIn(user);
    const mod = await world.route(name);
    const response = await mod[method](
      new Request("http://test/", { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }),
      { params: Promise.resolve({ campaignId: world.campaignId, ...extra }) },
    );
    return { status: response.status, json: await response.json() };
  }
  return { world, kael, lyra, bond, prepare, kill, liking, armed, call };
}

// ---- the rules ----

await test("the rules: who is a living hero, who a newcomer is owed a bond with, which NPC a fallen foe is", () => {
  assert.equal(livingHero({}), true);
  assert.equal(livingHero({ deathSaves: { successes: 0, failures: 2, stable: false, dead: false } }), true, "a dying hero lives");
  assert.equal(livingHero({ deathSaves: DEAD }), false);
  assert.equal(livingHero({ isCompanion: true }), false, "a companion is no hero of a player's");
  assert.equal(livingHero({ summon: { spell: "Find Familiar" } }), false);

  const died = { subjectName: "Hesper", status: "ended", flags: ["died"] };
  const active = (subjectName) => ({ subjectName, status: "active", flags: [] });
  assert.equal(subjectDied([died]), true);
  assert.equal(subjectDied([{ ...died, flags: [] }]), false, "a falling-out is no death");
  const met = (name, extra = {}) => ({ id: name, name, metAt: "2026-10-30T00:00:00Z", companionSheetId: "", ...extra });
  const subjects = joinerSubjects({
    npcs: [
      met("Fenna"),
      met("Mara"),
      met("Hesper"),
      met("Ashen Abbot", { metAt: "" }),
      met("Dace", { companionSheetId: "gone-sheet" }),
      met("Seren", { companionSheetId: "seren-sheet" }),
    ],
    sheets: [
      { id: "seren-sheet", name: "Seren", isCompanion: true, companionKind: "party" },
      { id: "guest", name: "Gil", isCompanion: true, companionKind: "guest" },
      { id: "wolf", name: "Wolf", isCompanion: true, companionKind: "party", summon: { spell: "Conjure Animals" } },
      { id: "dead-companion", name: "Ober", isCompanion: true, companionKind: "party", deathSaves: DEAD },
      { id: "hero", name: "Kael" },
    ],
    bonds: [active("Fenna"), died, { subjectName: "Dace", status: "parted", flags: [] }],
  });
  assert.deepEqual(subjects.map((subject) => subject.name).sort(), ["Fenna", "Mara", "Seren"], JSON.stringify(subjects));
  assert.equal(subjects.find((subject) => subject.name === "Seren").kind, "companion");

  const cast = [{ name: "Raider Captain", aliases: ["Captain Voss"] }];
  assert.equal(foeBondName("raider captain", cast), "Raider Captain");
  assert.equal(foeBondName("Captain Voss", cast), "Raider Captain", "a name she answers to");
  assert.equal(foeBondName("Raider Captain 2", cast), null, "never a near match");
  assert.equal(deathMemory({ characterName: "Kael", approval: 40, romance: "none" }, "Bram"), "Bram, who mattered to Kael, died");
  assert.equal(deathMemory({ characterName: "Kael", approval: 0, romance: "none" }, "Bram"), "Bram died");
});

// ---- claim 1: the dead gain no bonds ----

await test("a fallen hero gains no bond when the party meets someone, by any road", async () => {
  const { world, kael, lyra, bond, prepare, kill } = await table();
  kill(lyra);
  world.dice(4, 4);
  const met = await world.invoke("npc_reaction", { name: "Mara", gender: "Female" });
  assert.equal(met.ok, true, met.error);
  assert.ok(bond(kael, "Mara"), "the living hero has met her");
  assert.equal(bond(lyra, "Mara"), null, "the dead hero gained a bond");
  prepare("Osric");
  const told = await world.invoke("set_npc", { name: "Osric", attitude: "friendly" });
  assert.equal(told.ok, true, told.error);
  assert.equal(bond(lyra, "Osric"), null, "an attitude the story shifted");
  const speaker = prepare("Brother Aldo");
  assert.equal(meetSpeakers(world.campaign(), [{ line: "Welcome.", speaker: { kind: "npc", id: speaker.id, name: "Brother Aldo" } }]), 1);
  assert.equal(bond(lyra, "Brother Aldo"), null, "a line of narration");
  const joined = await world.invoke("add_companion", { name: "Seren", class: "paladin", gender: "Female", personality: "Stern.", kind: "party" });
  assert.equal(joined.ok, true, joined.error);
  assert.ok(bond(kael, "Seren"));
  assert.equal(bond(lyra, "Seren"), null, "a companion who joined after the death");
});

await test("a fallen hero has no advances or pacts switches: the Bonds tab hides them and the server refuses them", async () => {
  const { world, kael, kill, call } = await table();
  const tor = world.addHero({ name: "Tor", gender: "Male" });
  await world.invoke("add_companion", { name: "Seren", class: "paladin", gender: "Female", personality: "Stern.", kind: "party" });
  kill(kael);
  const romance = await call(world.owner, "campaigns/[campaignId]/sheet/romance", "PUT", { characterId: kael.id, open: true });
  assert.equal(romance.status, 409, JSON.stringify(romance.json));
  assert.match(romance.json.error, /Kael has fallen/);
  assert.equal((await call(world.owner, "campaigns/[campaignId]/sheet/romance", "PUT", { characterId: kael.id, open: false })).status, 200, "off is always allowed");
  const pacts = await call(world.owner, "campaigns/[campaignId]/sheet/pacts", "PUT", { characterId: kael.id, open: true });
  assert.equal(pacts.status, 409, JSON.stringify(pacts.json));
  assert.match(pacts.json.error, /Kael has fallen/);
  // What the GM is told: the dead are open to nothing.
  sheetsDb.setOpenToAdvances(kael.id, true);
  sheetsDb.setOpenToPacts(kael.id, true);
  sheetsDb.setOpenToPacts(tor.id, true);
  assert.deepEqual(openToAdvanceNames(world.campaign(), world.sheets()), []);
  assert.deepEqual(openToPactNames(world.campaign(), world.sheets()), ["Tor"]);
});

await test("an advance waiting on a hero who falls is withdrawn, and the dead draw no new one", async () => {
  const { world, kael, kill, liking } = await table();
  world.signIn(world.owner);
  await world.invoke("set_npc", { name: "Mira", gender: "Female", drawnTo: ["men"], location: "Highmoor" });
  sheetsDb.setOpenToAdvances(kael.id, true);
  liking(kael, "Mira", 60);
  const pending = () => proposals.listOpenItemProposals(world.campaignId).filter((row) => row.toolName === "romance_advance");
  const tick = (count, narration = "") => {
    while (advances.getAiTurns(world.campaignId) < count) {
      advances.bumpAiTurns(world.campaignId);
    }
    tickAdvances(world.campaign(), count, narration);
  };
  world.dice(1);
  tick(8, "Mira waves Kael over.");
  world.clearDice();
  const made = await world.invoke("romance_advance", { characterId: kael.id, subject: "Mira", to: "courting", initiator: "npc" });
  assert.equal(made.ok, true, made.error);
  assert.equal(pending().length, 1);
  kill(kael);
  tick(9);
  assert.equal(pending().length, 0, "the advance still waited on the dead");
  world.dice(1);
  tick(16, "Mira waves Kael over.");
  assert.equal(world.clearDice(), 1, "no die is rolled for the dead");
  assert.equal(relationships.getRelationship(world.campaignId, kael.id, "Mira").advanceReadyUntil, 0);
});

// ---- claim 2: a newcomer gets the party's bonds ----

await test("a hero raised from the dead catches up on whoever the party met while they lay dead", async () => {
  const world = await openWorld({ gameSettings: { companions: "full" } });
  const tam = world.addHero({
    name: "Brother Tam", class: "cleric", level: 5, abilities: { wis: 16 },
    spellcasting: { ability: "wis", slots: { 3: { max: 2, used: 0 } }, prepared: ["Revivify"], known: [], cantrips: [] },
    equipment: [{ name: "Diamond", qty: 1, worth: 300 }, { name: "Component pouch", qty: 1 }],
  });
  const lyra = world.addHero({ name: "Lyra", gender: "Female" });
  world.patch(lyra.id, { deathSaves: DEAD, currentHp: 0 });
  world.dice(4, 4);
  await world.invoke("npc_reaction", { name: "Mara", gender: "Female" });
  assert.ok(relationships.getRelationship(world.campaignId, tam.id, "Mara"));
  assert.equal(relationships.getRelationship(world.campaignId, lyra.id, "Mara"), null);
  const raised = await world.invoke("heal", { characterId: lyra.id, casterId: tam.id, spell: "Revivify", level: 3 });
  assert.equal(raised.ok, true, raised.error);
  assert.equal(raised.result.revived, "Lyra");
  assert.equal(relationships.getRelationship(world.campaignId, lyra.id, "Mara")?.status, "active", "back among the living, she knows Mara");
});

await test("a newcomer named in a moment with someone who died finds them dead, and the beat lands on nobody", async () => {
  const { world, kael, bond, prepare } = await table();
  prepare("Hesper", "friendly");
  const own = relationships.ensureRelationship({ campaignId: world.campaignId, characterId: kael.id, characterName: kael.name, subjectKind: "npc", subjectName: "Hesper" });
  relationships.patchRelationship(own.id, { approval: 50 });
  assert.equal((await world.invoke("relationship_end", { characterId: kael.id, subject: "Hesper", reason: "death" })).ok, true);
  const tor = world.addHero({ name: "Tor", gender: "Male" });
  const beat = await world.invoke("relationship_beat", { characterId: tor.id, subject: "Hesper", beat: "helped" });
  assert.equal(beat.ok, false);
  assert.match(beat.error, /Hesper is dead/);
  assert.ok(endedByDeath(bond(tor, "Hesper")), "the newcomer's bond opened live with the dead");
});

await test("a new companion who shares a dead NPC's name does not reopen the dead one's bonds", async () => {
  const { world, kael, lyra, bond, prepare } = await table();
  prepare("Hesper", "friendly");
  for (const hero of [kael, lyra]) {
    relationships.ensureRelationship({ campaignId: world.campaignId, characterId: hero.id, characterName: hero.name, subjectKind: "npc", subjectName: "Hesper" });
  }
  await world.invoke("relationship_end", { characterId: kael.id, subject: "Hesper", reason: "death" });
  const joined = await world.invoke("add_companion", { name: "Hesper", class: "fighter", gender: "Female", personality: "A stranger.", kind: "party" });
  assert.equal(joined.ok, true, joined.error);
  assert.ok(endedByDeath(bond(kael, "Hesper")), "the dead NPC's bond came back to life for a namesake");
  assert.ok(endedByDeath(bond(lyra, "Hesper")));
});

// ---- claim 3: a foe killed in a fight ----

await test("a foe the party knew who dies in the fight is closed as died for every hero, and the GM is told", async () => {
  const { world, kael, lyra, bond, armed } = await table();
  world.dice(4, 4);
  assert.equal((await world.invoke("npc_reaction", { name: "Raider Captain", gender: "Male" })).ok, true);
  assert.ok(bond(kael, "Raider Captain") && bond(lyra, "Raider Captain"));
  armed("Raider Captain");
  await world.beginFight([{ monster: "Raider Captain" }]);
  const [captain] = world.enemies();
  assert.equal(captain.displayName, "Raider Captain");
  const blow = await world.invoke("damage_enemy", { enemyId: captain.id, amount: 200 });
  assert.equal(blow.ok, true, blow.error);
  assert.equal(world.encounter(), null, "the last foe down ends the fight");
  for (const hero of [kael, lyra]) {
    assert.ok(endedByDeath(bond(hero, "Raider Captain")), `${hero.name}'s bond still read Neutral`);
    assert.ok(bond(hero, "Raider Captain").memories.some((memory) => memory.text === "Raider Captain died"));
  }
  assert.match(JSON.stringify(blow.result), /Every bond with Raider Captain is closed: they died in the fight/);
  world.signIn(world.owner);
  const route = await world.route("campaigns/[campaignId]/relationships");
  const view = await (await route.GET(new Request("http://test/"), { params: Promise.resolve({ campaignId: world.campaignId }) })).json();
  assert.ok(view.relationships.filter((row) => row.subjectName === "Raider Captain").every((row) => row.died === true), "the Bonds tab says died");
});

await test("a foe who fled, a bestiary goblin and her name asked for twice close nobody's bonds", async () => {
  const { world, kael, bond, armed } = await table();
  world.dice(4, 4);
  await world.invoke("npc_reaction", { name: "Raider Captain", gender: "Male" });
  armed("Raider Captain");
  await world.beginFight([{ monster: "Raider Captain" }]);
  const ended = await world.invoke("end_encounter", { outcome: "enemies_fled" });
  assert.equal(ended.ok, true, ended.error);
  assert.equal(bond(kael, "Raider Captain").status, "active", "she ran; she lives");
  // A Cast NPC is one person whatever the count (issue 667), so two of her
  // name bring her back alone; a numbered stranger is never her either
  // (foeBondName above).
  await world.beginFight([{ monster: "Raider Captain", count: 2 }, { monster: "goblin" }]);
  const names = world.enemies().map((enemy) => enemy.displayName);
  assert.equal(names.filter((name) => name === "Raider Captain").length, 1, `one of her: ${names.join(", ")}`);
  for (const enemy of world.enemies().filter((enemy) => enemy.displayName !== "Raider Captain")) {
    await world.invoke("damage_enemy", { enemyId: enemy.id, amount: 200 });
  }
  assert.equal(bond(kael, "Raider Captain").status, "active", "a goblin's death is not hers");
});

await test("a foe the fight linked to a Cast NPC closes that NPC's bonds whatever the tracker called it", async () => {
  const { world, kael, bond, armed } = await table();
  world.dice(4, 4);
  await world.invoke("npc_reaction", { name: "Raider Captain", gender: "Male" });
  armed("Raider Captain");
  await world.beginFight([{ monster: "Raider Captain" }, { monster: "goblin" }]);
  const [her] = world.enemies().filter((enemy) => enemy.npcId);
  assert.ok(her, "her row carries her NPC");
  const { getDatabase } = await import("../src/lib/db/core.ts");
  getDatabase().prepare("UPDATE encounter_enemies SET display_name = ? WHERE id = ?").run("The Captain", her.id);
  for (const enemy of world.enemies()) {
    await world.invoke("damage_enemy", { enemyId: enemy.id, amount: 200 });
  }
  assert.ok(endedByDeath(bond(kael, "Raider Captain")), "her death closes her bonds under any name");
});

await test("the lead's force-end closes a dead foe's bonds and runs the fight's cleanup", async () => {
  const { world, kael, bond, armed, call } = await table();
  world.dice(4, 4);
  await world.invoke("npc_reaction", { name: "Raider Captain", gender: "Male" });
  armed("Raider Captain");
  const guest = await world.invoke("add_companion", { name: "Dace", class: "fighter", gender: "Male", personality: "Hired blade.", kind: "guest" });
  assert.equal(guest.ok, true, guest.error);
  await world.beginFight([{ monster: "Raider Captain" }, { monster: "goblin" }]);
  const captain = world.enemies().find((enemy) => enemy.displayName === "Raider Captain");
  await world.invoke("damage_enemy", { enemyId: captain.id, amount: 200 });
  assert.ok(world.encounter(), "the goblin still stands");
  const ended = await call(world.owner, "campaigns/[campaignId]/encounter", "DELETE");
  assert.equal(ended.status, 200, JSON.stringify(ended.json));
  assert.equal(world.encounter(), null);
  assert.ok(endedByDeath(bond(kael, "Raider Captain")), "a force-end left the dead foe's bonds open");
  assert.ok(!world.sheets().some((sheet) => sheet.name === "Dace"), "the guest ally stayed in the party after the fight");
});

// ---- found beside them ----

await test("the chapter's close longs for nobody on a fallen hero's behalf, and opens no bond toward a dead companion", async () => {
  const { world, kael, lyra, bond, prepare, kill, liking } = await table();
  prepare("Bram", "friendly");
  liking(kael, "Bram", 70);
  kill(kael);
  for (let chapter = 0; chapter < 4; chapter += 1) {
    advanceRelationships(world.campaignId, "The party travels north.");
  }
  assert.ok(!facts.listActiveFacts(world.campaignId).some((fact) => /Kael/.test(fact.fact)), "the GM was asked to send word to the dead");
  await world.invoke("add_companion", { name: "Seren", class: "paladin", gender: "Female", personality: "Stern.", kind: "party" });
  const seren = world.sheets().find((sheet) => sheet.name === "Seren");
  world.patch(seren.id, { deathSaves: DEAD, currentHp: 0 });
  const tor = world.addHero({ name: "Tor", gender: "Male" });
  advanceRelationships(world.campaignId, "");
  assert.equal(bond(tor, "Seren"), null, "a bond opened toward a dead companion");
  assert.ok(bond(lyra, "Seren"), "one opened before she fell stays");
});

await test("a fallen hero's standing no longer drives a companion, and the GM's roster leaves out their bonds", async () => {
  const { world, kael, liking, kill, prepare } = await table();
  await world.invoke("add_companion", { name: "Seren", class: "paladin", gender: "Female", personality: "Stern.", kind: "party" });
  relationships.patchRelationship(relationships.getRelationship(world.campaignId, kael.id, "Seren").id, { approval: -60 });
  assert.equal(worstApproval(world.campaignId, "Seren", world.sheets()), -60);
  prepare("Bram", "friendly");
  liking(kael, "Bram", 40);
  assert.ok(relationshipRosterForPrompt(world.campaignId).some((line) => /Kael/.test(line)));
  kill(kael);
  assert.equal(worstApproval(world.campaignId, "Seren", world.sheets()), null, "the dead hero's feud still pushed her to leave");
  assert.ok(!relationshipRosterForPrompt(world.campaignId).some((line) => /Kael/.test(line)), "the GM read the dead hero's bonds as live");
});

await test("a fallen hero leaves the travel formation: a hazard at the front finds the living, and a stale order keeps the rest", async () => {
  const { world, kael, lyra, kill, call } = await table();
  const tor = world.addHero({ name: "Tor", gender: "Male" });
  const set = await call(world.owner, "campaigns/[campaignId]/party/formation", "POST", { do: "set", order: [lyra.id, kael.id, tor.id] });
  assert.equal(set.status, 200, JSON.stringify(set.json));
  kill(lyra);
  assert.deepEqual(formationPartyIds(world.campaign(), world.sheets()).sort(), [kael.id, tor.id].sort());
  const front = await world.invoke("apply_hazard", { type: "falling", feet: 10, rank: "front", reason: "a pit" });
  assert.equal(front.ok, true, front.error);
  assert.match(front.result.formation, /Kael walks at the front/, "the hazard struck the dead");
  const stale = await call(world.owner, "campaigns/[campaignId]/party/formation", "POST", { do: "set", order: [lyra.id, tor.id, kael.id] });
  assert.equal(stale.status, 200, JSON.stringify(stale.json));
  assert.deepEqual(getParty(world.campaignId).marchingOrder, [tor.id, kael.id]);
});

await test("a lobby edit keeps the seat's bonds on the new sheet, and removing the character removes them", async () => {
  const { world, kael, bond, liking, call } = await table({ status: "lobby" });
  liking(kael, "Seren", 5, "companion");
  const replaced = await call(world.owner, "campaigns/[campaignId]/sheet", "PUT", { ...LEGAL_FIGHTER, name: "Brann Holt", portrait: PORTRAIT });
  assert.equal(replaced.status, 200, JSON.stringify(replaced.json));
  const brann = replaced.json.sheet;
  assert.notEqual(brann.id, kael.id);
  assert.equal(bond(kael, "Seren"), null, "the bond stayed under the old sheet");
  assert.equal(bond(brann, "Seren")?.approval, 5);
  assert.equal(bond(brann, "Seren")?.characterName, "Brann Holt");
  const removed = await call(world.owner, "campaigns/[campaignId]/sheet", "DELETE");
  assert.equal(removed.status, 200, JSON.stringify(removed.json));
  assert.equal(relationships.listRelationships(world.campaignId).filter((row) => row.characterId === brann.id).length, 0);
});

finish();
