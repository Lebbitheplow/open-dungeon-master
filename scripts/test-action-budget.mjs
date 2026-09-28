// The 5e action economy: what a combatant has left to spend on their turn.
import assert from "node:assert/strict";
import {
  attacksLeft,
  budgetApplies,
  claimOncePerTurn,
  describeBudget,
  freshBudget,
  grantAction,
  spendAction,
  spendAttack,
  spendCastAttack,
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

test("Haste's extra action is one weapon attack, Dash, Disengage, Hide or Use an Object", () => {
  const hasted = () => {
    const budget = freshBudget({ ownerId: "char-1", round: 1, attacksAllowed: 1, extraActions: 1 });
    return spendAction(budget, "action", "dash", "Grog").budget;
  };
  for (const allowed of ["dash", "disengage", "hide", "use an object"]) {
    const spent = spendAction(hasted(), "action", allowed, "Grog");
    assert.equal(spent.ok, true, allowed);
    assert.equal(spent.budget.extraActions, 0, allowed);
  }
  for (const refused of ["dodge", "help", "grapple", "shove", "casting Fire Bolt"]) {
    const spent = spendAction(hasted(), "action", refused, "Grog");
    assert.equal(spent.ok, false, refused);
    assert.match(spent.error, /Haste/);
  }
  assert.equal(spendAttack(hasted(), "Grog").ok, true);
});

test("Action Surge grants a whole action: another Attack action, or anything else", () => {
  let budget = make(2);
  budget = spendAttack(budget, "Grog").budget;
  budget = spendAttack(budget, "Grog").budget;
  assert.equal(spendAttack(budget, "Grog").ok, false);
  budget = grantAction(budget);
  assert.equal(budget.grantedActions, 1);
  assert.match(describeBudget(budget), /Action Surge/);
  // Both swings of Extra Attack again, and then no more.
  const third = spendAttack(budget, "Grog");
  assert.equal(third.ok, true);
  assert.equal(third.budget.grantedActions, 0);
  assert.equal(attacksLeft(third.budget), 1);
  const fourth = spendAttack(third.budget, "Grog");
  assert.equal(fourth.ok, true);
  assert.equal(spendAttack(fourth.budget, "Grog").ok, false);
  // Or a Dodge, which Haste would not buy.
  const dodge = spendAction(grantAction(budget), "action", "dodge", "Grog");
  assert.equal(dodge.ok, true);
  assert.equal(dodge.budget.grantedActions, 1);
});

test("a granted action reloads a loading weapon", () => {
  let budget = { ...make(2), loadingFired: ["heavy crossbow"] };
  budget = spendAttack(budget, "Grog").budget;
  budget = spendAttack(budget, "Grog").budget;
  const surged = spendAttack(grantAction(budget), "Grog");
  assert.deepEqual(surged.budget.loadingFired, []);
});

test("an attack-roll spell is the whole action, never one swing of Extra Attack", () => {
  const cast = spendCastAttack(make(2), "Fire Bolt", "Grog");
  assert.equal(cast.ok, true);
  assert.equal(cast.budget.actionUsed, true);
  assert.equal(attacksLeft(cast.budget), 0);
  assert.equal(spendCastAttack(cast.budget, "Fire Bolt", "Grog").ok, false);
  assert.equal(spendAttack(cast.budget, "Grog").ok, false);
  // After a swing the action is the Attack action's, and no spell fits in it.
  const swung = spendAttack(make(2), "Grog").budget;
  assert.equal(spendCastAttack(swung, "Fire Bolt", "Grog").ok, false);
  // Action Surge buys a second casting.
  const surged = spendCastAttack(grantAction(cast.budget), "Fire Bolt", "Grog");
  assert.equal(surged.ok, true);
  assert.equal(surged.budget.grantedActions, 0);
});

console.log(`test-action-budget: ${passed} passed`);
