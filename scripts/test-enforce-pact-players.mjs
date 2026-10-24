// Players in a pact (issue 503 Phase 7), through the routes a player and an
// agent use, with the dice under the test's control.
//
// "Pacts may approach me" is each player's own switch, off by default: a
// pact approaches only a character whose player turned it on, never one who
// did not, and never at a solo table. The approach is an offer only that
// player reads and answers (join, play along, tell the party, refuse); the
// lead of an AI table never sees it. A member's secret actions are held by
// the server and rolled where only that player and the storyteller see;
// caught, one is revealed on the spot, and every one comes out when the plan
// goes. Theft moves inventory. Attacking another player needs a table set to
// Turn, and lands through Phase 6: the traitor's sheet crosses to the foes'
// side as the plan goes, in a fight.
import assert from "node:assert/strict";
import "./lib/enforce-campaign.mjs";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";

const { test, finish } = suite("test-enforce-pact-players");
const npcs = await import("../src/lib/db/npcs.ts");
const messages = await import("../src/lib/db/messages.ts");
const rolls = await import("../src/lib/db/rolls.ts");
const proposals = await import("../src/lib/db/item-proposals.ts");
const conscienceDb = await import("../src/lib/db/companion-conscience.ts");
const pactsDb = await import("../src/lib/db/pacts.ts");
const sheetsDb = await import("../src/lib/db/sheets.ts");
const { getClock } = await import("../src/lib/db/clock.ts");
const { CONTENT } = await import("../src/lib/dm/conscience-logic.ts");
const { replan } = await import("../src/lib/dm/pacts.ts");
const { payloadForViewer, tablePayload, viewerFor } = await import("../src/lib/table-delivery.ts");
const { publicItemProposal } = await import("../src/lib/dm/proposal-view.ts");
const { publicSheet } = await import("../src/lib/dm/sheet-view.ts");
const { sideOf } = await import("../src/lib/dm/combatant.ts");
const { fieldedSheets } = await import("../src/lib/dm/roster.ts");

// Kael (the owner, who leads this AI table) and Brin, another player, with
// Seren, a lasting companion who wavers.
async function table({ gameSettings = {}, solo = false, brin = {} } = {}) {
  const world = await openWorld({ gameSettings: { companions: "full", ...gameSettings } });
  const kael = world.addHero({ name: "Kael", gender: "Male", equipment: [{ name: "Spyglass", qty: 1 }] });
  const brinUser = solo ? null : world.addUser("brin");
  const brinSheet = solo ? null : world.addHero({ user: brinUser, name: "Brin", gender: "Female", ...brin });
  const added = await world.invoke("add_companion", { name: "Seren", class: "paladin", alignment: "LG", gender: "Female", personality: "Quiet.", kind: "party" });
  assert.equal(added.ok, true, added.error);
  const row = () => npcs.listNpcs(world.campaignId).find((npc) => npc.name === "Seren");
  npcs.patchNpcAgency(row().id, { personality: { drive: 0, diligence: 0, boldness: 0, warmth: 0, empathy: 0, composure: 0 } });
  conscienceDb.saveConscience(row().id, { ...CONTENT, held: 1, shown: 1 });
  return { world, kael, brin: brinSheet, brinUser, row };
}

async function call(world, user, route, method, body, extra = {}) {
  world.signIn(user);
  const handler = await world.route(route);
  const response = await handler[method](
    new Request("http://test/", { method, ...(body ? { body: JSON.stringify(body) } : {}) }),
    { params: Promise.resolve({ campaignId: world.campaignId, ...extra }) },
  );
  const json = await response.json();
  return { status: response.status, body: json, text: JSON.stringify(json) };
}

const consent = (t, user, characterId, open) => call(t.world, user, "campaigns/[campaignId]/sheet/pacts", "PUT", { characterId, open });
const approaches = (world) => proposals.listOpenItemProposals(world.campaignId).filter((row) => row.toolName === "pact_approach");
const answer = (t, user, proposal, action, choice) =>
  call(t.world, user, "campaigns/[campaignId]/item-proposals/[proposalId]", "POST", { action, ...(choice ? { choice } : {}) }, { proposalId: proposal.id });
const secret = (t, user, body) => call(t.world, user, "campaigns/[campaignId]/actions", "POST", { secret: body });

async function longRest(world, faces) {
  world.dice(faces);
  const rest = await world.invoke("take_rest", { kind: "long" });
  world.clearDice();
  assert.equal(rest.ok, true, rest.error);
  return rest;
}

// Brin consents and is approached at the night watch: no other companion to
// turn, so the wavering Seren goes to the player who said she may.
async function approached(options) {
  const t = await table(options);
  const set = await consent(t, t.brinUser, t.brin.id, true);
  assert.equal(set.status, 200, set.text);
  await longRest(t.world, [10, 20]);
  const [offer] = approaches(t.world);
  assert.ok(offer, "Brin was approached");
  return { ...t, offer };
}

// The pact made ready: Seren at her breaking point.
function ready(t) {
  conscienceDb.saveConscience(t.row().id, { ...CONTENT, held: 4, shown: 4 });
}

await test("a pact approaches only a consenting player character: Brin, who said yes, and never Kael", async () => {
  const t = await approached();
  assert.equal(t.offer.characterId, t.brin.id);
  assert.equal(t.offer.userId, t.brinUser.id);
  assert.equal(t.offer.ownerOnly, true);
  assert.equal(t.offer.summary, "A private offer for Brin");
  assert.ok(!approaches(t.world).some((row) => row.characterId === t.kael.id), "Kael never");
  const pact = pactsDb.listPacts(t.world.campaignId)[0];
  assert.deepEqual(pact.approached, [t.brin.id]);
});

await test("the consent is the owner's alone, blanked for everyone else, and a solo table never offers it", async () => {
  const t = await table();
  const other = await consent(t, t.world.owner, t.brin.id, true);
  assert.equal(other.status, 404, "the lead cannot set it for Brin");
  assert.equal((await consent(t, t.brinUser, t.brin.id, true)).status, 200);
  assert.equal(sheetsDb.getSheetById(t.brin.id).openToPacts, true);
  assert.equal(publicSheet(sheetsDb.getSheetById(t.brin.id)).openToPacts, false, "blanked for the table");
  const solo = await table({ solo: true });
  const refused = await consent(solo, solo.world.owner, solo.kael.id, true);
  assert.equal(refused.status, 409, "a solo table has no other player to betray");
  sheetsDb.setOpenToPacts(solo.kael.id, true);
  await longRest(solo.world, [20, 20]);
  assert.deepEqual(approaches(solo.world), [], "never approached, even switched on by hand");
});

await test("the approach reaches Brin alone: not the lead's snapshot, list, stream or replay", async () => {
  const t = await approached();
  const kaelSees = await call(t.world, t.world.owner, "campaigns/[campaignId]", "GET");
  assert.ok(!kaelSees.body.itemProposals.some((row) => row.id === t.offer.id), "not in the lead's snapshot");
  const kaelList = await call(t.world, t.world.owner, "campaigns/[campaignId]/item-proposals", "GET");
  assert.deepEqual(kaelList.body.proposals, []);
  const brinList = await call(t.world, t.brinUser, "campaigns/[campaignId]/item-proposals", "GET");
  const mine = brinList.body.proposals.find((row) => row.id === t.offer.id);
  assert.equal(mine.ownerOnly, true);
  assert.deepEqual(mine.choices.map((choice) => choice.id), ["join", "play_along", "report", "refuse"]);
  const published = { proposal: publicItemProposal(t.offer) };
  const stored = tablePayload("item_proposal_added", published);
  assert.deepEqual(stored, { proposal: { id: t.offer.id, ownerOnly: true } }, "the log keeps the id alone");
  assert.equal(payloadForViewer("item_proposal_added", stored, viewerFor(t.world.campaignId, t.world.owner.id), published), null, "live: nothing to the lead");
  assert.equal(payloadForViewer("item_proposal_added", stored, viewerFor(t.world.campaignId, t.world.owner.id)), null, "replay: nothing to the lead");
  assert.equal(payloadForViewer("item_proposal_added", stored, viewerFor(t.world.campaignId, t.brinUser.id)).proposal.summary, "A private offer for Brin", "replay: Brin's whole card");
  const lead = await answer(t, t.world.owner, t.offer, "approve", "join");
  assert.equal(lead.status, 404, "to the lead it does not exist");
});

await test("Brin joins: the pact names her, her own view shows the plan, nobody else's does, and the table heard nothing", async () => {
  const t = await approached();
  const said = messages.listRecentMessages(t.world.campaignId, 30).length;
  const joined = await answer(t, t.brinUser, t.offer, "approve", "join");
  assert.equal(joined.status, 200, joined.text);
  assert.equal(joined.body.outcome, "joined");
  const pact = pactsDb.listPacts(t.world.campaignId)[0];
  assert.ok(pact.members.some((member) => member.kind === "player" && member.characterId === t.brin.id && member.stance === "joined"));
  const view = await call(t.world, t.brinUser, "campaigns/[campaignId]/pact", "GET");
  assert.equal(view.body.pacts.length, 1);
  assert.match(view.body.pacts[0].plan, /leave the party together|weaken the party/);
  const kael = await call(t.world, t.world.owner, "campaigns/[campaignId]/pact", "GET");
  assert.deepEqual(kael.body, { pacts: [] });
  assert.equal(messages.listRecentMessages(t.world.campaignId, 30).length, said, "no table note for an owner-only answer");
});

await test("a secret action is held and hidden: only Brin reads its roll, then the plan goes and it comes out", async () => {
  const t = await approached();
  await answer(t, t.brinUser, t.offer, "approve", "join");
  t.world.dice([20]);
  const done = await secret(t, t.brinUser, { kind: "scheme", text: "loosen the wheel of the cart", skill: "stealth" });
  t.world.clearDice();
  assert.equal(done.status, 200, done.text);
  assert.equal(done.body.caught, false);
  assert.match(done.body.confirmation, /Done in secret: loosen the wheel of the cart/);
  const held = pactsDb.listPacts(t.world.campaignId)[0].secrets[0];
  assert.equal(rolls.getRoll(held.rollId).visibility, "secret");
  const kaelDice = await call(t.world, t.world.owner, "campaigns/[campaignId]", "GET");
  assert.ok(!kaelDice.body.rolls.some((roll) => roll.id === held.rollId), "the lead never reads it");
  const brinDice = await call(t.world, t.brinUser, "campaigns/[campaignId]", "GET");
  assert.ok(brinDice.body.rolls.some((roll) => roll.id === held.rollId), "Brin does");
  assert.doesNotMatch(messages.listRecentMessages(t.world.campaignId, 10).map((message) => message.content).join("\n"), /wheel/);
  ready(t);
  await t.world.invoke("pass_time", { amount: 24, unit: "hours" });
  await longRest(t.world, []);
  assert.equal(rolls.getRoll(held.rollId).visibility, "public", "its roll is revealed");
  const lines = messages.listRecentMessages(t.world.campaignId, 12).map((message) => message.content).join("\n");
  assert.match(lines, /\[Revealed\] The pact made its move: Seren, Brin/);
  assert.match(lines, /Brin had, in secret: loosen the wheel of the cart/);
  assert.match(lines, /Brin goes with the pact/);
});

await test("a secret action someone catches is revealed on the spot", async () => {
  const t = await approached();
  await answer(t, t.brinUser, t.offer, "approve", "join");
  t.world.dice([1]);
  const done = await secret(t, t.brinUser, { kind: "scheme", text: "cut the horses loose", skill: "stealth" });
  t.world.clearDice();
  assert.equal(done.body.caught, true);
  assert.match(done.body.revealed, /Kael caught Brin in the act: cut the horses loose/);
  const held = pactsDb.listPacts(t.world.campaignId)[0].secrets[0];
  assert.equal(rolls.getRoll(held.rollId).visibility, "public");
});

await test("theft moves inventory: the thing leaves its owner's pack at once and reaches the thief when it comes out", async () => {
  const t = await approached();
  await answer(t, t.brinUser, t.offer, "approve", "join");
  t.world.dice([20]);
  const done = await secret(t, t.brinUser, { kind: "steal", targetId: t.kael.id, item: "Spyglass" });
  t.world.clearDice();
  assert.equal(done.status, 200, done.text);
  assert.ok(!t.world.sheet(t.kael.id).equipment.some((item) => item.name === "Spyglass"), "gone from Kael's pack");
  assert.ok(!t.world.sheet(t.brin.id).equipment.some((item) => item.name === "Spyglass"), "not yet on Brin's sheet, which the table reads");
  ready(t);
  await t.world.invoke("pass_time", { amount: 24, unit: "hours" });
  await longRest(t.world, []);
  assert.ok(t.world.sheet(t.brin.id).equipment.some((item) => item.name === "Spyglass"), "Brin has it now");
});

await test("Kael tells the party: the pact is out in the open and has to act now", async () => {
  const t = await table();
  await consent(t, t.world.owner, t.kael.id, true);
  await longRest(t.world, [10, 20]);
  const [offer] = approaches(t.world);
  assert.equal(offer.characterId, t.kael.id);
  const told = await answer({ world: t.world }, t.world.owner, offer, "approve", "report");
  assert.equal(told.body.outcome, "told the party");
  assert.match(messages.listRecentMessages(t.world.campaignId, 12).map((message) => message.content).join("\n"), /\[Revealed\] Kael told the party of the pact: Seren/);
  assert.equal(t.world.sheets().find((sheet) => sheet.name === "Seren"), undefined, "Seren walks out");
});

await test("playing along: a leader's Insight that beats the spy's Deception catches her, and the pact moves at once", async () => {
  const t = await approached({ brin: { abilities: { cha: 6 } } });
  const along = await answer(t, t.brinUser, t.offer, "approve", "play_along");
  assert.equal(along.body.outcome, "playing along");
  await t.world.invoke("pass_time", { amount: 24, unit: "hours" });
  await longRest(t.world, [1, 1]);
  const pact = pactsDb.listPacts(t.world.campaignId)[0];
  assert.equal(pact.status, "fired");
  assert.match(messages.listRecentMessages(t.world.campaignId, 12).map((message) => message.content).join("\n"), /The pact caught a spy and moved at once.*Brin had only been playing along/s);
});

await test("attacking another player is refused at a Leave table, and at a Turn table lands through Phase 6 as the plan goes in a fight", async () => {
  const leave = await approached();
  await answer(leave, leave.brinUser, leave.offer, "approve", "join");
  const refused = await secret(leave, leave.brinUser, { kind: "attack", targetId: leave.kael.id });
  assert.equal(refused.status, 409);
  assert.match(refused.body.error, /needs a table set to Turn/);

  const t = await approached({ gameSettings: { companionConscience: "turn" } });
  await answer(t, t.brinUser, t.offer, "approve", "join");
  const pact = pactsDb.listPacts(t.world.campaignId)[0];
  pactsDb.savePact({ ...replan(t.world.campaign(), pact), plan: "strike", trigger: "fight", tactic: null });
  t.world.dice([1]);
  const declared = await secret(t, t.brinUser, { kind: "attack", targetId: t.kael.id });
  t.world.clearDice();
  assert.equal(declared.status, 200, declared.text);
  ready(t);
  const seren = t.world.sheets().find((sheet) => sheet.name === "Seren");
  // The fight opens on Seren's turn: the bandit's die, then each fielded
  // character's in roster order, hers the highest.
  const fielded = fieldedSheets(t.world.campaign()).filter((sheet) => !sheet.deathSaves?.dead);
  t.world.dice([1, ...fielded.map((sheet) => (sheet.id === seren.id ? 20 : 2))]);
  const opened = await t.world.invoke("start_encounter", { enemies: [{ monster: "bandit", count: 1 }] });
  t.world.clearDice();
  assert.equal(opened.ok, true, opened.error);
  assert.match(opened.result.companionsLeft.join(" "), /\[Revealed\] The pact made its move: Seren, Brin/);
  const encounter = t.world.encounter();
  assert.equal(sideOf(encounter, "sheet", t.brin.id), "foe", "Brin's own sheet on the foes' side");
  assert.equal(sideOf(encounter, "sheet", seren.id), "foe", "Seren's too");
  assert.equal(sideOf(encounter, "sheet", t.kael.id), "party");
  assert.equal(pactsDb.listPacts(t.world.campaignId)[0].status, "fired");
});

await test("switching consent off withdraws an approach still waiting, quietly", async () => {
  const t = await approached();
  const off = await consent(t, t.brinUser, t.brin.id, false);
  assert.equal(off.body.withdrawn, 1);
  assert.deepEqual(approaches(t.world), []);
  assert.ok(getClock(t.world.campaignId));
});

finish();
