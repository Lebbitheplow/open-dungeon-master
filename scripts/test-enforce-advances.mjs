// NPCs who make the first move (issue 501), through the engine and the
// routes a player's client calls, with the dice under the test's control.
//
// The server decides when (a forced d100 after the 8th AI turn) and who (an
// NPC in the scene who likes the character enough, drawn both ways); the
// DM's move is romance_advance with initiator npc and only inside the
// window; the answer is the character's own player's, never the lead's; a
// yes is courting with no consent die, a no stings and cools down, no answer
// lapses, and switching the opt-in off withdraws it at once. Companions get
// a person behind their sheet (#503 Phase 0.1), court but are never courted,
// guests never court, and a romanced NPC is never rostered out.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";

const { test, finish } = suite("test-enforce-advances");
const relationships = await import("../src/lib/db/relationships.ts");
const proposals = await import("../src/lib/db/item-proposals.ts");
const advances = await import("../src/lib/db/advances.ts");
const npcs = await import("../src/lib/db/npcs.ts");
const messages = await import("../src/lib/db/messages.ts");
const campaigns = await import("../src/lib/db/campaigns.ts");
const { tickAdvances, advanceDirectorNotes } = await import("../src/lib/dm/advance-tick.ts");
const { advanceNpcAgency } = await import("../src/lib/dm/npc-agency.ts");
const { OFFER_NOTE_PREFIX } = await import("../src/lib/dm/proposal-logic.ts");
const { buildGameStateBlock, describeSheet, relationshipRules } = await import("../src/lib/dm/prompt.ts");
const { npcRosterForPrompt } = await import("../src/lib/dm/social-tools.ts");

const world = await openWorld();
// The owner leads the table and plays Bram; Kael and Nysa are players.
const bram = world.addHero({ name: "Bram", gender: "Male" });
const kaelUser = world.addUser("kael");
const kael = world.addHero({ user: kaelUser, name: "Kael", gender: "Male", abilities: { cha: 16 } });
const nysaUser = world.addUser("nysa");
const nysa = world.addHero({
  user: nysaUser,
  name: "Nysa",
  gender: "Female",
  attraction: { genders: ["Female"], note: "" },
  abilities: { cha: 12 },
});

const romanceRoute = await world.route("campaigns/[campaignId]/sheet/romance");
const answers = await world.route("campaigns/[campaignId]/item-proposals/[proposalId]");
async function setOpen(user, characterId, open) {
  world.signIn(user);
  const response = await romanceRoute.PUT(
    new Request("http://test/", { method: "PUT", body: JSON.stringify({ characterId, open }) }),
    { params: Promise.resolve({ campaignId: world.campaignId }) },
  );
  return { status: response.status, body: await response.json() };
}
async function answer(user, proposalId, action) {
  world.signIn(user);
  const response = await answers.POST(
    new Request("http://test/", { method: "POST", body: JSON.stringify({ action }) }),
    { params: Promise.resolve({ campaignId: world.campaignId, proposalId }) },
  );
  return { status: response.status, body: await response.json() };
}
const pair = (sheet, subject) => relationships.getRelationship(world.campaignId, sheet.id, subject);
function liking(sheet, subject, approval, subjectKind = "npc") {
  const row = relationships.ensureRelationship({
    campaignId: world.campaignId,
    characterId: sheet.id,
    characterName: sheet.name,
    subjectKind,
    subjectName: subject,
  });
  return relationships.patchRelationship(row.id, { approval });
}
// The table's AI-turn clock, moved as finished turns move it.
function turnTo(count) {
  while (advances.getAiTurns(world.campaignId) < count) {
    advances.bumpAiTurns(world.campaignId);
  }
  return count;
}
function tick(count, narration = "") {
  turnTo(count);
  tickAdvances(world.campaign(), count, narration);
}
const pendingAdvances = () => proposals.listOpenItemProposals(world.campaignId).filter((row) => row.toolName === "romance_advance");
const lastLine = () => messages.listRecentMessages(world.campaignId, 1)[0];
const npcMove = (sheet, subject, note = "") =>
  world.invoke("romance_advance", { characterId: sheet.id, subject, to: "courting", initiator: "npc", ...(note ? { note } : {}) });

await world.invoke("set_npc", { name: "Mira", gender: "Female", drawnTo: ["men"], location: "Highmoor" });
await world.invoke("set_npc", { name: "Ilse", gender: "Female", location: "Low Fen" });

await test("an NPC's attraction is written once by the DM and kept", async () => {
  assert.deepEqual(npcs.getNpcByName(world.campaignId, "Mira").attraction, { genders: ["Male"], note: "" });
  await world.invoke("set_npc", { name: "Mira", drawnTo: ["women"] });
  assert.deepEqual(npcs.getNpcByName(world.campaignId, "Mira").attraction, { genders: ["Male"], note: "" }, "a second answer never rewrites who she is");
});

await test("the opt-in is the owner's alone, off by default, and needs a romance table", async () => {
  assert.equal(world.sheet(kael.id).openToAdvances, false, "off by default");
  const byLead = await setOpen(world.owner, kael.id, true);
  assert.equal(byLead.status, 404, "the lead cannot open another player's character");
  const own = await setOpen(kaelUser, kael.id, true);
  assert.equal(own.status, 200, own.body.error);
  assert.equal(world.sheet(kael.id).openToAdvances, true);
  assert.equal((await setOpen(nysaUser, nysa.id, true)).status, 200);
});

await test("the DM is told who is open, their gender and who they are drawn to", async () => {
  const kaelLine = describeSheet(world.sheet(kael.id), "kael", false, { romance: true, advances: true });
  assert.match(kaelLine, /Gender: Male \| Open to advances from NPCs/);
  const nysaLine = describeSheet(world.sheet(nysa.id), "nysa", false, { romance: true, advances: true });
  assert.match(nysaLine, /Gender: Female \| Drawn to: women \| Open to advances from NPCs/);
  assert.doesNotMatch(describeSheet(world.sheet(nysa.id), "nysa", false, {}), /Drawn to|Open to advances/, "nothing without romance");
  const mira = npcRosterForPrompt(world.campaignId, { romance: true }).find((npc) => npc.name === "Mira");
  assert.equal(mira.identity, "Female, drawn to men");
  assert.match(relationshipRules(true, ["Kael", "Nysa"]), /Kael, Nysa are open to advances from NPCs/);
  assert.doesNotMatch(relationshipRules(true, []), /open to advances/, "unchanged while nobody is open");
  const state = {
    campaign: world.campaign(),
    members: campaigns.listMembers(world.campaignId),
    sheets: world.sheets(),
    recentRolls: [],
    storySummary: "",
    contextLimitTokens: 32_000,
    relationships: ["Kael and Mira (npc) | friendly (+30)"],
  };
  assert.match(buildGameStateBlock(state), /romance_advance, and relationship_end/, "the standing header names every way standing moves");
});

await test("the DM's move outside a window is refused", async () => {
  liking(kael, "Mira", 60);
  const early = await npcMove(kael, "Mira");
  assert.equal(early.ok, false);
  assert.match(early.error, /only the server opens that moment/);
  assert.equal(pendingAdvances().length, 0);
});

await test("a failed roll opens nothing; a forced success on the 8th turn opens a window for three turns", async () => {
  world.clearDice();
  world.dice(100);
  tick(8, "Mira waves Kael over.");
  assert.equal(pair(kael, "Mira").advanceReadyUntil, 0, "a 100 never succeeds");
  // Kael's Charisma +3: 25 or lower. Nysa has no suitor yet, so no die.
  world.dice(25);
  tick(8, "Mira waves Kael over.");
  assert.equal(world.clearDice(), 0, "one die, for the one character with a suitor");
  assert.equal(pair(kael, "Mira").advanceReadyUntil, 11);
  const notes = advanceDirectorNotes(world.campaign());
  assert.equal(notes.length, 1);
  assert.match(notes[0], /Mira is ready to make a romantic move toward Kael/);
});

let offerId = "";
await test("the move inside the window is an offer only Kael's player can answer", async () => {
  const made = await npcMove(kael, "Mira", "Walk with me by the river tonight?");
  assert.equal(made.ok, true, made.error);
  assert.match(made.result.note, /never narrate or decide Kael's answer/);
  const [row] = pendingAdvances();
  assert.ok(row, "a pending advance");
  offerId = row.id;
  assert.equal(row.summary, "Mira asks to court Kael");
  assert.equal(row.reason, "Walk with me by the river tonight?");
  assert.equal(pair(kael, "Mira").advanceReadyUntil, 0, "the moment is spent");
  const byLead = await answer(world.owner, offerId, "approve");
  assert.equal(byLead.status, 403, "the lead cannot answer for Kael");
  const byOther = await answer(nysaUser, offerId, "decline");
  assert.equal(byOther.status, 403, "nor can another player");
  assert.equal(pendingAdvances().length, 1);
});

await test("accepting is courting with no consent die, and the DM is told the answer", async () => {
  world.diceLog();
  const done = await answer(kaelUser, offerId, "approve");
  assert.equal(done.status, 200, done.body.error);
  assert.equal(world.diceLog().length, 0, "the NPC asked, so no die decides it");
  const now = pair(kael, "Mira");
  assert.equal(now.romance, "courting");
  assert.ok(now.approval >= 55, "settled at the rung's floor");
  assert.equal(proposals.getItemProposal(offerId).status, "approved");
  const line = lastLine();
  assert.ok(line.content.startsWith(OFFER_NOTE_PREFIX), line.content);
  assert.match(line.content, /Kael said yes to Mira: they are now openly courting/);
});

await test("a courted NPC is never drawn to another character, and an NPC is never ready for two", async () => {
  // Mira is courting Kael now, so she is past the first move with him; and
  // Ilse is the only one who could court Nysa.
  liking(nysa, "Ilse", 58);
  liking(bram, "Ilse", 70);
  world.dice(1);
  tick(16, "Ilse looks up from the fire.");
  assert.equal(pair(nysa, "Ilse").advanceReadyUntil, 19, "Nysa's suitor is ready");
  assert.equal(pair(kael, "Mira").advanceReadyUntil, 0, "nothing more from Mira");
});

await test("declining stings a little, is remembered, and cools the pair down", async () => {
  const made = await npcMove(nysa, "Ilse", "Would you dance with me?");
  assert.equal(made.ok, true, made.error);
  const [row] = pendingAdvances();
  const before = pair(nysa, "Ilse").approval;
  const done = await answer(nysaUser, row.id, "decline");
  assert.equal(done.status, 200, done.body.error);
  const after = pair(nysa, "Ilse");
  assert.equal(after.approval, before - 3);
  assert.equal(after.romance, "none");
  assert.equal(after.advanceCooldownUntil, 16 + 24);
  assert.ok(after.memories.some((memory) => memory.text === "Nysa turned Ilse down" || memory.text === "Nysa turned down Ilse"));
  assert.match(lastLine().content, /Nysa turned Ilse down/);
  world.dice(1);
  tick(24, "Ilse again.");
  assert.equal(pair(nysa, "Ilse").advanceReadyUntil, 0, "still cooling down");
  world.clearDice();
});

await test("switching the opt-in off closes the moment and withdraws a waiting advance at once", async () => {
  await world.invoke("set_npc", { name: "Corin", gender: "Male", location: "Highmoor" });
  const bard = world.addHero({ user: world.addUser("tam"), name: "Tam", gender: "Female", abilities: { cha: 20 } });
  const tamUser = { id: bard.userId };
  assert.equal((await setOpen(tamUser, bard.id, true)).status, 200);
  liking(bard, "Corin", 65);
  world.dice(1);
  tick(32, "Corin bows to Tam.");
  assert.ok(pair(bard, "Corin").advanceReadyUntil > 0);
  assert.equal((await npcMove(bard, "Corin", "May I write to you?")).ok, true);
  const [row] = pendingAdvances();
  const off = await setOpen(tamUser, bard.id, false);
  assert.equal(off.status, 200, off.body.error);
  assert.equal(off.body.withdrawn, 1);
  assert.equal(proposals.getItemProposal(row.id).status, "cancelled");
  assert.equal(pair(bard, "Corin").romance, "none", "nothing changed between them");
  assert.equal(world.sheet(bard.id).openToAdvances, false);
});

await test("an advance nobody answers lapses into no answer, with no sting", async () => {
  liking(kael, "Ilse", 60);
  // Kael is courting Mira, so Ilse may still court him: nobody else is.
  world.dice(1);
  tick(40, "Ilse finds Kael at the well.");
  assert.ok(pair(kael, "Ilse").advanceReadyUntil > 0, "Ilse is ready");
  assert.equal((await npcMove(kael, "Ilse")).ok, true);
  const [row] = pendingAdvances();
  const before = pair(kael, "Ilse").approval;
  tick(46);
  assert.equal(proposals.getItemProposal(row.id).status, "expired");
  assert.equal(pair(kael, "Ilse").approval, before, "no sting");
  assert.equal(pair(kael, "Ilse").advanceCooldownUntil, 46 + 24);
  assert.match(lastLine().content, /Kael gave Ilse no answer/);
});

await test("an NPC partnered with someone else is not ready for anyone", async () => {
  relationships.patchRelationship(pair(bram, "Ilse").id, { romance: "together" });
  liking(nysa, "Ilse", 70);
  relationships.patchRelationship(pair(nysa, "Ilse").id, { advanceCooldownUntil: 0 });
  world.dice(1);
  tick(48, "Ilse is here.");
  assert.equal(pair(nysa, "Ilse").advanceReadyUntil, 0);
  world.clearDice();
});

await test("a romanced NPC is never rostered out, though one nobody knows is", async () => {
  const mira = npcs.getNpcByName(world.campaignId, "Mira");
  npcs.patchNpcAgency(mira.id, { pressure: { ignored: 8, engaged: 0 } });
  await world.invoke("set_npc", { name: "Old Petch", gender: "Male" });
  const petch = npcs.getNpcByName(world.campaignId, "Old Petch");
  npcs.patchNpcAgency(petch.id, { pressure: { ignored: 8, engaged: 0 } });
  advanceNpcAgency(world.campaignId, "Nothing of note happened.");
  assert.equal(npcs.getNpcById(mira.id).archived, false, "her romance with Kael keeps her on the roster");
  assert.equal(npcs.getNpcById(petch.id).archived, true);
});

await test("romance switched off withdraws what waits, and a yes after it takes no step", async () => {
  liking(kael, "Corin", 60);
  relationships.patchRelationship(pair(kael, "Corin").id, { advanceReadyUntil: advances.getAiTurns(world.campaignId) + 3 });
  assert.equal((await npcMove(kael, "Corin")).ok, true);
  const [row] = pendingAdvances();
  campaigns.updateGameSettings(world.campaignId, { ...world.campaign().gameSettings, romance: "off" });
  const late = await answer(kaelUser, row.id, "approve");
  assert.equal(late.status, 409, "no step at a table without romance");
  assert.equal(proposals.getItemProposal(row.id).status, "cancelled");
  assert.equal(pair(kael, "Corin").romance, "none");
  // And the next AI turn withdraws anything still waiting.
  campaigns.updateGameSettings(world.campaignId, { ...world.campaign().gameSettings, romance: "on" });
  relationships.patchRelationship(pair(kael, "Corin").id, { advanceReadyUntil: advances.getAiTurns(world.campaignId) + 3 });
  assert.equal((await npcMove(kael, "Corin")).ok, true);
  const [again] = pendingAdvances();
  campaigns.updateGameSettings(world.campaignId, { ...world.campaign().gameSettings, romance: "off" });
  tick(advances.getAiTurns(world.campaignId) + 1);
  assert.equal(proposals.getItemProposal(again.id).status, "cancelled");
  campaigns.updateGameSettings(world.campaignId, { ...world.campaign().gameSettings, romance: "on" });
});

// ---- the table's limits ----

await test("a family table, or a line naming romance, never opens a window", async () => {
  for (const safety of [
    { xCard: true, lines: [], veils: [], boundaries: "family" },
    { xCard: true, lines: ["romance"], veils: [], boundaries: "standard" },
  ]) {
    const table = await openWorld({ gameSettings: { safety } });
    table.addHero({ name: "Host" });
    const player = table.addUser("p");
    const hero = table.addHero({ user: player, name: "Rook", gender: "Male", abilities: { cha: 20 } });
    (await import("../src/lib/db/sheets.ts")).setOpenToAdvances(hero.id, true);
    await table.invoke("set_npc", { name: "Vela", gender: "Female", drawnTo: ["men"] });
    const row = relationships.ensureRelationship({ campaignId: table.campaignId, characterId: hero.id, characterName: "Rook", subjectKind: "npc", subjectName: "Vela" });
    relationships.patchRelationship(row.id, { approval: 80 });
    while (advances.getAiTurns(table.campaignId) < 8) advances.bumpAiTurns(table.campaignId);
    table.dice(1);
    tickAdvances(table.campaign(), 8, "Vela smiles.");
    table.clearDice();
    assert.equal(relationships.getRelationshipById(row.id).advanceReadyUntil, 0, JSON.stringify(safety));
    const made = await table.invoke("romance_advance", { characterId: hero.id, subject: "Vela", to: "courting", initiator: "npc" });
    assert.equal(made.ok, false);
  }
});

// ---- companions ----

await test("a lasting companion has a person behind the sheet: axes a deed weighs against, reachable by social_check", async () => {
  const solo = await openWorld();
  const hero = solo.addHero({ name: "Wren", gender: "Female", abilities: { cha: 18 } });
  const added = await solo.invoke("add_companion", {
    name: "Brannoc",
    class: "fighter",
    gender: "Male",
    drawnTo: ["women"],
    personality: "Gruff, loyal, laughs at his own jokes.",
    kind: "party",
  });
  assert.equal(added.ok, true, added.error);
  const companion = solo.sheets().find((sheet) => sheet.name === "Brannoc");
  assert.deepEqual(companion.attraction, { genders: ["Female"], note: "" });
  const row = npcs.listNpcs(solo.campaignId).find((npc) => npc.companionSheetId === companion.id);
  assert.ok(row, "a linked row");
  assert.ok(row.agency.personality, "seeded axes");
  assert.equal(row.attitude, "friendly");
  assert.ok(!npcs.listCastNpcs(solo.campaignId).some((npc) => npc.id === row.id), "the party block speaks for him, not the cast");
  const beat = await solo.invoke("relationship_beat", { characterId: hero.id, subject: "Brannoc", beat: "mercy" });
  assert.equal(beat.ok, true, beat.error);
  solo.dice(15);
  const talked = await solo.invoke("social_check", { characterId: hero.id, npc: "Brannoc", approach: "persuade" });
  solo.clearDice();
  assert.equal(talked.ok, true, talked.error);
  const bond = relationships.getRelationship(solo.campaignId, hero.id, "Brannoc");
  assert.equal(bond.subjectKind, "companion", "his standing stays a companion's");

  // A companion courts, and is never courted.
  (await import("../src/lib/db/sheets.ts")).setOpenToAdvances(hero.id, true);
  relationships.patchRelationship(bond.id, { approval: 70 });
  while (advances.getAiTurns(solo.campaignId) < 8) advances.bumpAiTurns(solo.campaignId);
  solo.dice(1);
  tickAdvances(solo.campaign(), 8, "");
  solo.clearDice();
  assert.ok(relationships.getRelationshipById(bond.id).advanceReadyUntil > 0, "a party companion travels with them, so he is in the scene");
  const route = await solo.route("campaigns/[campaignId]/sheet/romance");
  solo.signIn(solo.owner);
  const response = await route.PUT(
    new Request("http://test/", { method: "PUT", body: JSON.stringify({ characterId: companion.id, open: true }) }),
    { params: Promise.resolve({ campaignId: solo.campaignId }) },
  );
  assert.equal(response.status, 404, "no player answers for a companion");
});

await test("a guest ally never courts", async () => {
  const solo = await openWorld();
  const hero = solo.addHero({ name: "Ash", gender: "Male", abilities: { cha: 18 } });
  const added = await solo.invoke("add_companion", { name: "Gate Guard", class: "fighter", gender: "Female", personality: "Brisk.", kind: "guest" });
  assert.equal(added.ok, true, added.error);
  assert.ok(!npcs.listNpcs(solo.campaignId).some((npc) => npc.name === "Gate Guard"), "a guest has no row behind them");
  (await import("../src/lib/db/sheets.ts")).setOpenToAdvances(hero.id, true);
  const row = relationships.ensureRelationship({ campaignId: solo.campaignId, characterId: hero.id, characterName: "Ash", subjectKind: "companion", subjectName: "Gate Guard" });
  relationships.patchRelationship(row.id, { approval: 80 });
  while (advances.getAiTurns(solo.campaignId) < 8) advances.bumpAiTurns(solo.campaignId);
  solo.dice(1);
  tickAdvances(solo.campaign(), 8, "The guard nods.");
  solo.clearDice();
  assert.equal(relationships.getRelationshipById(row.id).advanceReadyUntil, 0);
});

// ---- a person running the table ----

await test("at a human-run table the console makes the move without a window, by the same rules", async () => {
  const table = await openWorld({ gameSettings: { dmMode: "human" } });
  const player = table.addUser("p");
  const hero = table.addHero({ user: player, name: "Lio", gender: "Male" });
  await table.invoke("set_npc", { name: "Senna", gender: "Female", drawnTo: ["men"] });
  const row = relationships.ensureRelationship({ campaignId: table.campaignId, characterId: hero.id, characterName: "Lio", subjectKind: "npc", subjectName: "Senna" });
  relationships.patchRelationship(row.id, { approval: 60 });
  const closed = await table.invoke("romance_advance", { characterId: hero.id, subject: "Senna", to: "courting", initiator: "npc" });
  assert.equal(closed.ok, false, "not opted in");
  assert.match(closed.error, /has not opened Lio/);
  (await import("../src/lib/db/sheets.ts")).setOpenToAdvances(hero.id, true);
  const made = await table.invoke("romance_advance", { characterId: hero.id, subject: "Senna", to: "courting", initiator: "npc" });
  assert.equal(made.ok, true, made.error);
});

finish();
