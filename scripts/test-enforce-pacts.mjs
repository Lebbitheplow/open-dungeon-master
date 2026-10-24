// Pacts (issue 503 Phase 5), through the engine the way the DM reaches it,
// with the dice under the test's control.
//
// A wavering companion recruits where companions talk unobserved (the night
// watch of a long rest, the road), once per long rest: its Persuasion or
// Deception, rolled where no player sees it, against a DC set by the
// target's regard for the party. A success makes a pact and moves the
// target a rung. The pact is the storyteller's: the lead of an AI table
// reads it nowhere, not on the Bonds tab, not through ?secrets=1, not in the
// Context tab, not in the dice. A character whose passive Insight beats a
// member's Deception is told privately. When it is ready, its plan goes
// through real rules: theft moves inventory, a false trail costs a day and
// a Survival contest, denouncing moves reputation; then its companions
// leave through the departure Phase 2 built.
import assert from "node:assert/strict";
import "./lib/enforce-campaign.mjs";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";

const { test, finish } = suite("test-enforce-pacts");
const npcs = await import("../src/lib/db/npcs.ts");
const campaigns = await import("../src/lib/db/campaigns.ts");
const messages = await import("../src/lib/db/messages.ts");
const turns = await import("../src/lib/db/dm-turns.ts");
const rolls = await import("../src/lib/db/rolls.ts");
const whispers = await import("../src/lib/db/dm-whispers.ts");
const conscienceDb = await import("../src/lib/db/companion-conscience.ts");
const pactsDb = await import("../src/lib/db/pacts.ts");
const factions = await import("../src/lib/db/factions.ts");
const { getClock } = await import("../src/lib/db/clock.ts");
const { getParty } = await import("../src/lib/db/party.ts");
const { CONTENT } = await import("../src/lib/dm/conscience-logic.ts");
const { pactLinesForPrompt, replan } = await import("../src/lib/dm/pacts.ts");
const { buildDmMessages } = await import("../src/lib/dm/prompt.ts");
const { storytellerLinesForPrompt } = await import("../src/lib/dm/scheme-tools.ts");
const { capsFor } = campaigns;
const { computeSheetDerived } = await import("../src/lib/srd/index.ts");

// What would give a pact away: its line, its members' plan, its dice.
const PACT = /A pact:|to turn Thorne|Deception, keeping|mean to (leave|weaken|turn)/i;

// Two players and two lasting companions: Seren the paladin and Thorne, of
// whatever class a test needs.
// The road tests travel three hours: a leg of four or more rolls the sky,
// and frigid or hot air makes every traveller's hourly saves first, which
// took the dice queued for the pact's own rolls.
async function table({ gameSettings = {}, thorne = {}, kael = {}, brin = {} } = {}) {
  const world = await openWorld({ gameSettings: { companions: "full", ...gameSettings } });
  const kaelSheet = world.addHero({ name: "Kael", gender: "Male", ...kael });
  const brinUser = world.addUser("brin");
  const brinSheet = world.addHero({ user: brinUser, name: "Brin", gender: "Female", ...brin });
  for (const [name, args] of [["Seren", { class: "paladin", alignment: "LG", gender: "Female" }], ["Thorne", { class: "rogue", gender: "Male", ...thorne }]]) {
    const added = await world.invoke("add_companion", { name, personality: "Quiet.", kind: "party", ...args });
    assert.equal(added.ok, true, added.error);
  }
  const row = (name) => npcs.listNpcs(world.campaignId).find((npc) => npc.name === name);
  const axes = (name, values) => npcs.patchNpcAgency(row(name).id, { personality: { drive: 0, diligence: 0, boldness: 0, warmth: 0, empathy: 0, composure: 0, ...values } });
  axes("Seren", {});
  axes("Thorne", {});
  const rung = (name, held) => conscienceDb.saveConscience(row(name).id, { ...CONTENT, held, shown: held });
  const companion = (name) => world.sheets().find((sheet) => sheet.name === name);
  const pacts = () => pactsDb.listPacts(world.campaignId);
  return { world, kael: kaelSheet, brin: brinSheet, brinUser, row, axes, rung, companion, pacts };
}

// A pact already formed, as recruiting would have left it.
function formPact(t, names) {
  const campaign = t.world.campaign();
  const members = names.map((name) => ({ kind: "companion", npcId: t.row(name).id, name, sheetId: t.companion(name).id }));
  const pact = pactsDb.insertPact({ campaignId: t.world.campaignId, leaderNpcId: members[0].npcId, members, plan: "leave", tactic: null, trigger: "night_watch", createdAt: getClock(t.world.campaignId).instant });
  return pactsDb.savePact(replan(campaign, pact));
}

async function get(world, user, route, query = "") {
  world.signIn(user);
  const handler = await world.route(route);
  const response = await handler.GET(new Request(`http://test/${query}`), { params: Promise.resolve({ campaignId: world.campaignId }) });
  const body = await response.json();
  return { status: response.status, body, text: JSON.stringify(body) };
}

const secretRolls = (world) => rolls.listRecentRolls(world.campaignId, 50).filter((roll) => roll.visibility === "secret");

async function longRest(world, faces) {
  world.dice(faces);
  const rest = await world.invoke("take_rest", { kind: "long" });
  world.clearDice();
  assert.equal(rest.ok, true, rest.error);
  return rest;
}

await test("a wavering companion recruits at the night watch: a hidden roll against the DC, a pact, and the target a rung down", async () => {
  const t = await table();
  t.rung("Seren", 1);
  const rest = await longRest(t.world, [20, 20, 20]);
  const [pact] = t.pacts();
  assert.ok(pact, "a pact formed");
  assert.deepEqual(pact.members.map((member) => member.name).sort(), ["Seren", "Thorne"]);
  assert.equal(pact.status, "forming");
  assert.equal(conscienceDb.companionConscience(t.row("Thorne").id).held, 1, "Thorne moved one rung down, to uneasy");
  const [recruiting] = secretRolls(t.world).filter((roll) => /Seren: (Persuasion|Deception) to turn Thorne \(DC 13\)/.test(roll.detail));
  assert.ok(recruiting, "the recruiter's roll is stored as a storyteller secret, with its DC");
  assert.doesNotMatch(JSON.stringify(rest.result), PACT, "nothing the rest returns names the pact");
  assert.doesNotMatch(messages.listRecentMessages(t.world.campaignId, 10).map((message) => message.content).join("\n"), /Seren|Thorne/, "a quiet recruiter says nothing the table hears");
});

await test("a devoted companion is nearly impossible to turn: the same roll fails against a high DC, and no pact forms", async () => {
  const t = await table();
  t.rung("Seren", 1);
  const relationships = await import("../src/lib/db/relationships.ts");
  for (const sheet of [t.kael, t.brin]) {
    const row = relationships.ensureRelationship({ campaignId: t.world.campaignId, characterId: sheet.id, characterName: sheet.name, subjectKind: "companion", subjectName: "Thorne" });
    relationships.patchRelationship(row.id, { approval: 90 });
  }
  await longRest(t.world, [10, 20, 20]);
  assert.deepEqual(t.pacts(), [], "no pact");
  assert.ok(secretRolls(t.world).some((roll) => /to turn Thorne \(DC 28\)/.test(roll.detail)), "the DC for a devoted companion is 28");
});

await test("once per long rest: the road the same day tries nothing more, the next long rest tries again", async () => {
  const t = await table();
  t.rung("Seren", 1);
  await longRest(t.world, [1, 20, 20]);
  assert.equal(secretRolls(t.world).filter((roll) => /to turn/.test(roll.detail)).length, 1, "one attempt at the rest");
  t.world.dice([20, 20, 20]);
  const travel = await t.world.invoke("travel", { hours: 3 });
  t.world.clearDice();
  assert.equal(travel.ok, true, travel.error);
  assert.equal(secretRolls(t.world).filter((roll) => /to turn/.test(roll.detail)).length, 1, "none on the road before the next rest");
  await t.world.invoke("pass_time", { amount: 24, unit: "hours" });
  await longRest(t.world, [20, 20, 20]);
  assert.equal(secretRolls(t.world).filter((roll) => /to turn/.test(roll.detail)).length, 2, "the next long rest tries again");
  assert.equal(t.pacts().length, 1);
});

await test("the road is a recruiting moment too, for one who has not tried since its last rest", async () => {
  const t = await table();
  t.rung("Seren", 1);
  t.world.dice([20, 20, 20]);
  const travel = await t.world.invoke("travel", { hours: 3 });
  t.world.clearDice();
  assert.equal(travel.ok, true, travel.error);
  assert.equal(t.pacts().length, 1, "a pact formed on the road");
  assert.doesNotMatch(JSON.stringify(travel.result), PACT);
});

await test("the lead of an AI table reads a pact nowhere: Bonds, ?secrets=1, facts, the dice, the pact route, the Context tab", async () => {
  const t = await table();
  t.rung("Seren", 1);
  await longRest(t.world, [20, 20, 20]);
  assert.equal(t.pacts().length, 1);
  const owner = t.world.owner;
  const bonds = await get(t.world, owner, "campaigns/[campaignId]/relationships");
  assert.equal(bonds.status, 200);
  assert.doesNotMatch(bonds.text, PACT);
  const facts = await get(t.world, owner, "campaigns/[campaignId]/facts", "?secrets=1");
  assert.equal(facts.status, 200);
  assert.doesNotMatch(facts.text, PACT);
  const snapshot = await get(t.world, owner, "campaigns/[campaignId]");
  assert.equal(snapshot.status, 200);
  assert.ok(!snapshot.body.rolls.some((roll) => roll.visibility === "secret"), "no secret roll in the lead's dice");
  assert.equal(rolls.listRollsVisibleTo(t.world.campaignId, capsFor(t.world.campaign(), owner.id), [t.kael.id], 50).filter((roll) => roll.visibility === "secret").length, 0);
  const pact = await get(t.world, owner, "campaigns/[campaignId]/pact");
  assert.deepEqual(pact.body, { pacts: [] }, "the lead is in no pact and is not the storyteller");
  const campaign = t.world.campaign();
  const sheets = t.world.sheets();
  const state = {
    campaign,
    members: campaigns.listMembers(t.world.campaignId),
    sheets,
    recentRolls: [],
    storySummary: "",
    contextLimitTokens: 32_000,
    storytellerLines: [...storytellerLinesForPrompt(campaign, sheets, []), ...pactLinesForPrompt(campaign, sheets)],
  };
  const conversation = buildDmMessages(state, []);
  assert.match(conversation.map((message) => message.content).join("\n"), /A pact: (Seren, Thorne|Thorne, Seren), led by/, "the AI has it");
  const turn = turns.createDmTurn(t.world.campaignId, conversation);
  turn.contextTrace = state.contextTrace;
  turns.saveDmTurn(turn);
  const trace = await get(t.world, owner, "campaigns/[campaignId]/context-trace");
  assert.equal(trace.status, 200);
  assert.ok(!trace.body.trace.blocks.some((block) => block.id === "storyteller"), "no storyteller row for the lead");
  assert.doesNotMatch(trace.text, /A pact:/);
});

await test("nor does a lore check the lead runs hand the checker the pact", async () => {
  const { fakeModel, reply, settleQueue } = await import("./lib/enforce-narrator.mjs");
  const model = await fakeModel();
  try {
    const t = await table();
    model.pointAt(t.world);
    t.rung("Seren", 1);
    await longRest(t.world, [20, 20, 20]);
    assert.equal(t.pacts().length, 1);
    const factsDb = await import("../src/lib/db/facts.ts");
    factsDb.insertFact({ campaignId: t.world.campaignId, category: "npc", subject: "Seren", fact: "Seren was raised by a temple of the dawn.", knownBy: "dm", pinned: true, source: "manual" });
    for (const category of ["wrong_fact", "out_of_character"]) {
      const narration = messages.insertCampaignMessage({
        campaignId: t.world.campaignId,
        seq: campaigns.allocateSeq(t.world.campaignId),
        authorType: "dm",
        content: "Seren and Thorne keep their own watch tonight.",
      });
      model.script([reply({ text: JSON.stringify({ verdict: "consistent", explanation: "Fine.", citations: [], rewrite: null }) })]);
      t.world.signIn(t.world.owner);
      const route = await t.world.route("campaigns/[campaignId]/lore-check");
      const response = await route.POST(
        new Request("http://test/", { method: "POST", body: JSON.stringify({ messageId: narration.id, category, ...(category === "wrong_fact" ? {} : { npcName: "Seren" }) }) }),
        { params: Promise.resolve({ campaignId: t.world.campaignId }) },
      );
      await settleQueue(t.world.campaignId);
      assert.equal(response.status, 200, `${category}: ${JSON.stringify(await response.clone().json())}`);
      const evidence = model.requests.at(-1).messages.map((message) => String(message.content ?? "")).join("\n");
      assert.match(evidence, /temple of the dawn/, `${category}: the lead's own DM secrets are there`);
      assert.doesNotMatch(evidence, PACT, `${category}: the pact is not the checker's to quote`);
    }
  } finally {
    model.close();
  }
});

await test("at a table a person runs, that person reads the pact and its dice", async () => {
  const world = await openWorld({ gameSettings: { dmMode: "human", companions: "full" } });
  const lead = world.addUser("lead");
  world.addHero({ user: lead, name: "Kael" });
  for (const name of ["Seren", "Thorne"]) {
    const added = await world.invoke("add_companion", { name, class: "fighter", gender: "Female", personality: "Quiet.", kind: "party" });
    assert.equal(added.ok, true, added.error);
  }
  const seren = npcs.listNpcs(world.campaignId).find((npc) => npc.name === "Seren");
  conscienceDb.saveConscience(seren.id, { ...CONTENT, held: 1, shown: 1 });
  await longRest(world, [20, 20, 20]);
  const dm = await get(world, world.owner, "campaigns/[campaignId]/pact");
  assert.equal(dm.body.all?.length, 1, `the person running it reads every pact: ${dm.text} ${JSON.stringify(rolls.listRecentRolls(world.campaignId, 20).map((roll) => roll.detail))}`);
  const dice = await get(world, world.owner, "campaigns/[campaignId]");
  assert.ok(dice.body.rolls.some((roll) => roll.visibility === "secret"), "and its dice");
  const player = await get(world, lead, "campaigns/[campaignId]");
  assert.ok(!player.body.rolls.some((roll) => roll.visibility === "secret"), "a player does not");
});

await test("a tell: a passive Insight that beats a member's Deception is whispered to that player alone", async () => {
  const t = await table({ brin: { abilities: { wis: 20 } }, kael: { abilities: { wis: 6 } } });
  t.rung("Seren", 1);
  // Each member's Deception lands on 10: past Kael's passive Insight of 8,
  // short of Brin's 15.
  const face = (name) => Math.max(1, Math.min(20, 10 - (computeSheetDerived(t.companion(name)).skills.deception ?? 0)));
  await longRest(t.world, [20, face("Seren"), face("Thorne")]);
  assert.equal(t.pacts().length, 1);
  const brinNotes = whispers.listWhispersForUser(t.world.campaignId, t.brinUser.id).map((entry) => entry.content);
  const kaelNotes = whispers.listWhispersForUser(t.world.campaignId, t.world.owner.id).map((entry) => entry.content);
  assert.equal(brinNotes.filter((text) => /Brin notices something about/.test(text)).length, 1, "Brin is told, once");
  assert.equal(kaelNotes.length, 0, "Kael is told nothing");
  assert.deepEqual(t.pacts()[0].toldTo, [t.brin.id]);
  await t.world.invoke("pass_time", { amount: 24, unit: "hours" });
  await longRest(t.world, [1, 1]);
  assert.equal(whispers.listWhispersForUser(t.world.campaignId, t.brinUser.id).filter((entry) => /notices something/.test(entry.content)).length, 1, "never twice for one pact");
});

await test("theft moves inventory: the thief's Sleight of Hand beats the watch, the party's best thing leaves with the pact", async () => {
  const t = await table({ kael: { equipment: [{ name: "Spyglass", qty: 1, worth: 1000 }] } });
  t.axes("Thorne", { drive: 2 });
  t.rung("Seren", 2);
  t.rung("Thorne", 2);
  const pact = formPact(t, ["Thorne", "Seren"]);
  assert.equal(pact.plan, "sabotage");
  assert.equal(pact.tactic, "theft");
  const thorneRow = t.row("Thorne");
  await longRest(t.world, [20]);
  assert.equal(pactsDb.getPact(pact.id).status, "fired");
  assert.ok(!t.world.sheet(t.kael.id).equipment.some((item) => item.name === "Spyglass"), "gone from Kael's pack");
  assert.ok(conscienceDb.departedSheet(thorneRow.id).sheet.equipment.some((item) => item.name === "Spyglass"), "in the pack Thorne left with");
  assert.equal(t.companion("Thorne"), undefined, "Thorne is gone");
  assert.equal(t.companion("Seren"), undefined, "and Seren with him");
  const lines = messages.listRecentMessages(t.world.campaignId, 12).map((message) => message.content).join("\n");
  assert.match(lines, /\[Revealed\] The pact made its move: Thorne, Seren/);
  assert.match(lines, /Thorne took Kael's Spyglass in the night/);
});

await test("a watch that sees the theft keeps the thing, and the pact walks out exposed", async () => {
  const t = await table({ kael: { equipment: [{ name: "Spyglass", qty: 1, worth: 1000 }], abilities: { wis: 20 } } });
  t.axes("Thorne", { drive: 2 });
  t.rung("Seren", 2);
  t.rung("Thorne", 2);
  formPact(t, ["Thorne", "Seren"]);
  await longRest(t.world, [1]);
  assert.ok(t.world.sheet(t.kael.id).equipment.some((item) => item.name === "Spyglass"), "still Kael's");
  assert.match(messages.listRecentMessages(t.world.campaignId, 12).map((message) => message.content).join("\n"), /Kael caught Thorne with a hand in the party's packs/);
  assert.equal(t.companion("Thorne"), undefined, "they go anyway, openly");
});

await test("a false trail costs a day: the guide's Survival beats the party's, the clock moves, the pact slips away", async () => {
  const t = await table({ thorne: { class: "ranger" } });
  t.axes("Thorne", { drive: 2 });
  t.rung("Seren", 2);
  t.rung("Thorne", 2);
  const pact = formPact(t, ["Thorne", "Seren"]);
  assert.equal(pact.tactic, "false_trail");
  assert.equal(pact.trigger, "road");
  const before = getClock(t.world.campaignId).instant;
  t.world.dice([20, 1]);
  const travel = await t.world.invoke("travel", { hours: 3 });
  t.world.clearDice();
  assert.equal(travel.ok, true, travel.error);
  const after = getClock(t.world.campaignId).instant;
  assert.ok(after - before >= 24 * 60 + 3 * 60, `a day lost besides the road (${after - before} minutes)`);
  assert.match(travel.result.companions.join(" "), /Thorne led the party off the road: it has lost a day/);
  assert.equal(t.companion("Thorne"), undefined);
});

await test("a party that wins the Survival contest keeps to the road and loses nothing", async () => {
  const t = await table({ thorne: { class: "ranger" } });
  t.axes("Thorne", { drive: 2 });
  t.rung("Seren", 2);
  t.rung("Thorne", 2);
  formPact(t, ["Thorne", "Seren"]);
  const before = getClock(t.world.campaignId).instant;
  t.world.dice([1, 20]);
  const travel = await t.world.invoke("travel", { hours: 3 });
  t.world.clearDice();
  assert.equal(getClock(t.world.campaignId).instant - before, 3 * 60, "only the road's own hours");
  assert.match(travel.result.companions.join(" "), /saw Thorne turning the party from the road in time/);
});

await test("denouncing moves reputation: the leader reports the party to the power it answers to", async () => {
  const t = await table({ thorne: { class: "cleric" } });
  const faction = factions.insertFaction(t.world.campaignId, { name: "The Temple", power: 3 });
  t.axes("Thorne", { drive: 2 });
  t.rung("Seren", 2);
  t.rung("Thorne", 2);
  const pact = formPact(t, ["Thorne", "Seren"]);
  assert.equal(pact.tactic, "denounce");
  await longRest(t.world, []);
  assert.equal(getParty(t.world.campaignId).reputation[faction.id], -2, "the party's standing fell");
  assert.match(messages.listRecentMessages(t.world.campaignId, 12).map((message) => message.content).join("\n"), /Thorne left to report the party to The Temple/);
});

await test("Talk tables never recruit; a companion talked back to content leaves its pact", async () => {
  const talk = await table({ gameSettings: { companionConscience: "talk" } });
  talk.rung("Seren", 1);
  await longRest(talk.world, [20, 20, 20]);
  assert.deepEqual(talk.pacts(), []);
  const t = await table();
  t.rung("Seren", 1);
  t.rung("Thorne", 1);
  const pact = formPact(t, ["Seren", "Thorne"]);
  t.rung("Thorne", 0);
  await longRest(t.world, [1, 20]);
  assert.deepEqual(pactsDb.getPact(pact.id).members.map((member) => member.name), ["Seren"], "Thorne left it");
});

finish();
