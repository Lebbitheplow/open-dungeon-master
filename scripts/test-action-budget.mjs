// The 5e action economy: what a combatant has left to spend on their turn.
import assert from "node:assert/strict";
import {
  attacksLeft,
  budgetApplies,
  claimOncePerTurn,
  describeBudget,
  freshBudget,
  spendAction,
  spendAttack,
} from "../src/lib/dm/action-budget.ts";

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

const make = (attacksAllowed = 1) =>
  freshBudget({ ownerId: "char-1", round: 1, attacksAllowed });

test("a fresh budget has everything available", () => {
  const budget = make();
  assert.equal(budget.actionUsed, false);
  assert.equal(budget.bonusUsed, false);
  assert.equal(budget.reactionUsed, false);
  assert.equal(attacksLeft(budget), 1);
  assert.equal(budget.dashed, false);
  assert.equal(budget.disengaged, false);
});

test("a budget only binds its own owner and round", () => {
  const budget = make();
  assert.equal(budgetApplies(budget, "char-1", 1), true);
  assert.equal(budgetApplies(budget, "char-2", 1), false);
  assert.equal(budgetApplies(budget, "char-1", 2), false);
  assert.equal(budgetApplies(null, "char-1", 1), false);
});

test("each slot is spent once", () => {
  let budget = make();
  for (const kind of ["action", "bonus", "reaction"]) {
    const first = spendAction(budget, kind, "something", "Vex");
    assert.equal(first.ok, true, kind);
    budget = first.budget;
    const second = spendAction(budget, kind, "something", "Vex");
    assert.equal(second.ok, false, kind);
    assert.match(second.error, /Vex/);
  }
});

test("the refusal says what is gone and what is left", () => {
  const spent = spendAction(make(), "action", "Dodge", "Vex").budget;
  const refused = spendAction(spent, "action", "Dash", "Vex");
  assert.equal(refused.ok, false);
  assert.match(refused.error, /already used their action/);
  // The bonus action is still there, so the refusal offers it.
  assert.match(refused.error, /bonus action/);
});

test("the first attack spends the action, Extra Attack pays for the rest", () => {
  let budget = make(2);
  const first = spendAttack(budget, "Grog");
  assert.equal(first.ok, true);
  budget = first.budget;
  assert.equal(budget.actionUsed, true);
  assert.equal(attacksLeft(budget), 1);

  const second = spendAttack(budget, "Grog");
  assert.equal(second.ok, true);
  budget = second.budget;
  assert.equal(attacksLeft(budget), 0);

  const third = spendAttack(budget, "Grog");
  assert.equal(third.ok, false);
  assert.match(third.error, /all 2 of their attacks/);
});

test("a wizard who dodged cannot then attack", () => {
  const dodged = spendAction(make(), "action", "Dodge", "Pike").budget;
  const attack = spendAttack(dodged, "Pike");
  assert.equal(attack.ok, false);
  assert.match(attack.error, /already used their action/);
});

test("a single-attack character gets exactly one swing", () => {
  const budget = spendAttack(make(), "Pike").budget;
  const second = spendAttack(budget, "Pike");
  assert.equal(second.ok, false);
  assert.match(second.error, /all 1 of their attack\b/);
});

test("once-per-turn riders are claimed once", () => {
  const budget = make();
  const claimed = claimOncePerTurn(budget, "sneak_attack");
  assert.notEqual(claimed, null);
  assert.deepEqual(claimed.oncePerTurn, ["sneak_attack"]);
  assert.equal(claimOncePerTurn(claimed, "sneak_attack"), null);
  // A different rider is independent.
  assert.notEqual(claimOncePerTurn(claimed, "divine_smite"), null);
});

test("the summary names what is left, for the DM prompt", () => {
  assert.match(describeBudget(make()), /action.*bonus action.*reaction/);
  let budget = make(2);
  budget = spendAttack(budget, "Grog").budget;
  assert.match(describeBudget(budget), /1 attack left/);
  budget = spendAttack(budget, "Grog").budget;
  budget = spendAction(budget, "bonus", "x", "Grog").budget;
  budget = spendAction(budget, "reaction", "x", "Grog").budget;
  assert.equal(describeBudget(budget), "has nothing left to spend");
  assert.match(describeBudget({ ...make(), dashed: true }), /Dash/);
  assert.match(describeBudget({ ...make(), disengaged: true }), /disengaged/);
});

console.log(`test-action-budget: ${passed} passed`);
