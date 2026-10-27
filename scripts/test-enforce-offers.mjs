// Offers to players and the DM (issue 239), through the routes a player's
// client calls and the interception the DM's tools go through.
//
// With item offers on, a DM grant, removal or coin change to a player
// character is an offer the player answers. Settling it must settle the
// story too: the table hears how it went, the DM's next turn reads what
// waits and what was settled, an offer that cannot apply is refused before
// anyone sees it, and the same loot is never offered twice.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";

const { test, finish } = suite("test-enforce-offers");
const proposals = await import("../src/lib/db/item-proposals.ts");
const messages = await import("../src/lib/db/messages.ts");
const { listMembers } = await import("../src/lib/db/campaigns.ts");
const { maybeProposeItemChange, offerLinesForPrompt } = await import("../src/lib/dm/proposal-intercept.ts");
const { OFFER_NOTE_PREFIX, renderOffersBlock } = await import("../src/lib/dm/proposal-logic.ts");
const { buildGameStateBlock, buildDmMessages } = await import("../src/lib/dm/prompt.ts");

const world = await openWorld({ gameSettings: { inventoryApprovals: true, vitalsApprovals: true } });
// The owner runs the story and holds the first sheet; Nysa is a player.
world.addHero({ class: "fighter", level: 3 });
const nysaUser = world.addUser("nysa");
const nysa = world.addHero({ user: nysaUser, name: "Nysa", class: "rogue", level: 2 });
world.patch(nysa.id, { gold: 5, copper: 0, equipment: [{ name: "Dart", qty: 10 }] });

const sheet = () => world.sheet(nysa.id);
const held = (name) => sheet().equipment.find((item) => item.name.toLowerCase() === name.toLowerCase())?.qty ?? 0;
const sheetsById = () => new Map(world.sheets().map((entry) => [entry.id, entry]));
const offer = (toolName, args) =>
  maybeProposeItemChange(world.campaign(), "", toolName, JSON.stringify({ characterId: nysa.id, ...args }), sheetsById());
const answers = await world.route("campaigns/[campaignId]/item-proposals/[proposalId]");
async function answer(user, proposalId, action) {
  world.signIn(user);
  const response = await answers.POST(
    new Request("http://test/", { method: "POST", body: JSON.stringify({ action }) }),
    { params: Promise.resolve({ campaignId: world.campaignId, proposalId }) },
  );
  return { status: response.status, body: await response.json() };
}
const pending = () => proposals.listOpenItemProposals(world.campaignId);
const lastPending = () => pending().at(-1);
const lastLine = () => messages.listRecentMessages(world.campaignId, 1)[0];
const settledLine = () => {
  const line = lastLine();
  assert.equal(line?.authorType, "system", "the table hears it as a system line");
  assert.ok(line.content.startsWith(OFFER_NOTE_PREFIX), `marked as a settled offer: ${line.content}`);
  return line.content.slice(OFFER_NOTE_PREFIX.length);
};

await test("an accepted offer lands on the sheet, is recorded with what it did, and is told to the table", async () => {
  const made = offer("grant_item", { item: "Coin purse", qty: 1, reason: "the dead bandit's" });
  assert.equal(made.ok, true, made.error);
  assert.match(made.note, /answer arrives as a table note/);
  const row = lastPending();
  assert.equal(row.summary, "Give Coin purse to Nysa");
  const done = await answer(nysaUser, row.id, "approve");
  assert.equal(done.status, 200, done.body.error);
  assert.equal(held("Coin purse"), 1);
  const after = proposals.getItemProposal(row.id);
  assert.equal(after.status, "approved");
  assert.equal(after.outcome, "Nysa now carries Coin purse.");
  assert.equal(done.body.proposal.outcome, after.outcome);
  assert.equal(settledLine(), "Nysa accepted the offer: Give Coin purse to Nysa. Nysa now carries Coin purse.");
});

await test("the same loot again, right after it was accepted, is refused; said to be another, it is offered", async () => {
  const again = offer("grant_item", { item: "coin purse", reason: "the purse" });
  assert.match(again.error, /already accepted "Give coin purse to Nysa"/);
  assert.equal(held("Coin purse"), 1);
  assert.equal(pending().length, 0);
  const another = offer("grant_item", { item: "Coin purse", additional: true, reason: "the second bandit's" });
  assert.equal(another.ok, true, another.error);
  const row = lastPending();
  const refused = await answer(nysaUser, row.id, "decline");
  assert.equal(refused.status, 200, refused.body.error);
  assert.equal(held("Coin purse"), 1, "a decline moves nothing");
  assert.equal(settledLine(), "Nysa declined the offer: Give Coin purse to Nysa. Nothing changed.");
});

await test("while an offer waits, an identical one is refused even as another; the lead may withdraw it", async () => {
  const made = offer("grant_item", { item: "Rope" });
  assert.equal(made.ok, true, made.error);
  assert.match(offer("grant_item", { item: "rope" }).error, /still waiting for Nysa's player/);
  assert.match(offer("grant_item", { item: "Rope", additional: true }).error, /still waiting/);
  assert.equal(pending().length, 1);
  const row = lastPending();
  const withdrawn = await answer(world.owner, row.id, "cancel");
  assert.equal(withdrawn.status, 200, withdrawn.body.error);
  assert.equal(held("Rope"), 0);
  assert.equal(settledLine(), "The lead withdrew the offer: Give Rope to Nysa. Nothing changed.");
});

await test("a removal of what is not carried, or of more than carried, never becomes an offer", async () => {
  const before = pending().length;
  assert.match(offer("remove_item", { item: "Longsword" }).error, /does not carry "Longsword"/);
  assert.match(offer("remove_item", { item: "Dart", qty: 11 }).error, /carries only 10 Dart/);
  assert.equal(pending().length, before);
  assert.equal(held("Dart"), 10);
});

await test("an accepted removal empties the sheet and says so; the next attempt is refused before it is shown", async () => {
  const made = offer("remove_item", { item: "Dart", qty: 10, reason: "dropped" });
  assert.equal(made.ok, true, made.error);
  const row = lastPending();
  const done = await answer(nysaUser, row.id, "approve");
  assert.equal(done.status, 200, done.body.error);
  assert.equal(held("Dart"), 0);
  assert.equal(settledLine(), "Nysa accepted the offer: Take Dart x10 from Nysa. Nysa no longer carries any Dart.");
  assert.match(offer("remove_item", { item: "Dart", qty: 10 }).error, /does not carry "Dart"/);
  assert.equal(pending().length, 0);
});

await test("an accepted award says the new purse, and the same sum again is refused", async () => {
  const made = offer("modify_gold", { delta: 7, reason: "the purse's coin" });
  assert.equal(made.ok, true, made.error);
  const row = lastPending();
  const done = await answer(nysaUser, row.id, "approve");
  assert.equal(done.status, 200, done.body.error);
  assert.equal(sheet().gold, 12);
  assert.equal(settledLine(), "Nysa accepted the offer: Give 7 gold to Nysa. Nysa's purse now holds 12 gp.");
  assert.match(offer("modify_gold", { delta: 7 }).error, /that coin is claimed/);
});

await test("an offer the world moved under fails as a failure, told as such, and moves nothing", async () => {
  world.patch(nysa.id, { equipment: [...sheet().equipment, { name: "Lantern", qty: 1 }] });
  const made = offer("remove_item", { item: "Lantern" });
  assert.equal(made.ok, true, made.error);
  const row = lastPending();
  world.patch(nysa.id, { equipment: sheet().equipment.filter((item) => item.name !== "Lantern") });
  const done = await answer(nysaUser, row.id, "approve");
  assert.equal(done.status, 409);
  const after = proposals.getItemProposal(row.id);
  assert.equal(after.status, "declined");
  assert.match(after.outcome, /^failed: /);
  assert.match(settledLine(), /^The offer "Take Lantern from Nysa" could not be applied \(.*Lantern.*\)\. Nothing changed\.$/);
  assert.equal(pending().length, 0);
});

await test("the lead answering for the player is said as the lead", async () => {
  const made = offer("grant_item", { item: "Lantern" });
  assert.equal(made.ok, true, made.error);
  const row = lastPending();
  const done = await answer(world.owner, row.id, "approve");
  assert.equal(done.status, 200, done.body.error);
  assert.equal(held("Lantern"), 1);
  assert.equal(settledLine(), "The lead accepted the offer for Nysa: Give Lantern to Nysa. Nysa now carries Lantern.");
});

await test("a confirmed blow says the hit points it left", async () => {
  const before = sheet().currentHp;
  const made = offer("apply_damage", { amount: 2, type: "piercing" });
  assert.equal(made.ok, true, made.error);
  const row = lastPending();
  const done = await answer(nysaUser, row.id, "approve");
  assert.equal(done.status, 200, done.body.error);
  assert.equal(sheet().currentHp, before - 2);
  assert.equal(settledLine(), `Nysa accepted the offer: Deal 2 piercing damage to Nysa. Nysa is at ${before - 2}/${sheet().maxHp} hit points.`);
});

await test("the DM's game state lists what waits and what was settled, and the transcript marks the table's answer", async () => {
  const waiting = offer("grant_item", { item: "Torch" });
  assert.equal(waiting.ok, true, waiting.error);
  const lines = offerLinesForPrompt(world.campaignId, sheetsById());
  assert.equal(lines[0].status, "pending");
  assert.equal(lines[0].summary, "Give Torch to Nysa");
  assert.equal(lines[0].characterName, "Nysa");
  const accepted = lines.find((line) => line.summary === "Give Coin purse to Nysa" && line.status === "approved");
  assert.ok(accepted, "the accepted purse is listed");
  assert.equal(accepted.outcome, "Nysa now carries Coin purse.");
  assert.ok(lines.some((line) => line.status === "failed"), "the failed removal is listed as a failure");
  assert.ok(lines.some((line) => line.status === "cancelled"), "the withdrawn rope is listed");
  const block = renderOffersBlock(lines);
  assert.match(block, /WAITING on Nysa's player: Give Torch to Nysa/);
  assert.match(block, /ACCEPTED (just now|\d+ min ago) and applied: Give Coin purse to Nysa\. Nysa now carries Coin purse\./);

  const state = {
    campaign: world.campaign(),
    members: listMembers(world.campaignId),
    sheets: world.sheets(),
    recentRolls: [],
    storySummary: "",
    contextLimitTokens: 32_000,
    offers: lines,
  };
  assert.match(buildGameStateBlock(state), /Offers to players \(changes a player must accept/);
  const history = messages.listRecentMessages(world.campaignId, 20);
  const rendered = buildDmMessages(state, history);
  const settledInPrompt = rendered.filter((message) => message.role === "user" && message.content.includes("[An offer was settled by the player's own answer"));
  assert.ok(settledInPrompt.length >= 5, `the settled offers reach the DM as the player's own answers (${settledInPrompt.length})`);
  assert.ok(!rendered.some((message) => message.content.includes(OFFER_NOTE_PREFIX)), "the stored prefix is not sent raw");
});

await test("an offer that lapses unanswered is told to the table as lapsed, once", async () => {
  const made = offer("grant_item", { item: "Candle" });
  assert.equal(made.ok, true, made.error);
  const row = lastPending();
  const { getDatabase } = await import("../src/lib/db/core.ts");
  getDatabase().prepare("UPDATE item_proposals SET created_at = ? WHERE id = ?").run(new Date(Date.now() - 25 * 3_600_000).toISOString(), row.id);
  assert.ok(!pending().some((entry) => entry.id === row.id), "the read expires it");
  assert.equal(proposals.getItemProposal(row.id).status, "expired");
  assert.equal(settledLine(), "The offer lapsed unanswered: Give Candle to Nysa. Nothing changed.");
  const count = () => messages.listRecentMessages(world.campaignId, 50).filter((line) => line.content.includes("Give Candle to Nysa")).length;
  const before = count();
  pending();
  assert.equal(count(), before, "a second read says nothing more");
  assert.ok(offerLinesForPrompt(world.campaignId, sheetsById()).some((line) => line.status === "expired" && line.summary === "Give Candle to Nysa"));
  // The lapsed loot may be offered again.
  const again = offer("grant_item", { item: "Candle" });
  assert.equal(again.ok, true, again.error);
  await answer(world.owner, lastPending().id, "cancel");
});

// An offer staged by the server before a grant's item was renamed from name
// (PR #542) waits in the table as it was made: accepted after the upgrade it
// lands, and an identical new offer is still the same one.
await test("an offer stored under an argument's older name is applied and compared as it was meant", async () => {
  const { allocateSeq } = await import("../src/lib/db/campaigns.ts");
  const row = proposals.insertItemProposal({
    campaignId: world.campaignId,
    turnId: null,
    characterId: nysa.id,
    userId: nysaUser.id,
    toolName: "grant_item",
    argsJson: JSON.stringify({ characterId: nysa.id, name: "Brass compass", qty: 1, reason: "the crypt" }),
    summary: "Give Brass compass to Nysa",
    reason: "the crypt",
    seq: allocateSeq(world.campaignId),
  });
  assert.match(offer("grant_item", { item: "brass compass" }).error, /still waiting for Nysa's player/);
  const done = await answer(nysaUser, row.id, "approve");
  assert.equal(done.status, 200, done.body.error);
  assert.equal(held("Brass compass"), 1);
  assert.equal(proposals.getItemProposal(row.id).outcome, "Nysa now carries Brass compass.");
});

await test("with item offers off, a grant applies at once and nothing here runs", async () => {
  const other = await openWorld({ gameSettings: { inventoryApprovals: false } });
  const hero = other.addHero({ class: "fighter", level: 1 });
  const direct = maybeProposeItemChange(
    other.campaign(),
    "",
    "grant_item",
    JSON.stringify({ characterId: hero.id, item: "Coin purse" }),
    new Map(other.sheets().map((entry) => [entry.id, entry])),
  );
  assert.equal(direct, null);
  other.close();
});

world.close();
finish();
