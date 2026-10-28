// The gaps issue 563 found between the #503 plan and what shipped, through
// the engine the way the DM reaches it:
//   - the AI cannot write out a lasting companion at a warning or worse; a
//     person can, and the departure is kept so the return can follow;
//   - a companion who goes says who it still cares for, and the Gone list
//     keeps it;
//   - a deed done to someone the doer is finished with still lands on every
//     other witness;
//   - the party's own who stood by bear a share of a deed's cost, those who
//     objected none;
//   - a companion weighs its odds against the party that would fight it;
//   - the party splitting up is a moment a companion slips away;
//   - one ceiling rule: a Turn table never holds the companion itself back,
//     on the spot or on its return;
//   - a devoted companion heals its dying friend first, and a wary one will
//     not walk into a damaging area on its commander's word.
import assert from "node:assert/strict";
import "./lib/enforce-campaign.mjs";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";

const { test, finish } = suite("test-enforce-conscience-563");
const npcs = await import("../src/lib/db/npcs.ts");
const relationships = await import("../src/lib/db/relationships.ts");
const turns = await import("../src/lib/db/dm-turns.ts");
const conscienceDb = await import("../src/lib/db/companion-conscience.ts");
const departuresDb = await import("../src/lib/db/companion-departures.ts");
const sheetsDb = await import("../src/lib/db/sheets.ts");
const { getBattleMapForEncounter } = await import("../src/lib/db/battle-maps.ts");
const { saveZones } = await import("../src/lib/dm/zone-store.ts");
const { invokeEngine } = await import("../src/lib/dm/invoke.ts");
const { CONTENT } = await import("../src/lib/dm/conscience-logic.ts");
const { companionOdds } = await import("../src/lib/dm/departure-opening.ts");
const { rosterBudget } = await import("../src/lib/dm/party-budget.ts");
const { departedLinesForPrompt } = await import("../src/lib/dm/companion-revenge.ts");

async function table({ gameSettings = {}, axes = {}, heroes = 1, level = 1, companion = {} } = {}) {
  const world = await openWorld({ gameSettings: { companions: "full", ...gameSettings } });
  const party = [world.addHero({ name: "Kael", gender: "Male", level })];
  for (let index = 1; index < heroes; index += 1) {
    party.push(world.addHero({ name: `Hero ${index + 1}`, level }));
  }
  const added = await world.invoke("add_companion", { name: "Seren", class: "paladin", gender: "Female", alignment: "LG", personality: "Stern and devout.", kind: "party", ...companion });
  assert.equal(added.ok, true, added.error);
  const sheet = world.sheets().find((entry) => entry.name === "Seren");
  const row = () => npcs.listNpcs(world.campaignId).find((npc) => npc.name === "Seren");
  npcs.patchNpcAgency(row().id, { personality: { drive: 0, diligence: 0, boldness: 0, warmth: 0, empathy: 0, composure: 0, ...axes } });
  const bond = (who, subject = "Seren") =>
    relationships.ensureRelationship({ campaignId: world.campaignId, characterId: who.id, characterName: who.name, subjectKind: subject === "Seren" ? "companion" : "npc", subjectName: subject });
  const standing = (who, approval, subject = "Seren") => relationships.patchRelationship(bond(who, subject).id, { approval });
  const approval = (who, subject = "Seren") => bond(who, subject).approval;
  // Where her deeds have left her, held on the ladder (conscience-logic.ts).
  const rung = (held) => conscienceDb.saveConscience(row().id, { ...CONTENT, held, shown: held });
  const departure = () => departuresDb.companionDeparture(row().id);
  const asAi = (name, args) => {
    const turn = turns.createDmTurn(world.campaignId, [], "ai");
    return invokeEngine(world.campaign(), { kind: "ai", turnId: turn.id }, { name, args });
  };
  return { world, party, pc: party[0], sheet, row, bond, standing, approval, rung, departure, asAi, still: () => Boolean(world.sheet(sheet.id)) };
}

async function gone(world) {
  world.signIn(world.owner);
  const handler = await world.route("campaigns/[campaignId]/companions/gone");
  const response = await handler.GET(new Request("http://test/"), { params: Promise.resolve({ campaignId: world.campaignId }) });
  return (await response.json()).gone;
}

await test("the AI cannot write out a companion at a warning or worse; the party lead can, and the record keeps how she went", async () => {
  const { world, sheet, rung, departure, asAi, still, row } = await table();
  rung(2);
  const refused = await asAi("dismiss_companion", { characterId: sheet.id, reason: "she has had enough of them" });
  assert.equal(refused.ok, false);
  assert.match(refused.error, /^Seren is at their warning, and whether they leave over what the party did is the server's/);
  assert.match(refused.error, /the party lead does it from Seren's card in the Party panel/);
  assert.ok(still(), "she stays");
  // The lead sends her away from her card.
  world.signIn(world.owner);
  const handler = await world.route("campaigns/[campaignId]/companions/[characterId]");
  const response = await handler.DELETE(new Request("http://test/", { method: "DELETE" }), { params: Promise.resolve({ campaignId: world.campaignId, characterId: sheet.id }) });
  assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
  assert.equal(still(), false);
  assert.equal(departure().gone.how, "Was sent away by the party");
  assert.ok(conscienceDb.departedSheet(row().id), "the row keeps her sheet for a return");
  assert.deepEqual((await gone(world)).map((entry) => [entry.name, entry.how]), [["Seren", "Was sent away by the party"]]);
});

await test("below a warning, or fallen, a dismissal is the plain parting it always was", async () => {
  const uneasy = await table();
  uneasy.rung(1);
  const left = await uneasy.asAi("dismiss_companion", { characterId: uneasy.sheet.id, reason: "she stays behind at the shrine" });
  assert.equal(left.ok, true, left.error);
  assert.equal(uneasy.departure().gone, null, "no departure record: the story sent her off");
  const fallen = await table();
  fallen.rung(4);
  fallen.world.patch(fallen.sheet.id, { currentHp: 0, deathSaves: { successes: 0, failures: 3, stable: false, dead: true } });
  const buried = await fallen.asAi("dismiss_companion", { characterId: fallen.sheet.id, reason: "she fell" });
  assert.equal(buried.ok, true, buried.error);
});

await test("a Talk table keeps its companions from the AI; a person still sends one away, as a plain parting", async () => {
  const { world, sheet, rung, departure, asAi, still } = await table({ gameSettings: { companionConscience: "talk" } });
  rung(3);
  const refused = await asAi("dismiss_companion", { characterId: sheet.id });
  assert.equal(refused.ok, false);
  assert.match(refused.error, /^This table keeps its companions: Seren stays/);
  const sent = await world.invoke("dismiss_companion", { characterId: sheet.id, reason: "sent home" });
  assert.equal(sent.ok, true, sent.error);
  assert.equal(still(), false);
  assert.equal(departure().gone, null);
});

await test("a companion who walks out still caring for someone says so, and the Gone list and GAME STATE keep it", async () => {
  const { world, party, pc, standing } = await table({ heroes: 2, axes: { boldness: -2 } });
  standing(party[1], 65);
  const done = await world.invoke("relationship_beat", { characterId: pc.id, subject: "Seren", beat: "murder_helpless", severity: "atrocity", note: "Kael cut the bound prisoner's throat." });
  assert.equal(done.ok, true, done.error);
  assert.equal(done.result.departed, "Walked out on the party");
  assert.match(done.result.note, /They still care for Hero 2: let it show as they go/);
  const [entry] = await gone(world);
  assert.deepEqual(entry.caresFor, ["Hero 2"]);
  assert.match(departedLinesForPrompt(world.campaign()).join("\n"), /still cares for Hero 2/);
});

await test("a deed done to someone the doer is finished with still lands on everyone else who saw it", async () => {
  const { world, pc, approval, bond } = await table();
  const met = await world.invoke("set_npc", { name: "Mara", attitude: "indifferent", description: "A bound smuggler." });
  assert.equal(met.ok, true, met.error);
  bond(pc, "Mara");
  const ended = await world.invoke("relationship_end", { characterId: pc.id, subject: "Mara", reason: "falling_out" });
  assert.equal(ended.ok, true, ended.error);
  const before = approval(pc);
  const alone = await world.invoke("relationship_beat", { characterId: pc.id, subject: "Mara", beat: "torture" });
  assert.equal(alone.ok, false, "nobody else saw it: nothing to record");
  const seen = await world.invoke("relationship_beat", { characterId: pc.id, subject: "Mara", beat: "torture", witnesses: ["Seren"], note: "Kael put the smuggler to the question." });
  assert.equal(seen.ok, true, seen.error);
  assert.equal(seen.result.finished, "Kael and Mara");
  assert.ok(approval(pc) < before, "Seren saw it");
  assert.equal(seen.result.witnesses[0].subject, "Seren");
});

await test("the party's own who stood by bear a third of the cost; one who objected bears none", async () => {
  const { world, party, pc, approval } = await table({ heroes: 3 });
  const [, by, against] = party;
  const done = await world.invoke("relationship_beat", { characterId: pc.id, subject: "Seren", beat: "cruelty", witnesses: [by.name, against.name], objected: [against.id] });
  assert.equal(done.ok, true, done.error);
  assert.ok(done.result.approvalChange < 0);
  assert.equal(approval(by), Math.min(-1, Math.round(done.result.approvalChange / 3)), "a third of what it cost Kael");
  assert.equal(approval(against), 0, "the one who objected bears none");
  assert.match(done.result.note, /Hero 2 stood by and bears a share of it with Seren/);
  assert.match(done.result.note, /Hero 3 spoke against it and bear none of it/);
  // A kindness shares no credit.
  const kind = await world.invoke("relationship_beat", { characterId: pc.id, subject: "Seren", beat: "mercy", witnesses: [by.name] });
  assert.equal(kind.ok, true, kind.error);
  assert.equal(approval(by), Math.min(-1, Math.round(done.result.approvalChange / 3)));
});

await test("a companion weighs its odds against the party that would fight it: a loyal companion counts, the dead do not", async () => {
  const { world, sheet } = await table({ level: 3 });
  const added = await world.invoke("add_companion", { name: "Bram", class: "fighter", gender: "Male", personality: "Steady.", kind: "party" });
  assert.equal(added.ok, true, added.error);
  const bram = world.sheets().find((entry) => entry.name === "Bram");
  const rank = ["trivial", "easy", "medium", "hard", "deadly", "beyond_deadly"];
  const withBram = companionOdds(world.campaign(), world.sheet(sheet.id));
  world.patch(bram.id, { currentHp: 0, deathSaves: { successes: 0, failures: 3, stable: false, dead: true } });
  const alone = companionOdds(world.campaign(), world.sheet(sheet.id));
  assert.ok(rank.indexOf(withBram.verdict) < rank.indexOf(alone.verdict), `${withBram.verdict} beside Bram, ${alone.verdict} against Kael alone`);
});

await test("the party splitting up is a moment a companion slips away; the whole party moving is not", async () => {
  const { world, pc, departure, still } = await table({ axes: { composure: 2 } });
  const done = await world.invoke("relationship_beat", { characterId: pc.id, subject: "Seren", beat: "murder_helpless", severity: "atrocity" });
  assert.equal(done.ok, true, done.error);
  assert.equal(departure().intent.response, "slip_away");
  const together = await world.invoke("move_party", { name: "The Crossroads", visionClear: false });
  assert.equal(together.ok, true, together.error);
  assert.ok(still(), "the whole party moved: no opening");
  const split = await world.invoke("move_party", { name: "The Old Mill", visionClear: false, characterIds: [pc.id] });
  assert.equal(split.ok, true, split.error);
  assert.match(split.result.note, /The party has split up: Kael went to The Old Mill, and Seren stayed behind\./);
  assert.match(split.result.note, /Seren slipped away while the party was split up/);
  assert.equal(still(), false);
  assert.equal(departure().gone.how, "Slipped away while the party was split up");
});

await test("one ceiling rule: a companion come back for the party fights whole at a Turn table, and answers to the ceiling elsewhere", async () => {
  const returning = [{ stats: { cr: 5 }, sheetFoe: { kind: "returning", npcId: "n", name: "Seren" } }];
  const at = (companionConscience) => rosterBudget({ difficulty: "normal", gameSettings: { relationships: "on", companionConscience } }, [3], returning);
  assert.equal(at("leave").tooDeadly, true, "at Leave a solo character's equal is past the ceiling");
  assert.equal(at("turn").tooDeadly, false, "at Turn the companion itself is never held back");
  assert.equal(at("turn").stagedXp, 0);
  // What is added beside it still answers to the ceiling.
  const beside = rosterBudget({ difficulty: "normal", gameSettings: { relationships: "on", companionConscience: "turn" } }, [3], [...returning, { stats: { cr: 8 } }]);
  assert.equal(beside.tooDeadly, true);
});

await test("a devoted companion heals her dying friend first; a wary one will not walk into a damaging area on her commander's word", async () => {
  const world = await openWorld({ gameSettings: { companions: "full" } });
  const kit = await combatKit(world);
  const kael = world.addHero({ name: "Kael", level: 3, maxHp: 30, proficiencies: TRAINED });
  const tobin = world.addHero({ name: "Tobin", level: 3, maxHp: 30 });
  const added = await world.invoke("add_companion", { name: "Seren", class: "cleric", gender: "Female", personality: "Watchful.", kind: "party", level: 3, spells: ["Cure Wounds"] });
  assert.equal(added.ok, true, added.error);
  const seren = world.sheets().find((entry) => entry.name === "Seren");
  const standing = (who, approval) => {
    const bond = relationships.ensureRelationship({ campaignId: world.campaignId, characterId: who.id, characterName: who.name, subjectKind: "companion", subjectName: "Seren" });
    relationships.patchRelationship(bond.id, { approval });
  };
  standing(kael, 90);
  world.patch(kael.id, { currentHp: 0, deathSaves: { successes: 0, failures: 0, stable: false, dead: false } });
  world.patch(tobin.id, { currentHp: 10 });
  const other = await world.invoke("heal", { characterId: tobin.id, casterId: seren.id, spell: "Cure Wounds", level: 1 });
  assert.equal(other.ok, false);
  assert.match(other.error, /^Seren will not spend a spell slot on Tobin while Kael lies dying: Seren is devoted to them and goes to them first\./);
  const friend = await world.invoke("heal", { characterId: kael.id, casterId: seren.id, spell: "Cure Wounds", level: 1 });
  assert.equal(friend.ok, true, friend.error);

  // Her commander's order into a Spike Growth an enemy laid.
  standing(kael, -30);
  world.patch(kael.id, { currentHp: 30 });
  await kit.fight(1, { heroFaces: { [kael.id]: 3, [tobin.id]: 3, [seren.id]: 19 } });
  const [goblin] = world.enemies();
  kit.place(kael.id, 12, 12);
  kit.place(tobin.id, 14, 14);
  kit.place(goblin.id, 18, 18);
  kit.place(seren.id, 5, 5);
  const map = getBattleMapForEncounter(world.encounter().id);
  const cell = (x, y) => y * map.width + x;
  saveZones(map.id, [{ id: "z1", spell: "Spike Growth", casterId: goblin.id, casterKind: "enemy", casterName: "Goblin", origin: { x: 7, y: 5 }, cells: [cell(6, 5), cell(7, 5), cell(8, 5)], concentration: false, castRound: 1, untilRound: null, slotLevel: 2, dc: 13 }]);
  // Kael's player commands her in the fight.
  sheetsDb.setCompanionCommander(seren.id, world.owner.id);
  kit.giveTurn(seren.id);
  world.signIn(world.owner);
  const route = await world.route("campaigns/[campaignId]/battle-map/move");
  const move = async (x, y) => {
    const response = await route.POST(new Request("http://test/", { method: "POST", body: JSON.stringify({ x, y }) }), { params: Promise.resolve({ campaignId: world.campaignId }) });
    return { status: response.status, body: await response.json() };
  };
  const into = await move(7, 5);
  assert.equal(into.status, 409, JSON.stringify(into.body));
  assert.match(into.body.error, /^Seren will not walk into the Spike Growth on Kael's word/);
  assert.equal(kit.token(seren.id).x, 5, "nothing moved");
  const around = await move(5, 3);
  assert.equal(around.status, 200, JSON.stringify(around.body));
});

finish();
