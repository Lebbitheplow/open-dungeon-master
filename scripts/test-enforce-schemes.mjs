// Scheming NPCs (issue 501) and the storyteller's secrets (#503 Phase 0.2),
// through the engine and the routes a player's client calls, with the dice
// under the test's control.
//
// An act is started only toward a character open to advances, by an NPC
// drawn to them; every player, the lead of an AI table included, reads the
// warmth it shows through the relationships route, and nobody but the
// storyteller reads its motive or the true meter there, in ?secrets=1, in
// the Context tab or in an out-of-character answer's prompt, while the AI's
// game state and tool results keep the truth and say it is an act. An
// Insight that beats the NPC's Deception is whispered to that player alone,
// whose Bonds row then reads the truth; a betrayal by the NPC ends it
// without costing the NPC's regard and shows everyone the truth. At a table
// a person runs, that person is the storyteller and reads it all.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";

const { test, finish } = suite("test-enforce-schemes");
const relationships = await import("../src/lib/db/relationships.ts");
const factsDb = await import("../src/lib/db/facts.ts");
const whispers = await import("../src/lib/db/dm-whispers.ts");
const turns = await import("../src/lib/db/dm-turns.ts");
const campaigns = await import("../src/lib/db/campaigns.ts");
const sheetsDb = await import("../src/lib/db/sheets.ts");
const { buildDmMessages, buildGameStateBlock } = await import("../src/lib/dm/prompt.ts");
const { storytellerLinesForPrompt } = await import("../src/lib/dm/scheme-tools.ts");
const { relationshipRosterForPrompt } = await import("../src/lib/dm/relationship-tools.ts");
const { friendshipTier, TIER_LABEL } = await import("../src/lib/dm/relationship-logic.ts");

const MOTIVE = "the key to the river vault";

const world = await openWorld();
// The owner leads this AI table and plays Bram; Kael and Nysa are players.
const bram = world.addHero({ name: "Bram", gender: "Male" });
const kaelUser = world.addUser("kael");
const kael = world.addHero({ user: kaelUser, name: "Kael", gender: "Male", abilities: { wis: 14 } });
const nysaUser = world.addUser("nysa");
const nysa = world.addHero({ user: nysaUser, name: "Nysa", gender: "Female", abilities: { wis: 8 } });
sheetsDb.setOpenToAdvances(kael.id, true);

async function get(table, user, route, query = "") {
  table.signIn(user);
  const handler = await table.route(route);
  const response = await handler.GET(new Request(`http://test/${query}`), { params: Promise.resolve({ campaignId: table.campaignId }) });
  const body = await response.json();
  return { status: response.status, body, text: JSON.stringify(body) };
}
const bonds = async (table, user) => (await get(table, user, "campaigns/[campaignId]/relationships")).body.relationships;
const bondOf = (rows, characterId, subject) => rows.find((row) => row.characterId === characterId && row.subjectName === subject);
const pair = (sheet, subject, table = world) => relationships.getRelationship(table.campaignId, sheet.id, subject);
function liking(sheet, subject, approval, table = world) {
  const row = relationships.ensureRelationship({
    campaignId: table.campaignId,
    characterId: sheet.id,
    characterName: sheet.name,
    subjectKind: "npc",
    subjectName: subject,
  });
  return relationships.patchRelationship(row.id, { approval });
}
// The prompt one turn of this table would send, as turn.ts builds it.
function promptState(table, { ooc = false } = {}) {
  const campaign = table.campaign();
  const sheets = table.sheets();
  return {
    campaign,
    members: campaigns.listMembers(table.campaignId),
    sheets,
    recentRolls: [],
    storySummary: "",
    contextLimitTokens: 32_000,
    relationships: relationshipRosterForPrompt(table.campaignId, { storyteller: !ooc }),
    storytellerLines: ooc ? [] : storytellerLinesForPrompt(campaign, sheets, []),
    withholdStorytellerSecrets: ooc,
  };
}
// A turn whose trace the Context tab serves.
function takeTurn(table) {
  const state = promptState(table);
  const conversation = buildDmMessages(state, []);
  const turn = turns.createDmTurn(table.campaignId, conversation);
  turn.contextTrace = state.contextTrace;
  turns.saveDmTurn(turn);
  return { state, conversation };
}
const whispersTo = (user, table = world) => whispers.listWhispersForUser(table.campaignId, user.id).map((row) => row.content);

await world.invoke("set_npc", { name: "Mira", gender: "Female", drawnTo: ["men"], location: "Highmoor" });
await world.invoke("set_npc", { name: "Corin", gender: "Male", drawnTo: ["men"], location: "Highmoor" });

await test("an act is refused toward a character not open to advances, or one the NPC is not drawn to", async () => {
  const closed = await world.invoke("relationship_scheme", { action: "start", characterId: bram.id, subject: "Mira", motive: MOTIVE });
  assert.equal(closed.ok, false);
  assert.match(closed.error, /has not opened Bram to advances/);
  const nysaOpen = sheetsDb.setOpenToAdvances(nysa.id, true);
  assert.ok(nysaOpen !== false);
  const mismatch = await world.invoke("relationship_scheme", { action: "start", characterId: nysa.id, subject: "Mira", motive: MOTIVE });
  assert.equal(mismatch.ok, false, "Mira is drawn to men; Nysa is a woman");
  assert.match(mismatch.error, /not drawn to each other/);
  sheetsDb.setOpenToAdvances(nysa.id, false);
  const noMotive = await world.invoke("relationship_scheme", { action: "start", characterId: kael.id, subject: "Mira" });
  assert.equal(noMotive.ok, false);
  assert.match(noMotive.error, /needs a motive/);
});

await test("a start alone changes nothing anyone at the table sees, and the AI is told the truth and that it is an act", async () => {
  liking(kael, "Mira", -12);
  const before = {};
  for (const [who, user] of [["lead", world.owner], ["kael", kaelUser], ["nysa", nysaUser]]) {
    before[who] = await bonds(world, user);
  }
  const started = await world.invoke("relationship_scheme", { action: "start", characterId: kael.id, subject: "Mira", motive: MOTIVE });
  assert.equal(started.ok, true, started.error);
  assert.equal(started.result.approval, -12, "the truth");
  assert.equal(started.result.shown, -12, "the act starts where she truly stands");
  assert.match(started.result.note, /nobody at the table sees anything change/);
  assert.match(started.result.note, /relationship_beat/, "the DM is told to build it with warm beats");
  const act = pair(kael, "Mira").pretense;
  assert.equal(act.motive, MOTIVE);
  assert.equal(act.shown, -12);
  for (const [who, user] of [["lead", world.owner], ["kael", kaelUser], ["nysa", nysaUser]]) {
    assert.deepEqual(await bonds(world, user), before[who], `${who}: the Bonds tab reads exactly as before`);
  }
  const twice = await world.invoke("relationship_scheme", { action: "start", characterId: kael.id, subject: "Mira", motive: "a second one" });
  assert.equal(twice.ok, false, "one act at a time");
});

await test("a warm beat lands on the act at its face value, an act always lands, and the truth moves by her nature", async () => {
  const helped = await world.invoke("relationship_beat", { characterId: kael.id, subject: "Mira", beat: "helped" });
  assert.equal(helped.ok, true, helped.error);
  let now = pair(kael, "Mira");
  assert.equal(now.pretense.shown, -12 + 6, "helped is worth its face value of 6 to the act");
  assert.equal(now.approval, -12 + helped.result.approvalChange, "the truth moves as her nature takes it");
  assert.equal(helped.result.approval, now.approval, "the tool result reports the truth");
  assert.match(helped.result.act, /Mira's warmth toward Kael is an act: the table sees /);
  // A flirt that falls flat costs an honest NPC a point; an act lands.
  world.clearDice();
  world.dice(1);
  const flirt = await world.invoke("relationship_beat", { characterId: kael.id, subject: "Mira", beat: "flirt" });
  world.clearDice();
  assert.equal(flirt.ok, true, flirt.error);
  assert.equal(flirt.result.outcome, "miss");
  const afterFlirt = pair(kael, "Mira");
  assert.equal(afterFlirt.approval, now.approval - 1, "the miss costs the truth its point");
  assert.equal(afterFlirt.pretense.shown, now.pretense.shown + 4, "the act lands at the flirt's face value");
  // The same move again is worth less to the act, as to anyone.
  const again = await world.invoke("relationship_beat", { characterId: kael.id, subject: "Mira", beat: "helped" });
  assert.equal(again.ok, true, again.error);
  assert.equal(pair(kael, "Mira").pretense.shown, afterFlirt.pretense.shown + 4, "a second helped is worth 6 x 0.6");
  now = pair(kael, "Mira");
  const row = bondOf(await bonds(world, nysaUser), kael.id, "Mira");
  assert.equal(row.tier, friendshipTier(now.pretense.shown), "the table reads the warmth the act shows");
});

await test("a cold beat moves the act and the truth alike", async () => {
  const before = pair(kael, "Mira");
  const insult = await world.invoke("relationship_beat", { characterId: kael.id, subject: "Mira", beat: "insult" });
  assert.equal(insult.ok, true, insult.error);
  const after = pair(kael, "Mira");
  assert.ok(insult.result.approvalChange < 0);
  assert.equal(after.approval - before.approval, insult.result.approvalChange);
  assert.equal(after.pretense.shown - before.pretense.shown, insult.result.approvalChange, "the act takes the slight as she does");
});

// The act played up over scenes to a warmth she does not feel.
relationships.patchRelationship(pair(kael, "Mira").id, { pretense: { ...pair(kael, "Mira").pretense, shown: 58 } });

await test("every player reads the warmth the act shows, the lead of the AI table included, and none reads the motive", async () => {
  for (const [who, user] of [["the lead", world.owner], ["Kael's player", kaelUser], ["Nysa's player", nysaUser]]) {
    const rows = await bonds(world, user);
    const row = bondOf(rows, kael.id, "Mira");
    assert.equal(row.tier, "friendly", who);
    assert.equal(row.act, undefined, `${who}: no act`);
    assert.equal(row.seenThrough, undefined, who);
    assert.doesNotMatch(JSON.stringify(rows), /river vault/, `${who}: no motive anywhere`);
  }
  const lead = bondOf(await bonds(world, world.owner), kael.id, "Mira");
  assert.equal(lead.approval, 58, "the lead's number is the act's");
});

await test("the AI's game state keeps the truth, and the act, its motive and how to build it ride the storyteller's section", async () => {
  const truth = pair(kael, "Mira").approval;
  const state = promptState(world);
  const block = buildGameStateBlock(state);
  assert.ok(block.includes(`Kael and Mira (npc) | ${TIER_LABEL[friendshipTier(truth)]} (${truth > 0 ? "+" : ""}${truth})`), "the true standing");
  assert.match(block, /Storyteller secrets/);
  assert.match(block, /Mira's warmth toward Kael is an ACT: the table sees friendly \(\+58\)/);
  assert.match(block, new RegExp(MOTIVE));
  assert.match(block, /An act starts where they truly stand/);
  assert.match(block, /every warm beat lands on the warmth the table sees at its face value/);
  assert.match(block, /Open to advances from NPCs \(each player's private choice; never mention it at the table\): Kael\./);
  assert.doesNotMatch(block, /Gender: Male \| Open to advances/, "the opt-in left the party lines for the section");
});

await test("the lead cannot read the motive or the true meter through ?secrets=1 or the Context tab", async () => {
  factsDb.insertFact({ campaignId: world.campaignId, category: "npc", subject: "Mira", fact: `Mira works for the river guild and wants ${MOTIVE}.`, knownBy: "storyteller", pinned: true, source: "manual" });
  factsDb.insertFact({ campaignId: world.campaignId, category: "npc", subject: "Ilse", fact: "Ilse fled north before dawn.", knownBy: "dm", pinned: true, source: "manual" });
  const secrets = await get(world, world.owner, "campaigns/[campaignId]/facts", "?secrets=1");
  assert.equal(secrets.status, 200);
  assert.ok(secrets.body.facts.some((fact) => fact.knownBy === "dm"), "the lead still reads DM secrets");
  assert.ok(!secrets.body.facts.some((fact) => fact.knownBy === "storyteller"), "never the storyteller's");
  assert.doesNotMatch(secrets.text, /river vault/);
  const { state } = takeTurn(world);
  assert.ok(state.contextTrace.blocks.some((block) => block.id === "storyteller" && block.secret === "storyteller"), "the turn costs the section on its own row");
  const trace = await get(world, world.owner, "campaigns/[campaignId]/context-trace");
  assert.equal(trace.status, 200);
  assert.ok(!trace.body.trace.blocks.some((block) => block.id === "storyteller"), "no storyteller row for the lead");
  const hidden = state.contextTrace.blocks.find((block) => block.id === "storyteller").tokens;
  assert.equal(trace.body.trace.promptTokens, state.contextTrace.promptTokens - hidden, "nor its tokens");
  assert.doesNotMatch(trace.text, /river vault|Open to advances/);
  const player = await get(world, nysaUser, "campaigns/[campaignId]/context-trace");
  assert.equal(player.status, 403, "a player has no Context tab at all");
});

await test("an out-of-character answer's prompt carries no storyteller secret and reads the act", async () => {
  const state = promptState(world, { ooc: true });
  state.facts = factsDb.listActiveFacts(world.campaignId).filter((fact) => fact.knownBy !== "storyteller");
  const text = buildDmMessages(state, []).map((message) => message.content).join("\n");
  assert.doesNotMatch(text, /river vault/);
  assert.doesNotMatch(text, /Storyteller secrets|is an ACT/);
  assert.doesNotMatch(text, /open to advances from NPCs/i, "who opted in stays the storyteller's");
  const shown = pair(kael, "Mira").pretense.shown;
  assert.match(text, new RegExp(`Kael and Mira \\(npc\\) \\| [^|]*\\(\\+${shown}\\)`), "the standing the table sees");
  assert.ok(!state.contextTrace.blocks.some((block) => block.id === "storyteller"));
});

await test("an Insight that beats Mira's Deception is whispered to that player alone, whose row then reads the truth", async () => {
  // Mira rolls 8 plus her nature: Kael's passive Insight (12) beats it,
  // Nysa's (9) does not.
  world.clearDice();
  world.dice(8);
  const insight = await world.invoke("check_notice", { sense: "insight", againstMonster: "Mira", characterIds: [kael.id, nysa.id] });
  world.clearDice();
  assert.equal(insight.ok, true, insight.error);
  assert.deepEqual(insight.result.noticedBy, ["Kael"], JSON.stringify(insight.result));
  assert.match(insight.result.seenThrough.join(" "), /Kael saw through Mira's act toward Kael; only Kael's player was told/);
  assert.equal(whispersTo(kaelUser).filter((line) => /sees through Mira/.test(line)).length, 1);
  assert.equal(whispersTo(world.owner).filter((line) => /sees through/.test(line)).length, 0, "not the lead");
  assert.equal(whispersTo(nysaUser).filter((line) => /sees through/.test(line)).length, 0, "not Nysa");
  const truth = friendshipTier(pair(kael, "Mira").approval);
  const act = friendshipTier(pair(kael, "Mira").pretense.shown);
  assert.notEqual(truth, act);
  const kaelRow = bondOf(await bonds(world, kaelUser), kael.id, "Mira");
  assert.equal(kaelRow.seenThrough, true);
  assert.equal(kaelRow.tier, truth, "Kael's player reads the truth");
  const leadRow = bondOf(await bonds(world, world.owner), kael.id, "Mira");
  assert.equal(leadRow.seenThrough, undefined);
  assert.equal(leadRow.tier, act, "the lead still reads the act");
  assert.equal(leadRow.approval, pair(kael, "Mira").pretense.shown);
  // A second look tells nobody twice.
  world.dice(1);
  const again = await world.invoke("check_notice", { sense: "insight", againstMonster: "Mira", characterIds: [kael.id] });
  world.clearDice();
  assert.equal(again.result.seenThrough, undefined);
  assert.equal(whispersTo(kaelUser).filter((line) => /sees through Mira/.test(line)).length, 1);
  world.dice(1);
  const perception = await world.invoke("check_notice", { sense: "perception", againstMonster: "Mira", characterIds: [nysa.id] });
  world.clearDice();
  assert.equal(perception.result?.seenThrough, undefined, "only an Insight sees through an act");
  assert.equal(whispersTo(nysaUser).filter((line) => /sees through/.test(line)).length, 0);
});

await test("a schemer's first move is the same move an honest suitor makes", async () => {
  const advances = await import("../src/lib/db/advances.ts");
  const { tickAdvances } = await import("../src/lib/dm/advance-tick.ts");
  while (advances.getAiTurns(world.campaignId) < 8) advances.bumpAiTurns(world.campaignId);
  world.dice(1);
  tickAdvances(world.campaign(), 8, "Mira waits by the ford.");
  world.clearDice();
  assert.ok(pair(kael, "Mira").advanceReadyUntil > 0, "the act's warmth qualifies her, though she feels nothing of it");
  relationships.patchRelationship(pair(kael, "Mira").id, { advanceReadyUntil: 0 });
});

await test("a betrayal by the NPC ends it, costs her nothing, and shows everyone the truth", async () => {
  const before = pair(kael, "Mira");
  const ended = await world.invoke("relationship_end", { characterId: kael.id, subject: "Mira", reason: "betrayal", by: "npc" });
  assert.equal(ended.ok, true, ended.error);
  const after = pair(kael, "Mira");
  assert.equal(after.approval, before.approval, "the NPC who betrays keeps her true regard");
  assert.equal(after.status, "ended");
  assert.equal(after.pretense.revealed, true);
  assert.ok(after.memories.some((memory) => /was an act all along/.test(memory.text)));
  assert.ok(after.memories.some((memory) => memory.text === "Mira betrayed Kael"));
  for (const user of [world.owner, kaelUser, nysaUser]) {
    const row = bondOf(await bonds(world, user), kael.id, "Mira");
    assert.equal(row.unmasked, true);
    assert.equal(row.tier, friendshipTier(after.approval), "the truth, for everyone");
    assert.doesNotMatch(JSON.stringify(row), /river vault/, "the motive is the storyteller's still");
  }
  const misuse = await world.invoke("relationship_end", { characterId: kael.id, subject: "Corin", reason: "parting", by: "npc" });
  assert.equal(misuse.ok, false, "by npc is a betrayal's");
});

await test("a betrayal by the character still costs the NPC's regard of them", async () => {
  liking(bram, "Corin", 40);
  const ended = await world.invoke("relationship_end", { characterId: bram.id, subject: "Corin", reason: "betrayal" });
  assert.equal(ended.ok, true, ended.error);
  assert.equal(pair(bram, "Corin").approval, 10);
});

await test("relationship_scheme reveal shows everyone the truth without ending the bond", async () => {
  sheetsDb.setOpenToAdvances(bram.id, true);
  liking(bram, "Corin", -30);
  relationships.patchRelationship(pair(bram, "Corin").id, { status: "active" });
  const started = await world.invoke("relationship_scheme", { action: "start", characterId: bram.id, subject: "Corin", motive: "Bram's signet" });
  assert.equal(started.ok, true, started.error);
  assert.equal(bondOf(await bonds(world, world.owner), bram.id, "Corin").tier, "disliked", "a start shows nothing new");
  relationships.patchRelationship(pair(bram, "Corin").id, { pretense: { ...pair(bram, "Corin").pretense, shown: 40 } });
  assert.equal(bondOf(await bonds(world, world.owner), bram.id, "Corin").tier, "friendly", "the act played up, to the lead who plays Bram");
  const revealed = await world.invoke("relationship_scheme", { action: "reveal", characterId: bram.id, subject: "Corin", note: "Corin's letters to the guild turned up" });
  assert.equal(revealed.ok, true, revealed.error);
  const row = bondOf(await bonds(world, nysaUser), bram.id, "Corin");
  assert.equal(row.unmasked, true);
  assert.equal(row.tier, "disliked");
  assert.equal(pair(bram, "Corin").status, "active");
  assert.equal((await world.invoke("relationship_scheme", { action: "reveal", characterId: bram.id, subject: "Corin" })).ok, false, "only once");
});

// ---- a table a person runs ----

await test("at a table a person runs, that person reads the act, its motive and the storyteller's facts", async () => {
  const table = await openWorld({ gameSettings: { dmMode: "human" } });
  const player = table.addUser("p");
  const hero = table.addHero({ user: player, name: "Lio", gender: "Male", abilities: { wis: 14 } });
  sheetsDb.setOpenToAdvances(hero.id, true);
  await table.invoke("set_npc", { name: "Senna", gender: "Female", drawnTo: ["men"] });
  liking(hero, "Senna", 5, table);
  const started = await table.invoke("relationship_scheme", { action: "start", characterId: hero.id, subject: "Senna", motive: "Lio's map" });
  assert.equal(started.ok, true, started.error);
  relationships.patchRelationship(pair(hero, "Senna", table).id, { pretense: { ...pair(hero, "Senna", table).pretense, shown: 45 } });
  const dmRow = bondOf(await bonds(table, table.owner), hero.id, "Senna");
  assert.equal(dmRow.approval, 5, "the true meter");
  assert.equal(dmRow.act.motive, "Lio's map");
  assert.equal(dmRow.act.shown, 45);
  const playerRow = bondOf(await bonds(table, player), hero.id, "Senna");
  assert.equal(playerRow.act, undefined);
  assert.equal(playerRow.tier, "friendly");
  factsDb.insertFact({ campaignId: table.campaignId, category: "npc", subject: "Senna", fact: "Senna sells maps to smugglers.", knownBy: "storyteller", pinned: true, source: "manual" });
  const secrets = await get(table, table.owner, "campaigns/[campaignId]/facts", "?secrets=1");
  assert.ok(secrets.body.facts.some((fact) => fact.knownBy === "storyteller"), "the storyteller reads their own facts");
  const { state } = takeTurn(table);
  const trace = await get(table, table.owner, "campaigns/[campaignId]/context-trace");
  assert.ok(trace.body.trace.blocks.some((block) => block.id === "storyteller"), "and the storyteller's row");
  assert.equal(trace.body.trace.promptTokens, state.contextTrace.promptTokens);
  // An Insight from the console: whispered to Lio's player, and the DM is told.
  table.dice(1);
  const seen = await table.invoke("check_notice", { sense: "insight", againstMonster: "Senna", characterIds: [hero.id] });
  table.clearDice();
  assert.equal(seen.ok, true, seen.error);
  assert.equal(whispersTo(player, table).filter((line) => /sees through Senna/.test(line)).length, 1);
  assert.deepEqual(bondOf(await bonds(table, table.owner), hero.id, "Senna").act.seenThroughBy, ["Lio"]);
});

finish();
