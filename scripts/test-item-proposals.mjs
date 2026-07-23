// Inventory-approval logic: which mutations become proposals, the approval
// bar summary, expiry, and who may resolve.
import assert from "node:assert/strict";
import {
  canResolveProposal,
  proposalExpired,
  proposalSummary,
  PROPOSAL_TOOL_NAMES,
  shouldProposeItemChange,
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

test("companions and missing targets stay auto-applied", () => {
  assert.ok(!shouldProposeItemChange(true, "grant_item", { isCompanion: true }));
  assert.ok(!shouldProposeItemChange(true, "grant_item", null));
});

test("proposalSummary phrasings", () => {
  assert.equal(
    proposalSummary("grant_item", { name: "Healing Potion", qty: 2 }, "Avery"),
    "Give Healing Potion x2 to Avery",
  );
  assert.equal(
    proposalSummary("remove_item", { name: "Rope" }, "Avery"),
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
