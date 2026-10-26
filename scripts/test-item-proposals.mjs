// Inventory-approval logic: which mutations become proposals, the approval
// bar summary, expiry, and who may resolve.
import assert from "node:assert/strict";
import {
  canResolveProposal,
  proposalExpired,
  proposalSummary,
  PROPOSAL_TOOL_NAMES,
  shouldProposeChange,
  shouldProposeItemChange,
  VITALS_PROPOSAL_TOOL_NAMES,
} from "../src/lib/dm/proposal-logic.ts";

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

test("only inventory/gold tools are eligible, only when enabled", () => {
  assert.ok(shouldProposeItemChange(true, "grant_item", {}));
  assert.ok(shouldProposeItemChange(true, "purchase", {}));
  assert.ok(!shouldProposeItemChange(false, "grant_item", {}));
  assert.ok(!shouldProposeItemChange(true, "apply_damage", {}));
  assert.ok(!shouldProposeItemChange(true, "heal", {}));
  assert.ok(!shouldProposeItemChange(true, "use_item", {}));
  assert.equal(PROPOSAL_TOOL_NAMES.size, 4);
});

test("vitals tools answer to their own switch, items to theirs, nothing to neither", () => {
  const both = { inventoryApprovals: true, vitalsApprovals: true };
  const itemsOnly = { inventoryApprovals: true, vitalsApprovals: false };
  const vitalsOnly = { inventoryApprovals: false, vitalsApprovals: true };
  const neither = { inventoryApprovals: false, vitalsApprovals: false };
  const pc = { isCompanion: false };
  for (const tool of VITALS_PROPOSAL_TOOL_NAMES) {
    assert.equal(shouldProposeChange(both, tool, pc), true, tool);
    assert.equal(shouldProposeChange(vitalsOnly, tool, pc), true, tool);
    assert.equal(shouldProposeChange(itemsOnly, tool, pc), false, tool);
    assert.equal(shouldProposeChange(neither, tool, pc), false, tool);
    assert.equal(shouldProposeChange(both, tool, { isCompanion: true }), false, tool);
    assert.equal(shouldProposeChange(both, tool, null), false, tool);
  }
  for (const tool of PROPOSAL_TOOL_NAMES) {
    assert.equal(shouldProposeChange(itemsOnly, tool, pc), true, tool);
    assert.equal(shouldProposeChange(vitalsOnly, tool, pc), false, tool);
  }
  // Rolls, rests and XP are never staged.
  for (const tool of ["award_xp", "take_rest", "request_roll", "use_resource", "update_sheet"]) {
    assert.equal(shouldProposeChange(both, tool, pc), false, tool);
  }
});

test("vitals summaries read as the blow, the cure or the condition", () => {
  assert.equal(proposalSummary("apply_damage", { amount: 7, type: "fire" }, "Kara"), "Deal 7 fire damage to Kara");
  assert.equal(proposalSummary("apply_damage", { amount: 3 }, "Kara"), "Deal 3 damage to Kara");
  assert.equal(proposalSummary("heal", { amount: 5 }, "Kara"), "Heal Kara for 5");
  assert.equal(proposalSummary("heal", { spell: "Cure Wounds" }, "Kara"), "Heal Kara with Cure Wounds");
  assert.equal(proposalSummary("heal", { amount: 8, temp: true }, "Kara"), "Give Kara 8 temporary hit points");
  assert.equal(proposalSummary("set_condition", { condition: "poisoned", rounds: 3 }, "Kara"), "Make Kara poisoned for 3 rounds");
  assert.equal(proposalSummary("set_condition", { condition: "frightened", rounds: 1 }, "Kara"), "Make Kara frightened for 1 round");
  assert.equal(proposalSummary("set_condition", { condition: "prone" }, "Kara"), "Make Kara prone");
  assert.equal(proposalSummary("clear_condition", { condition: "poisoned" }, "Kara"), "Clear poisoned from Kara");
});

test("companions and missing targets stay auto-applied", () => {
  assert.ok(!shouldProposeItemChange(true, "grant_item", { isCompanion: true }));
  assert.ok(!shouldProposeItemChange(true, "grant_item", null));
});

test("proposalSummary phrasings", () => {
  assert.equal(
    proposalSummary("grant_item", { item: "Healing Potion", qty: 2 }, "Avery"),
    "Give Healing Potion x2 to Avery",
  );
  assert.equal(
    proposalSummary("remove_item", { item: "Rope" }, "Avery"),
    "Take Rope from Avery",
  );
  assert.equal(proposalSummary("modify_gold", { delta: 50 }, "Avery"), "Give 50 gold to Avery");
  assert.equal(proposalSummary("modify_gold", { delta: -25 }, "Avery"), "Take 25 gold from Avery");
  assert.equal(
    proposalSummary("purchase", { item: "Longsword", price: 15, qty: 1, action: "buy" }, "Avery"),
    "Avery buys Longsword for 15 gold",
  );
  assert.equal(
    proposalSummary("purchase", { item: "Gem", price: 10, qty: 3, action: "sell" }, "Avery"),
    "Avery sells Gem x3 for 30 gold",
  );
});

test("proposalExpired at the 24h TTL", () => {
  const now = new Date("2026-07-23T12:00:00.000Z");
  assert.ok(!proposalExpired("2026-07-23T00:00:00.000Z", now));
  assert.ok(proposalExpired("2026-07-22T11:00:00.000Z", now));
  assert.ok(proposalExpired("not a date", now));
});

test("canResolveProposal permissions", () => {
  assert.ok(canResolveProposal("approve", true, false));
  assert.ok(canResolveProposal("decline", true, false));
  assert.ok(canResolveProposal("approve", false, true));
  assert.ok(!canResolveProposal("approve", false, false));
  assert.ok(canResolveProposal("cancel", false, true));
  assert.ok(!canResolveProposal("cancel", true, false));
});

console.log(`test-item-proposals: ${passed} tests passed`);

// ---- settling an offer with the DM (issue 239) ----
import {
  appliedOutcome,
  DUPLICATE_OFFER_WINDOW_MS,
  duplicateOfferProblem,
  offerKey,
  offerLineStatus,
  offerPrecheck,
  OFFER_NOTE_PREFIX,
  parseOfferArgs,
  renderOffersBlock,
  resolutionNote,
} from "../src/lib/dm/proposal-logic.ts";

let settled = 0;
function check(name, fn) {
  fn();
  settled += 1;
}

const nysa = { name: "Nysa", equipment: [{ name: "Dart", qty: 10 }, { name: "Rope", qty: 1 }], gold: 5, copper: 50 };

check("a removal of what is not carried, or of more than carried, is refused before any offer", () => {
  assert.match(offerPrecheck("remove_item", { item: "Longsword" }, nysa)?.error, /does not carry "Longsword"/);
  assert.match(offerPrecheck("remove_item", { item: "dart", qty: 11 }, nysa)?.error, /carries only 10 dart/);
  assert.equal(offerPrecheck("remove_item", { item: "Dart", qty: 10 }, nysa), null);
  assert.equal(offerPrecheck("remove_item", { item: "DART" }, nysa), null);
});

check("coin is never prechecked: modify_gold floors at zero and a purchase is priced by the shelf", () => {
  assert.equal(offerPrecheck("modify_gold", { delta: -600 }, nysa), null);
  assert.equal(offerPrecheck("purchase", { item: "Lantern", price: 600, action: "buy" }, nysa), null);
});

check("a sale checks the pack; a buy is left to the shelf", () => {
  assert.match(offerPrecheck("purchase", { item: "Lantern", price: 1, action: "sell" }, nysa)?.error, /does not carry "Lantern" to sell/);
  assert.match(offerPrecheck("purchase", { item: "Rope", price: 1, qty: 2, action: "sell" }, nysa)?.error, /carries only 1 Rope/);
  assert.equal(offerPrecheck("purchase", { item: "Rope", price: 1, action: "sell" }, nysa), null);
});

check("only the first row by that name counts, as a removal takes it", () => {
  const twins = { ...nysa, equipment: [{ name: "Silver ring", qty: 1 }, { name: "Silver ring", qty: 1, identified: false }] };
  assert.match(offerPrecheck("remove_item", { item: "Silver ring", qty: 2 }, twins)?.error, /carries only 1 Silver ring/);
  assert.deepEqual(parseOfferArgs('{"name":"Rope"}'), { name: "Rope" });
  assert.deepEqual(parseOfferArgs("[1]"), {});
  assert.deepEqual(parseOfferArgs("not json"), {});
});

check("grants and vitals pass the precheck; it is about what cannot apply", () => {
  assert.equal(offerPrecheck("grant_item", { item: "Coin purse" }, nysa), null);
  assert.equal(offerPrecheck("apply_damage", { amount: 3 }, nysa), null);
});

check("an offer's key is what it is, not who made it or when", () => {
  assert.equal(offerKey("grant_item", { item: "Coin Purse", qty: 1 }), offerKey("grant_item", { item: "coin purse" }));
  assert.notEqual(offerKey("grant_item", { item: "Coin purse", qty: 2 }), offerKey("grant_item", { item: "Coin purse" }));
  assert.notEqual(offerKey("grant_item", { item: "ring", unidentified: true }), offerKey("grant_item", { item: "ring" }));
  assert.equal(offerKey("modify_gold", { delta: 15 }), offerKey("modify_gold", { delta: 15, reason: "loot" }));
  assert.equal(offerKey("apply_damage", { amount: 3 }), null);
});

const now = Date.parse("2026-10-11T18:00:00Z");
const at = (minutesAgo) => new Date(now - minutesAgo * 60_000).toISOString();
const character = { id: "nysa", name: "Nysa" };
const recent = (status, minutesAgo, args = { item: "Coin purse", qty: 1 }, toolName = "grant_item") => ({
  toolName,
  characterId: "nysa",
  argsJson: JSON.stringify({ characterId: "nysa", ...args }),
  status,
  createdAt: at(minutesAgo + 1),
  resolvedAt: status === "pending" ? null : at(minutesAgo),
});

check("the same loot again just after it was accepted is refused, with the reason", () => {
  const problem = duplicateOfferProblem("grant_item", { item: "coin purse" }, character, [recent("approved", 2)], now)?.error;
  assert.match(problem, /already accepted "Give coin purse to Nysa" 2 minutes ago/);
  assert.match(problem, /additional: true/);
  // Said to be another, it passes; so does the same loot much later.
  assert.equal(duplicateOfferProblem("grant_item", { item: "coin purse", additional: true }, character, [recent("approved", 2)], now), null);
  assert.equal(duplicateOfferProblem("grant_item", { item: "coin purse" }, character, [recent("approved", DUPLICATE_OFFER_WINDOW_MS / 60_000 + 1)], now), null);
  // A different item, a different character, a declined offer: no bar.
  assert.equal(duplicateOfferProblem("grant_item", { item: "Rope" }, character, [recent("approved", 2)], now), null);
  assert.equal(duplicateOfferProblem("grant_item", { item: "coin purse" }, { id: "kael", name: "Kael" }, [recent("approved", 2)], now), null);
  assert.equal(duplicateOfferProblem("grant_item", { item: "coin purse" }, character, [recent("declined", 2)], now), null);
});

check("while an identical offer still waits, a second one is refused, additional or not", () => {
  assert.match(duplicateOfferProblem("grant_item", { item: "Coin purse" }, character, [recent("pending", 1)], now)?.error, /still waiting for Nysa's player/);
  assert.match(duplicateOfferProblem("grant_item", { item: "Coin purse", additional: true }, character, [recent("pending", 1)], now)?.error, /still waiting/);
  assert.match(duplicateOfferProblem("modify_gold", { delta: 15 }, character, [recent("approved", 1, { delta: 15 }, "modify_gold")], now)?.error, /that coin is claimed/);
  // Vitals are never barred: a second blow is its own.
  assert.equal(duplicateOfferProblem("apply_damage", { amount: 3 }, character, [recent("pending", 1, { amount: 3 }, "apply_damage")], now), null);
});

check("what applying an offer left on the sheet, in a sentence", () => {
  const after = { name: "Nysa", equipment: [{ name: "Coin purse", qty: 2 }], gold: 12, copper: 5, currentHp: 7, maxHp: 15, tempHp: 0, conditions: ["poisoned"] };
  assert.equal(appliedOutcome("grant_item", { item: "Coin purse" }, after), "Nysa now carries Coin purse x2.");
  assert.equal(appliedOutcome("remove_item", { item: "Dart" }, after), "Nysa no longer carries any Dart.");
  assert.equal(appliedOutcome("remove_item", { item: "Coin purse" }, after), "Nysa still carries Coin purse x2.");
  assert.equal(appliedOutcome("modify_gold", { delta: 7 }, after), "Nysa's purse now holds 12 gp 5 cp.");
  assert.equal(appliedOutcome("apply_damage", { amount: 8 }, after), "Nysa is at 7/15 hit points.");
  assert.equal(appliedOutcome("heal", { amount: 8 }, { ...after, tempHp: 3 }), "Nysa is at 7/15 hit points with 3 temporary.");
  assert.equal(appliedOutcome("set_condition", { condition: "Poisoned" }, after), "Nysa is now Poisoned.");
  assert.equal(appliedOutcome("clear_condition", { condition: "poisoned" }, after), "Nysa is no longer poisoned.");
});

check("the chronicle's line for each way an offer settles", () => {
  assert.equal(resolutionNote({ status: "approved", summary: "Give Coin purse to Nysa", characterName: "Nysa", outcome: "Nysa now carries Coin purse." }), "Nysa accepted the offer: Give Coin purse to Nysa. Nysa now carries Coin purse.");
  assert.equal(resolutionNote({ status: "approved", summary: "Give Coin purse to Nysa", characterName: "Nysa", byLead: true }), "The lead accepted the offer for Nysa: Give Coin purse to Nysa.");
  assert.equal(resolutionNote({ status: "declined", summary: "Take Dart x10 from Nysa", characterName: "Nysa" }), "Nysa declined the offer: Take Dart x10 from Nysa. Nothing changed.");
  assert.equal(resolutionNote({ status: "cancelled", summary: "Give Rope to Nysa", characterName: "Nysa" }), "The lead withdrew the offer: Give Rope to Nysa. Nothing changed.");
  assert.equal(resolutionNote({ status: "cancelled", summary: "Ann offers Bo a Ruby", characterName: "Bo", withdrawnBy: "Ann" }), "Ann withdrew the offer: Ann offers Bo a Ruby. Nothing changed.");
  assert.equal(resolutionNote({ status: "failed", summary: "Take Dart from Nysa", characterName: "Nysa", outcome: 'Nysa does not carry "Dart".' }), 'The offer "Take Dart from Nysa" could not be applied (Nysa does not carry "Dart"). Nothing changed.');
  assert.equal(resolutionNote({ status: "expired", summary: "Give Rope to Nysa", characterName: "Nysa" }), "The offer lapsed unanswered: Give Rope to Nysa. Nothing changed.");
  assert.ok(OFFER_NOTE_PREFIX.startsWith("["));
});

check("the game state's offers block: what waits, what was settled and how; nothing when there is nothing", () => {
  assert.equal(renderOffersBlock([]), "");
  const block = renderOffersBlock([
    { summary: "Give Rope to Nysa", characterName: "Nysa", status: "pending", outcome: "", minutesAgo: null },
    { summary: "Give Coin purse to Nysa", characterName: "Nysa", status: "approved", outcome: "Nysa now carries Coin purse.", minutesAgo: 2 },
    { summary: "Take Dart x10 from Nysa", characterName: "Nysa", status: "declined", outcome: "", minutesAgo: 0 },
    { summary: "Take Dart from Nysa", characterName: "Nysa", status: offerLineStatus("declined", 'failed: Nysa does not carry "Dart".'), outcome: 'failed: Nysa does not carry "Dart".', minutesAgo: 5 },
    { summary: "Give Lantern to Nysa", characterName: "Nysa", status: "cancelled", outcome: "", minutesAgo: 9 },
  ]);
  assert.match(block, /^Offers to players/);
  assert.match(block, /WAITING on Nysa's player: Give Rope to Nysa\. Do not offer it again/);
  assert.match(block, /ACCEPTED 2 min ago and applied: Give Coin purse to Nysa\. Nysa now carries Coin purse\. Already settled/);
  assert.match(block, /DECLINED just now: Take Dart x10 from Nysa\. Nothing changed/);
  assert.match(block, /COULD NOT BE APPLIED 5 min ago: Take Dart from Nysa \(Nysa does not carry "Dart"\)/);
  assert.match(block, /WITHDRAWN by the lead 9 min ago: Give Lantern to Nysa/);
  assert.equal(offerLineStatus("declined", ""), "declined");
  assert.equal(offerLineStatus("approved", "Nysa now carries Rope."), "approved");
});

console.log(`test-item-proposals (settling): ${settled} tests passed`);
