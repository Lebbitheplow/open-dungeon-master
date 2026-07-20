// Pure condition mechanics: effect matrix, advantage merging, durations,
// save-ends bookkeeping, and resistance damage math.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const {
  attackContext,
  damageAdjust,
  effectiveSpeed,
  incapacitatedBy,
  isIncapacitated,
  mergeAdvantage,
  pcResistances,
  pruneMeta,
  removeConditions,
  rollDerivation,
  tickConditions,
} = await import("../src/lib/dm/condition-logic.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

test("mergeAdvantage cancels 5e-style", () => {
  assert.equal(mergeAdvantage(["advantage", "disadvantage", "advantage"]), "none");
  assert.equal(mergeAdvantage(["advantage", "none"]), "advantage");
  assert.equal(mergeAdvantage(["none", "disadvantage"]), "disadvantage");
  assert.equal(mergeAdvantage([]), "none");
});

test("incapacitation detection", () => {
  assert.equal(isIncapacitated(["stunned"]), true);
  assert.equal(isIncapacitated(["Paralyzed"]), true);
  assert.equal(incapacitatedBy(["prone", "unconscious"]), "unconscious");
  assert.equal(isIncapacitated(["prone", "poisoned"]), false);
});

test("effectiveSpeed zeroes for grappled/restrained/incapacitating", () => {
  assert.equal(effectiveSpeed(["grappled"], 30), 0);
  assert.equal(effectiveSpeed(["restrained"], 30), 0);
  assert.equal(effectiveSpeed(["stunned"], 30), 0);
  assert.equal(effectiveSpeed(["prone", "poisoned"], 30), 30);
});

test("attackContext: prone target adv adjacent, dis at range", () => {
  const close = attackContext({
    attackerConditions: [],
    targetConditions: ["prone"],
    melee: true,
    adjacent: true,
    requested: "none",
  });
  assert.equal(close.advantage, "advantage");
  const far = attackContext({
    attackerConditions: [],
    targetConditions: ["prone"],
    melee: false,
    adjacent: false,
    requested: "none",
  });
  assert.equal(far.advantage, "disadvantage");
});

test("attackContext: poisoned attacker cancels restrained target", () => {
  const context = attackContext({
    attackerConditions: ["poisoned"],
    targetConditions: ["restrained"],
    melee: true,
    adjacent: true,
    requested: "none",
  });
  assert.equal(context.advantage, "none");
  assert.equal(context.notes.length, 2);
});

test("attackContext: paralyzed target auto-crits in melee only", () => {
  const melee = attackContext({
    attackerConditions: [],
    targetConditions: ["paralyzed"],
    melee: true,
    adjacent: true,
    requested: "none",
  });
  assert.equal(melee.autoCrit, true);
  assert.equal(melee.advantage, "advantage");
  const ranged = attackContext({
    attackerConditions: [],
    targetConditions: ["paralyzed"],
    melee: false,
    adjacent: false,
    requested: "none",
  });
  assert.equal(ranged.autoCrit, false);
  assert.equal(ranged.advantage, "advantage");
});

test("attackContext: invisible cuts both ways; model claim merges", () => {
  const context = attackContext({
    attackerConditions: ["invisible"],
    targetConditions: [],
    melee: true,
    adjacent: true,
    requested: "disadvantage",
  });
  assert.equal(context.advantage, "none");
});

test("rollDerivation: paralyzed auto-fails STR/DEX saves only", () => {
  assert.equal(rollDerivation(["paralyzed"], "saving_throw", "dex").autoFail, true);
  assert.equal(rollDerivation(["paralyzed"], "saving_throw", "wis").autoFail, false);
  assert.equal(rollDerivation(["paralyzed"], "skill_check").autoFail, false);
});

test("rollDerivation: restrained DEX-save dis, poisoned check dis", () => {
  assert.equal(rollDerivation(["restrained"], "saving_throw", "dex").advantage, "disadvantage");
  assert.equal(rollDerivation(["restrained"], "saving_throw", "con").advantage, "none");
  assert.equal(rollDerivation(["poisoned"], "skill_check").advantage, "disadvantage");
  assert.equal(rollDerivation(["poisoned"], "saving_throw", "con").advantage, "none");
});

test("tickConditions: rounds count down and expire", () => {
  const one = tickConditions(["stunned", "prone"], { stunned: { rounds: 2 } });
  assert.deepEqual(one.conditions, ["stunned", "prone"]);
  assert.equal(one.meta.stunned.rounds, 1);
  assert.deepEqual(one.expired, []);
  const two = tickConditions(one.conditions, one.meta);
  assert.deepEqual(two.conditions, ["prone"]);
  assert.deepEqual(two.expired, ["stunned"]);
  assert.equal(two.meta.stunned, undefined);
});

test("tickConditions: untimed conditions persist untouched", () => {
  const tick = tickConditions(["prone"], {});
  assert.deepEqual(tick.conditions, ["prone"]);
  assert.deepEqual(tick.savesDue, []);
});

test("tickConditions: save-ends surfaces due saves each round", () => {
  const meta = { paralyzed: { saveEnds: { ability: "wis", dc: 14 } } };
  const tick = tickConditions(["paralyzed"], meta);
  assert.deepEqual(tick.savesDue, [{ name: "paralyzed", ability: "wis", dc: 14 }]);
  assert.deepEqual(tick.conditions, ["paralyzed"]);
});

test("removeConditions strips names and metadata together", () => {
  const out = removeConditions(
    ["paralyzed", "prone"],
    { paralyzed: { saveEnds: { ability: "wis", dc: 14 } } },
    ["Paralyzed"],
  );
  assert.deepEqual(out.conditions, ["prone"]);
  assert.deepEqual(out.meta, {});
});

test("pruneMeta drops orphaned entries", () => {
  assert.deepEqual(pruneMeta(["prone"], { stunned: { rounds: 3 }, prone: { rounds: 1 } }), {
    prone: { rounds: 1 },
  });
});

test("damageAdjust: immunity zeroes, resistance halves, vulnerability doubles", () => {
  assert.equal(damageAdjust(10, "fire", "", "fire", "").amount, 0);
  assert.equal(damageAdjust(11, "fire", "fire; cold", "", "").amount, 5);
  assert.equal(damageAdjust(10, "cold", "", "", "cold").amount, 20);
  assert.equal(damageAdjust(10, "fire", "fire", "", "fire").amount, 10);
  assert.equal(damageAdjust(10, "", "fire", "", "").amount, 10);
  assert.equal(damageAdjust(10, "radiant", "fire", "poison", "").amount, 10);
});

test("damageAdjust: nonmagical-attacks substring matches base types", () => {
  const resist = "bludgeoning, piercing, and slashing from nonmagical attacks";
  assert.equal(damageAdjust(9, "slashing", resist, "", "").amount, 4);
  assert.equal(damageAdjust(9, "fire", resist, "", "").amount, 9);
});

test("damageAdjust floors resistance at 1", () => {
  assert.equal(damageAdjust(1, "fire", "fire", "", "").amount, 1);
});

test("pcResistances: dwarf poison, tiefling fire, feature names", () => {
  assert.equal(pcResistances({ race: "hill_dwarf", features: [] }), "poison");
  assert.equal(pcResistances({ race: "tiefling", features: [] }), "fire");
  assert.equal(
    pcResistances({ race: "human", features: [{ name: "Hellish Resistance" }] }),
    "fire",
  );
  assert.equal(pcResistances({ race: "human", features: [] }), "");
});

test("raging grants resistance to the three physical damage types", () => {
  const resist = pcResistances({ race: "human", features: [], conditions: ["raging"] });
  assert.equal(damageAdjust(13, "slashing", resist, "", "").amount, 6);
  assert.equal(damageAdjust(13, "piercing", resist, "", "").amount, 6);
  assert.equal(damageAdjust(13, "bludgeoning", resist, "", "").amount, 6);
  // Rage does nothing against fire, and ends with the condition.
  assert.equal(damageAdjust(13, "fire", resist, "", "").amount, 13);
  assert.equal(
    damageAdjust(13, "slashing", pcResistances({ race: "human", features: [], conditions: [] }), "", "")
      .amount,
    13,
  );
});

test("raging grants advantage on Strength checks and saves only", () => {
  assert.equal(rollDerivation(["raging"], "saving_throw", "str").advantage, "advantage");
  assert.equal(rollDerivation(["raging"], "ability_check", "str").advantage, "advantage");
  assert.equal(rollDerivation(["raging"], "skill_check", "str").advantage, "advantage");
  assert.equal(rollDerivation(["raging"], "saving_throw", "dex").advantage, "none");
  assert.equal(rollDerivation(["raging"], "initiative", "str").advantage, "none");
});

test("raging cancels against a disadvantage source, 5e-style", () => {
  assert.equal(rollDerivation(["raging", "poisoned"], "ability_check", "str").advantage, "none");
});

console.log(`test-condition-logic: ${passed} tests passed`);
