// A companion leaving the party and coming back (issue 503 Phases 2 and 3),
// through the engine the way the DM reaches it, with the dice under the
// test's control.
//
// At a Leave table a companion at its breaking point does what the server
// decides from who it is and the odds: a timid one walks out at once, a
// composed one holds a plan and goes at its opening (the night watch of a
// long rest, its own turn in a fight, whoever commanded it), a dutiful one
// reports the party and its standing falls. Turn lets one confront the
// party or bide until the party is weak, and then it turns where it stands:
// its own sheet on the foes' side, of the fight running or of one the server
// starts; after the fight it leaves, fell, or lies at the party's mercy. Talk and Off never depart anyone. A departure keeps the sheet; one
// who left hating the party gathers help on the agency dice, leaving
// rumours, kept pace with the party's experience, and comes back in a
// prepared fight budgeted under the table's ceiling, fighting as its own
// sheet on the foes' side, or to parley once its standing has climbed back. A held plan is the storyteller's alone: the
// lead of an AI table reads it nowhere, a person running a table does.
import assert from "node:assert/strict";
import "./lib/enforce-campaign.mjs";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";

const { test, finish } = suite("test-enforce-departure");
const npcs = await import("../src/lib/db/npcs.ts");
const relationships = await import("../src/lib/db/relationships.ts");
const campaigns = await import("../src/lib/db/campaigns.ts");
const messages = await import("../src/lib/db/messages.ts");
const turns = await import("../src/lib/db/dm-turns.ts");
const conscienceDb = await import("../src/lib/db/companion-conscience.ts");
const departuresDb = await import("../src/lib/db/companion-departures.ts");
const factions = await import("../src/lib/db/factions.ts");
const { getParty } = await import("../src/lib/db/party.ts");
const { listCalendarEvents } = await import("../src/lib/db/calendar-events.ts");
const { listActiveFacts } = await import("../src/lib/db/facts.ts");
const { listEncounterTemplates } = await import("../src/lib/db/encounter-templates.ts");
const { departureOpenings, intentLinesForPrompt, settleDepartures } = await import("../src/lib/dm/departure.ts");
const { returnDirectorNotes } = await import("../src/lib/dm/companion-revenge.ts");
const { returningCombatant } = await import("../src/lib/dm/companion-return.ts");
const { sideOf } = await import("../src/lib/dm/combatant.ts");
const { applyWear, slotPools } = await import("../src/lib/dm/companion-statblock.ts");
const { advanceNpcAgency } = await import("../src/lib/dm/npc-agency.ts");
const { deployTemplate, templateDifficulty } = await import("../src/lib/dm/encounter-templates.ts");
const { conscienceViews } = await import("../src/lib/dm/conscience.ts");
const { buildDmMessages } = await import("../src/lib/dm/prompt.ts");
const { storytellerLinesForPrompt } = await import("../src/lib/dm/scheme-tools.ts");

// A table with a lasting paladin who holds the innocent as a red line, her
// nature set so the response is the one a test means.
async function table({ gameSettings = {}, axes = {}, heroes = 1, level = 1, companion = {} } = {}) {
  // Lasting companions at any size of table, as a lead may set it.
  const world = await openWorld({ gameSettings: { companions: "full", ...gameSettings } });
  const party = [world.addHero({ name: "Kael", gender: "Male", level })];
  for (let index = 1; index < heroes; index += 1) {
    party.push(world.addHero({ name: `Hero ${index + 1}`, level }));
  }
  const added = await world.invoke("add_companion", {
    name: "Seren",
    class: "paladin",
    gender: "Female",
    alignment: "LG",
    personality: "Stern and devout.",
    kind: "party",
    ...companion,
  });
  assert.equal(added.ok, true, added.error);
  const sheet = world.sheets().find((entry) => entry.name === "Seren");
  const row = () => npcs.listNpcs(world.campaignId).find((npc) => npc.name === "Seren");
  npcs.patchNpcAgency(row().id, { personality: { drive: 0, diligence: 0, boldness: 0, warmth: 0, empathy: 0, composure: 0, ...axes } });
  const pc = party[0];
  const atrocity = () => world.invoke("relationship_beat", { characterId: pc.id, subject: "Seren", beat: "murder_helpless", severity: "atrocity", note: "Kael cut the bound prisoner's throat." });
  const departure = () => departuresDb.companionDeparture(row().id);
  return { world, pc, party, sheet, row, atrocity, departure, still: () => Boolean(world.sheet(sheet.id)) };
}

async function get(world, user, route, query = "") {
  world.signIn(user);
  const handler = await world.route(route);
  const response = await handler.GET(new Request(`http://test/${query}`), { params: Promise.resolve({ campaignId: world.campaignId }) });
  const body = await response.json();
  return { status: response.status, body, text: JSON.stringify(body) };
}

const lastLine = (world) => messages.listRecentMessages(world.campaignId, 4).map((message) => message.content).join("\n");

await test("a red-line atrocity walks a timid companion out at once at a Leave table, and her sheet is kept", async () => {
  const { world, row, atrocity, departure, still } = await table({ axes: { boldness: -2 } });
  const done = await atrocity();
  assert.equal(done.ok, true, done.error);
  assert.equal(done.result.departed, "Walked out on the party");
  assert.match(done.result.note, /Seren walked out on the party: the server has taken them out of the party \(their sheet is kept\)/);
  assert.match(done.result.note, /never call dismiss_companion/);
  assert.equal(still(), false, "out of the party");
  assert.ok(conscienceDb.departedSheet(row().id), "the row keeps her sheet");
  assert.equal(departure().gone.response, "walk_out");
  assert.equal(departure().gone.avenging, true, "she left hating them: she gathers help");
  assert.match(lastLine(world), /Seren walked out on the party\./, "the table is told by the server");
  const gone = await get(world, world.owner, "campaigns/[campaignId]/companions/gone");
  assert.equal(gone.status, 200);
  assert.deepEqual(gone.body.gone.map((entry) => [entry.name, entry.how]), [["Seren", "Walked out on the party"]]);
});

await test("a composed companion holds a plan, says nothing of it, and slips away at the night watch", async () => {
  const { world, atrocity, departure, still } = await table({ axes: { composure: 2 } });
  const done = await atrocity();
  assert.equal(done.ok, true, done.error);
  assert.equal(done.result.departed, undefined);
  assert.ok(still(), "she stays for now");
  assert.equal(departure().intent.response, "slip_away");
  assert.doesNotMatch(JSON.stringify(done.result), /slip|plan/i, "no result names the plan: a console call's result is read by whoever made it");
  const lines = intentLinesForPrompt(world.campaign(), world.sheets());
  assert.equal(lines.length, 1);
  assert.match(lines[0], /Seren means to slip away at the first moment the party is not watching/);
  assert.match(lines[0], /never say it/);
  const rest = await world.invoke("take_rest", { kind: "long" });
  assert.equal(rest.ok, true, rest.error);
  assert.equal(still(), false, "gone by morning");
  assert.equal(departure().gone.how, "Slipped away in the night");
  assert.match(rest.result.companionsLeft.join(" "), /Seren slipped away in the night/);
  assert.equal(departure().intent, null);
});

await test("a plan's opening on her own turn: she takes it back from her commander, breaks off and flees the field", async () => {
  const { world, sheet, atrocity, departure, still } = await table({ axes: { composure: 2 } });
  await atrocity();
  assert.equal(departure().intent.response, "slip_away");
  assert.equal(world.sheet(sheet.id).commandedBy, world.owner.id, "the solo player commands her in fights");
  // The fight opens on her turn (the bandit's die, then Kael's, then hers).
  world.dice([1, 5, 20]);
  const opened = await world.invoke("start_encounter", { enemies: [{ monster: "bandit", count: 1 }] });
  world.clearDice();
  assert.equal(opened.ok, true, opened.error);
  assert.equal(still(), false, "she fled on the turn she was given");
  assert.match(opened.result.companionsLeft.join(" "), /Seren broke off from the fight and fled the field/);
  assert.equal(departure().gone.how, "Broke off from the fight and fled the field");
  const encounter = world.encounter();
  assert.ok(!encounter.order.some((entry) => entry.characterId === sheet.id), "out of the order");
  assert.notEqual(encounter.order[encounter.turnIndex]?.characterId, sheet.id, "and the turn passed on");
});

await test("Talk never departs; Off never departs", async () => {
  for (const companionConscience of ["talk", "off"]) {
    const { world, atrocity, departure, still } = await table({ gameSettings: { companionConscience }, axes: { boldness: -2 } });
    const done = await atrocity();
    assert.equal(done.ok, true, done.error);
    assert.ok(still(), `${companionConscience}: she stays`);
    assert.deepEqual(settleDepartures(world.campaign()), [], companionConscience);
    assert.deepEqual(departureOpenings(world.campaign(), "long_rest"), []);
    await world.invoke("take_rest", { kind: "long" });
    assert.ok(still(), `${companionConscience}: still there after the night`);
    assert.deepEqual(departure(), departuresDb.companionDeparture("none"), "no plan, no departure");
    assert.deepEqual(intentLinesForPrompt(world.campaign(), world.sheets()), []);
  }
});

await test("a dutiful companion who respects the law reports the party, and its standing there falls", async () => {
  const world0 = await table({
    axes: { diligence: 3 },
    companion: { values: [{ value: "respects_law", strength: "red_line" }, { value: "protects_innocent", strength: "red_line" }] },
  });
  const watch = factions.insertFaction(world0.world.campaignId, { name: "the City Watch", power: 4 });
  factions.insertFaction(world0.world.campaignId, { name: "a Smugglers' Ring", power: 1 });
  const done = await world0.atrocity();
  assert.equal(done.result.departed, "Left to report the party to the City Watch");
  assert.equal(getParty(world0.world.campaignId).reputation[watch.id], -2);
  assert.match(done.result.note, /The party's standing with the City Watch fell/);
});

await test("at a Turn table a bold, rash companion confronts the party: she turns where she stands, her own sheet on the foes' side of a fight the server starts", async () => {
  const { world, sheet, row, atrocity, departure, still } = await table({ gameSettings: { companionConscience: "turn" }, axes: { boldness: 3, composure: -1 } });
  assert.equal(world.sheet(sheet.id).commandedBy, world.owner.id, "the solo player commands her");
  const done = await atrocity();
  assert.equal(done.ok, true, done.error);
  assert.equal(done.result.turned, "Turned on the party");
  assert.equal(done.result.departed, undefined, "she has not left");
  assert.match(done.result.note, /Seren turned on the party: the server has put them on the foes' side of a fight it started, them alone against the party, as their own sheet\. Nobody commands them now; you play them\./);
  assert.ok(still(), "her own sheet fights: nothing was deleted or copied");
  const encounter = world.encounter();
  assert.ok(encounter, "a fight is running");
  assert.equal(sideOf(encounter, "sheet", sheet.id), "foe");
  assert.equal(world.enemies().length, 0, "no stat block stands in for her");
  assert.equal(world.sheet(sheet.id).commandedBy, null, "her command is revoked");
  assert.equal(departure().turned.response, "confront");
  assert.equal(departure().gone, null);
  assert.equal(row().attitude, "hostile");
  assert.match(lastLine(world), /Seren turns against the party\./);
  assert.ok(!conscienceViews(world.campaign()).has("seren"), "past her conscience: no ladder while she fights them");
});

await test("biding to strike waits until the party has fallen low, then turns in the night: the fight starts at the watch", async () => {
  const { world, party, sheet, row, departure, still } = await table({ gameSettings: { companionConscience: "turn" }, heroes: 3 });
  departuresDb.saveDeparture(row().id, { intent: { response: "bide_strike", at: 0, cause: "torture by Kael" }, gone: null });
  conscienceDb.saveConscience(row().id, { ...conscienceDb.companionConscience(row().id), held: 4 });
  await world.invoke("take_rest", { kind: "long" });
  assert.ok(still(), "three whole characters: the odds are against her");
  assert.equal(world.encounter(), null);
  for (const hero of party) {
    world.patch(hero.id, { currentHp: 1 });
  }
  const outcomes = departureOpenings(world.campaign(), "long_rest");
  assert.equal(outcomes.length, 1);
  assert.equal(outcomes[0].turned, true);
  assert.equal(outcomes[0].how, "Turned on the party in the night");
  assert.equal(departure().turned.response, "bide_strike");
  assert.equal(departure().intent, null, "the plan is spent");
  assert.ok(still());
  assert.equal(sideOf(world.encounter(), "sheet", sheet.id), "foe");
});

await test("in a fight already running, a turn moves her to the foes' side on the spot and the DM plays her turn", async () => {
  const { world, sheet, row, departure } = await table({ gameSettings: { companionConscience: "turn" }, axes: { boldness: 3, composure: -1 } });
  world.dice([1, 20, 5]);
  const opened = await world.invoke("start_encounter", { enemies: [{ monster: "bandit", count: 1 }] });
  world.clearDice();
  assert.equal(opened.ok, true, opened.error);
  assert.equal(sideOf(world.encounter(), "sheet", sheet.id), "party");
  const encounterId = world.encounter().id;
  const done = await world.invoke("relationship_beat", { characterId: world.sheets().find((entry) => entry.name === "Kael").id, subject: "Seren", beat: "murder_helpless", severity: "atrocity", note: "Kael cut the bound prisoner's throat." });
  assert.equal(done.ok, true, done.error);
  assert.equal(done.result.turned, "Turned on the party");
  assert.match(done.result.note, /on the foes' side of this fight/);
  assert.equal(world.encounter().id, encounterId, "the same fight");
  assert.equal(sideOf(world.encounter(), "sheet", sheet.id), "foe");
  assert.equal(world.sheet(sheet.id).commandedBy, null);
  assert.equal(departure().turned.response, "confront");
  void row;
});

await test("after the fight a turncoat still standing leaves as a departed companion with her sheet kept, to come back with help", async () => {
  const { world, sheet, row, atrocity, departure, still } = await table({ gameSettings: { companionConscience: "turn" }, axes: { boldness: 3, composure: -1 } });
  await atrocity();
  assert.ok(world.encounter());
  const ended = await world.invoke("end_encounter", { outcome: "party_fled" });
  assert.equal(ended.ok, true, ended.error);
  assert.match(ended.result.turncoats, /Seren turned on the party and left to raise a force against them: the server has taken them out of the party \(their sheet is kept\)/);
  assert.equal(still(), false);
  assert.ok(conscienceDb.departedSheet(row().id), "the row keeps her sheet");
  assert.equal(departure().gone.response, "confront");
  assert.equal(departure().gone.hostile, true);
  assert.equal(departure().gone.avenging, true);
  assert.equal(departure().turned ?? null, null);
  assert.match(row().agency.goals.session.text, /bring down the party Seren left/);
  void sheet;
});

await test("a turncoat beaten to 0 lies at the party's mercy after the fight, out of it and dying, and crawls away at the next long rest", async () => {
  const { world, sheet, row, atrocity, departure, still } = await table({ gameSettings: { companionConscience: "turn" }, axes: { boldness: 3, composure: -1 } });
  await atrocity();
  // Struck down: dying, not dead (Phase 6's rule for a sheet on the foes' side).
  world.patch(sheet.id, { currentHp: 0, deathSaves: { successes: 0, failures: 0, stable: false, dead: false } });
  const ended = await world.invoke("end_encounter", { outcome: "victory" });
  assert.equal(ended.ok, true, ended.error);
  assert.match(ended.result.turncoats, /Seren lies beaten at 0 hit points, at the party's mercy/);
  assert.ok(still(), "still at the table, at their mercy");
  assert.equal(departure().turned.response, "confront");
  assert.deepEqual(settleDepartures(world.campaign()), [], "nothing moves while she lies there");
  const rest = await world.invoke("take_rest", { kind: "long" });
  assert.equal(rest.ok, true, rest.error);
  assert.equal(still(), false, "gone by morning");
  assert.equal(departure().gone.how, "Crawled away in the night, beaten");
  assert.equal(departure().gone.avenging, true);
  void row;
});

await test("a turncoat killed in the fight fell: off the party, never coming back", async () => {
  const { world, sheet, row, atrocity, departure, still } = await table({ gameSettings: { companionConscience: "turn" }, axes: { boldness: 3, composure: -1 } });
  await atrocity();
  world.patch(sheet.id, { currentHp: 0, deathSaves: { successes: 0, failures: 3, stable: false, dead: true } });
  const ended = await world.invoke("end_encounter", { outcome: "victory" });
  assert.equal(ended.ok, true, ended.error);
  assert.equal(still(), false);
  assert.equal(departure().gone.how, "Fell fighting the party");
  assert.equal(departure().gone.avenging, false);
  assert.equal(row().agency.goals.session, undefined, "no return to gather help for");
});

await test("a departed companion keeps pace with the party, gathers help with rumours, and returns at shadow level with allies inside the budget", async () => {
  const { world, party, row, sheet, atrocity, departure } = await table({ heroes: 4, level: 3, axes: { boldness: -2 } });
  const leftLevel = sheet.level;
  await atrocity();
  assert.equal(departure().gone.leftLevel, leftLevel);
  const awarded = await world.invoke("award_xp", { characterIds: party.map((hero) => hero.id), amount: 2000, reason: "the bandit camp" });
  assert.equal(awarded.ok, true, awarded.error);
  assert.equal(departure().gone.xpSince, 2000, "the party's award, counted on her record");
  const target = row().agency.goals.session.target;
  world.dice(new Array(target).fill(20));
  advanceNpcAgency(world.campaignId, "", { rounds: target, tickPressureCounters: false });
  world.clearDice();
  const rumours = listActiveFacts(world.campaignId).filter((fact) => fact.subject.toLowerCase().startsWith("rumour of seren"));
  assert.ok(rumours.length >= 1, "rumours as DM-only facts");
  assert.ok(rumours.every((fact) => fact.knownBy === "dm"));
  const gone = departure().gone;
  assert.equal(gone.cued, "fight");
  const prepared = listEncounterTemplates(world.campaignId).find((entry) => entry.id === gone.templateId);
  assert.ok(prepared, "a prepared fight");
  assert.equal(prepared.name, "Seren's return");
  assert.equal(prepared.enemies[0].monster, "Seren");
  assert.equal(gone.wear, null, "four characters: she need not be worn");
  assert.ok(prepared.enemies.length > 1, "she brings allies");
  const readout = templateDifficulty(world.campaign(), prepared.enemies);
  assert.equal(readout.unknownMonster, null, "she resolves as herself");
  assert.equal(readout.tooDeadly, false, `inside the ceiling (${readout.adjustedXp} of ${readout.ceiling})`);
  assert.match(readout.verdict, /^(hard|deadly)/);
  const event = listCalendarEvents(world.campaignId, true).find((entry) => entry.id === gone.eventId);
  assert.equal(event.visibility, "dm");
  assert.ok(!listCalendarEvents(world.campaignId, false).some((entry) => entry.id === gone.eventId));
  assert.match(returnDirectorNotes(world.campaign()).join(" "), /run_prepared_encounter/);
  world.dice(new Array(20).fill(10));
  const started = await deployTemplate(world.campaign(), world.owner.id, prepared);
  world.clearDice();
  assert.equal(started.ok, true, started.error);
  assert.ok(!world.enemies().some((enemy) => enemy.displayName === "Seren"), "no stat block stands in for her");
  const her = world.sheets().find((entry) => entry.name === "Seren");
  assert.ok(her, "she fights as her own sheet");
  assert.equal(sideOf(world.encounter(), "sheet", her.id), "foe", "on the foes' side");
  assert.equal(her.class, "paladin");
  assert.equal(her.level, leftLevel + 1, "at the level she kept pace to");
  assert.ok(her.maxHp > sheet.maxHp, "her hit points grew with her level");
  assert.equal(her.currentHp, her.maxHp, "whole: she arrives at her maximum");
  assert.equal(her.commandedBy, null, "nobody commands her: the DM plays her");
  assert.ok(world.enemies().length >= 1, "with her allies");
  assert.ok(world.encounter().order.some((entry) => entry.characterId === her.id) || !world.encounter().orderReady, "in the order");
  assert.equal(departure().gone.returned, true, "the return has run");
  assert.ok(!listEncounterTemplates(world.campaignId).some((entry) => entry.name === "Seren's return"), "and its prepared fight is spent");
  assert.equal(row().attitude, "hostile");
});

await test("a companion whose standing has climbed back comes to parley, and rejoins at shadow level as herself", async () => {
  const { world, pc, party, row, sheet, atrocity, departure } = await table({ heroes: 2, level: 3, axes: { boldness: -2 } });
  await atrocity();
  await world.invoke("award_xp", { characterIds: party.map((hero) => hero.id), amount: 2000, reason: "a long road" });
  const bond = relationships.getRelationship(world.campaignId, pc.id, "Seren");
  relationships.patchRelationship(bond.id, { approval: 5 });
  for (const hero of party.slice(1)) {
    const other = relationships.getRelationship(world.campaignId, hero.id, "Seren");
    if (other) relationships.patchRelationship(other.id, { approval: 5 });
  }
  const target = row().agency.goals.session.target;
  world.dice(new Array(target).fill(20));
  advanceNpcAgency(world.campaignId, "", { rounds: target, tickPressureCounters: false });
  world.clearDice();
  assert.equal(departure().gone.cued, "parley");
  assert.equal(departure().gone.templateId, "", "no fight is prepared");
  assert.match(returnDirectorNotes(world.campaign()).join(" "), /seeks them out to talk, not to fight/);
  const back = await world.invoke("add_companion", { name: "Seren", class: "paladin", gender: "Female", personality: "Home.", kind: "party", level: 1 });
  assert.equal(back.ok, true, back.error);
  assert.equal(back.result.returned, true);
  const now = world.sheets().find((entry) => entry.name === "Seren");
  assert.equal(now.class, "paladin");
  assert.equal(now.level, sheet.level + 1, "the level she kept pace to, not the one the call named");
  assert.deepEqual(departure(), departuresDb.companionDeparture("none"), "her leaving is behind her");
  assert.equal(conscienceViews(world.campaign()).get("seren").rung, "content", "she starts afresh");
  const gone = await get(world, world.owner, "campaigns/[campaignId]/companions/gone");
  assert.deepEqual(gone.body.gone, [], "off the Gone list");
});

// Lets the agency dice finish a departed companion's goal at once.
function finishGoal(world, row) {
  const target = row().agency.goals.session.target;
  world.dice(new Array(target).fill(20));
  advanceNpcAgency(world.campaignId, "", { rounds: target, tickPressureCounters: false });
  world.clearDice();
}

await test("a solo character's equal comes back alone and worn: inside the ceiling, never below half her hit points, and the DM is told why", async () => {
  const { world, row, atrocity, departure } = await table({ level: 3, axes: { boldness: -2 } });
  await atrocity();
  finishGoal(world, row);
  const gone = departure().gone;
  assert.equal(gone.cued, "fight", "a fight, not a standoff");
  assert.equal(gone.standoff, false);
  assert.ok(gone.wear, "worn");
  const whole = returningCombatant(world.campaign(), row().id, "Seren", null);
  const worn = returningCombatant(world.campaign(), row().id, "Seren");
  assert.ok(worn.cr < whole.cr, `rated as she stands (CR ${worn.cr} against ${whole.cr} whole)`);
  assert.ok(worn.currentHp < whole.stats.maxHp && worn.currentHp >= Math.ceil(whole.stats.maxHp / 2), `${worn.currentHp} of ${whole.stats.maxHp}: never below half`);
  assert.match(gone.wornBy, /hard road/);
  assert.match(gone.wornBy, new RegExp(`${worn.currentHp} of ${whole.stats.maxHp} hit points`));
  const prepared = listEncounterTemplates(world.campaignId).find((entry) => entry.id === gone.templateId);
  assert.deepEqual(prepared.enemies, [{ monster: "Seren", count: 1 }], "alone");
  assert.match(prepared.notes, /alone and worn/);
  const readout = templateDifficulty(world.campaign(), prepared.enemies);
  assert.equal(readout.tooDeadly, false, `inside the ceiling (${readout.adjustedXp} of ${readout.ceiling})`);
  assert.match(readout.verdict, /^(hard|deadly)/);
  const cue = returnDirectorNotes(world.campaign()).join(" ");
  assert.match(cue, /alone and worn: .*hard road/);
  assert.match(cue, /Narrate the wear/);
  const event = listCalendarEvents(world.campaignId, true).find((entry) => entry.id === gone.eventId);
  assert.match(event.title, /alone and worn/);
  assert.equal(event.visibility, "dm");
  world.dice(new Array(20).fill(10));
  const started = await deployTemplate(world.campaign(), world.owner.id, prepared);
  world.clearDice();
  assert.equal(started.ok, true, started.error);
  const her = world.sheets().find((entry) => entry.name === "Seren");
  assert.ok(her, "she fights as her own sheet");
  assert.equal(sideOf(world.encounter(), "sheet", her.id), "foe");
  assert.equal(world.enemies().length, 0, "alone");
  assert.equal(her.currentHp, worn.currentHp, "she arrives worn");
  assert.equal(her.maxHp, whole.stats.maxHp, "out of her own maximum");
  const spent = Object.values(gone.wear.slotsSpent).reduce((sum, count) => sum + count, 0);
  const used = Object.values(her.spellcasting?.slots ?? {}).reduce((sum, slot) => sum + slot.used, 0) + (her.spellcasting?.pact?.used ?? 0);
  assert.equal(used, spent, "her slots spent as the wear says");
});

await test("one past the ceiling even worn to the floor comes in a standoff in words", async () => {
  const { world, row, atrocity, departure } = await table({ gameSettings: {}, level: 1, axes: { boldness: -2 }, companion: { level: 7 } });
  await atrocity();
  finishGoal(world, row);
  const gone = departure().gone;
  assert.equal(gone.cued, "parley");
  assert.equal(gone.standoff, true);
  assert.equal(gone.wear, null);
  assert.equal(gone.templateId, "", "no fight is prepared");
  assert.match(returnDirectorNotes(world.campaign()).join(" "), /even worn to half their strength/);
});

await test("a wear lowers a sheet's own hit points and marks its slots spent, highest first: the rule Phase 6's real sheet keeps", async () => {
  const sheet = {
    name: "Ilsa",
    level: 5,
    class: "wizard",
    maxHp: 30,
    currentHp: 30,
    spellcasting: { ability: "int", slots: { 1: { max: 4, used: 0 }, 2: { max: 3, used: 0 }, 3: { max: 2, used: 1 } }, prepared: [], known: [], cantrips: [] },
  };
  assert.deepEqual(slotPools(sheet).map((pool) => [pool.key, pool.count]), [["1", 4], ["2", 3], ["3", 1]]);
  const worn = applyWear(sheet, { hpLost: 12, slotsSpent: { 3: 1, 2: 1 } });
  assert.equal(worn.currentHp, 18);
  assert.equal(worn.maxHp, 30, "out of its own maximum");
  assert.deepEqual(worn.spellcasting.slots, { 1: { max: 4, used: 0 }, 2: { max: 3, used: 1 }, 3: { max: 2, used: 2 } });
  assert.equal(sheet.currentHp, 30, "the sheet given is left as it was");
});

await test("where companions may turn, a command that ends on her own turn hands that turn to the DM", async () => {
  const { world, pc, sheet } = await table({ gameSettings: { companionConscience: "turn" } });
  await world.beginFight([{ monster: "bandit", count: 1 }], { heroFaces: { [sheet.id]: 20, [pc.id]: 5 } });
  const encounter = world.encounter();
  assert.equal(encounter.order[encounter.turnIndex].characterId, sheet.id, "her turn");
  assert.deepEqual(campaigns.getFloor(world.campaignId).userIds, [world.owner.id], "her commander's floor");
  await world.invoke("relationship_beat", { characterId: pc.id, subject: "Seren", beat: "cruelty" });
  await world.invoke("relationship_beat", { characterId: pc.id, subject: "Seren", beat: "broke_word" });
  assert.equal(world.sheet(sheet.id).commandedBy, null);
  assert.deepEqual(campaigns.getFloor(world.campaignId).userIds, [sheet.userId], "the turn is the DM's now");
});

// ---- who may read a held plan ----

const PLAN = /slip away|means to/i;

await test("the lead of an AI table reads a held plan nowhere: Bonds, ?secrets=1, facts, the Context tab", async () => {
  const { world, atrocity, departure } = await table({ axes: { composure: 2 }, heroes: 2 });
  await atrocity();
  assert.ok(departure().intent);
  const bonds = await get(world, world.owner, "campaigns/[campaignId]/relationships");
  assert.equal(bonds.status, 200);
  assert.doesNotMatch(bonds.text, PLAN);
  assert.ok(!bonds.body.relationships.some((row) => row.conscience?.plan), "no plan on any row");
  const secrets = await get(world, world.owner, "campaigns/[campaignId]/facts", "?secrets=1");
  assert.equal(secrets.status, 200);
  assert.doesNotMatch(secrets.text, PLAN);
  const campaign = world.campaign();
  const sheets = world.sheets();
  const state = {
    campaign,
    members: campaigns.listMembers(world.campaignId),
    sheets,
    recentRolls: [],
    storySummary: "",
    contextLimitTokens: 32_000,
    storytellerLines: [...storytellerLinesForPrompt(campaign, sheets, []), ...intentLinesForPrompt(campaign, sheets)],
  };
  const conversation = buildDmMessages(state, []);
  assert.match(conversation.map((message) => message.content).join("\n"), /Seren means to slip away/, "the AI has it");
  assert.ok(state.contextTrace.blocks.some((block) => block.id === "storyteller"), "costed on the storyteller's row");
  const turn = turns.createDmTurn(world.campaignId, conversation);
  turn.contextTrace = state.contextTrace;
  turns.saveDmTurn(turn);
  const trace = await get(world, world.owner, "campaigns/[campaignId]/context-trace");
  assert.equal(trace.status, 200);
  assert.ok(!trace.body.trace.blocks.some((block) => block.id === "storyteller"), "no storyteller row for the lead");
  assert.doesNotMatch(trace.text, PLAN);
});

await test("nor does a lore check the lead runs on her hand the checker the plan", async () => {
  const { fakeModel, reply, settleQueue } = await import("./lib/enforce-narrator.mjs");
  const model = await fakeModel();
  try {
    const { world, atrocity, departure } = await table({ axes: { composure: 2 }, heroes: 2 });
    model.pointAt(world);
    await atrocity();
    assert.ok(departure().intent);
    const factsDb = await import("../src/lib/db/facts.ts");
    factsDb.insertFact({ campaignId: world.campaignId, category: "npc", subject: "Seren", fact: "Seren keeps the road watch.", knownBy: "party", pinned: true, source: "manual" });
    factsDb.insertFact({ campaignId: world.campaignId, category: "npc", subject: "Seren", fact: "Seren was raised by a temple of the dawn.", knownBy: "dm", pinned: true, source: "manual" });
    for (const category of ["wrong_fact", "out_of_character"]) {
      const narration = messages.insertCampaignMessage({
        campaignId: world.campaignId,
        seq: campaigns.allocateSeq(world.campaignId),
        authorType: "dm",
        content: "Seren keeps her pack packed by the door.",
      });
      model.script([reply({ text: JSON.stringify({ verdict: "consistent", explanation: "Fine.", citations: [], rewrite: null }) })]);
      world.signIn(world.owner);
      const route = await world.route("campaigns/[campaignId]/lore-check");
      const response = await route.POST(
        new Request("http://test/", { method: "POST", body: JSON.stringify({ messageId: narration.id, category, ...(category === "wrong_fact" ? {} : { npcName: "Seren" }) }) }),
        { params: Promise.resolve({ campaignId: world.campaignId }) },
      );
      await settleQueue(world.campaignId);
      assert.equal(response.status, 200, `${category}: ${JSON.stringify(await response.clone().json())} after ${model.requests.length} requests`);
      const evidence = model.requests.at(-1).messages.map((message) => String(message.content ?? "")).join("\n");
      assert.match(evidence, /temple of the dawn/, `${category}: the lead's own DM secrets are there`);
      assert.doesNotMatch(evidence, PLAN, `${category}: the plan is not the checker's to quote`);
    }
  } finally {
    model.close();
  }
});

await test("at a table a person runs, that person reads the plan on the Bonds tab", async () => {
  const world = await openWorld({ gameSettings: { dmMode: "human" } });
  const leadUser = world.addUser("lead");
  const pc = world.addHero({ user: leadUser, name: "Kael", gender: "Male" });
  const added = await world.invoke("add_companion", { name: "Seren", class: "paladin", gender: "Female", alignment: "LG", personality: "Stern.", kind: "party" });
  assert.equal(added.ok, true, added.error);
  const row = npcs.listNpcs(world.campaignId).find((npc) => npc.name === "Seren");
  npcs.patchNpcAgency(row.id, { personality: { drive: 0, diligence: 0, boldness: 0, warmth: 0, empathy: 0, composure: 2 } });
  await world.invoke("relationship_beat", { characterId: pc.id, subject: "Seren", beat: "murder_helpless", severity: "atrocity" });
  assert.ok(departuresDb.companionDeparture(row.id).intent);
  const dm = await get(world, world.owner, "campaigns/[campaignId]/relationships");
  assert.match(dm.body.relationships.find((entry) => entry.subjectName === "Seren").conscience.plan, /slip away/);
  const player = await get(world, leadUser, "campaigns/[campaignId]/relationships");
  assert.doesNotMatch(player.text, PLAN, "its lead plays a character: never theirs");
});

finish();
