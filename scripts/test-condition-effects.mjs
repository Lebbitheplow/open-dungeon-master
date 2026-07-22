// The condition-effects registry: buff/effect conditions resolve to typed
// riders, the aggregators fold them correctly, and every row is well-formed.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const {
  CONDITION_EFFECTS,
  activeConditionEffects,
  conditionAcRiders,
  conditionBlocksReactions,
  conditionConcentrationFloor,
  conditionEffectsFor,
  conditionExtraActions,
  conditionIncomingAttackState,
  conditionOnHitDice,
  conditionResistances,
  conditionRollRiders,
  conditionSpeed,
  describeConditionEffects,
  grantedAttackDice,
  grantedAttackFor,
} = await import("../src/lib/srd/condition-effects.ts");
const { isValidExpression } = await import("../src/lib/dice.ts");
const { attackContext, effectiveSpeed, pcResistances } = await import(
  "../src/lib/dm/condition-logic.ts"
);
const { acBreakdownFor } = await import("../src/lib/srd/index.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

test("every row is well-formed", () => {
  const ids = new Set();
  for (const row of CONDITION_EFFECTS) {
    assert.ok(row.id && !ids.has(row.id), `duplicate or missing id: ${row.id}`);
    ids.add(row.id);
    assert.ok(row.match.length > 0, `${row.id} has no match terms`);
    for (const term of row.match) {
      assert.equal(term, term.toLowerCase().trim(), `${row.id} term not normalized: "${term}"`);
    }
    assert.ok(row.summary.length > 10, `${row.id} has no usable summary`);
    for (const die of [row.attackDie, row.saveDie, row.attackPenaltyDie, row.savePenaltyDie, row.checkDie]) {
      if (die) {
        assert.ok(isValidExpression(die), `${row.id} carries an invalid die: ${die}`);
      }
    }
    if (row.onHitDice) {
      assert.ok(
        isValidExpression(row.onHitDice.dice.replace(/^-/, "")),
        `${row.id} onHitDice invalid: ${row.onHitDice.dice}`,
      );
    }
    if (row.grantedAttack) {
      assert.ok(row.grantedAttack.diceByLevel.length > 0, `${row.id} granted attack has no dice`);
      for (const [level, dice] of row.grantedAttack.diceByLevel) {
        assert.ok(level >= 1 && level <= 20, `${row.id} dice level out of range`);
        assert.ok(isValidExpression(dice), `${row.id} granted dice invalid: ${dice}`);
      }
    }
  }
});

test("lookup matches exact, parameterized, and unknown names", () => {
  assert.equal(conditionEffectsFor("blessed").id, "blessed");
  assert.equal(conditionEffectsFor("Bless").id, "blessed");
  assert.equal(conditionEffectsFor("hunter's mark (the goblin)").id, "hunters_mark");
  assert.equal(conditionEffectsFor("poisoned"), null);
  assert.equal(conditionEffectsFor(""), null);
  // A registry name never shadows an SRD condition handled in condition-logic.
  for (const srd of ["prone", "restrained", "poisoned", "blinded", "frightened", "invisible", "unconscious"]) {
    assert.equal(conditionEffectsFor(srd), null, `${srd} must stay in condition-logic`);
  }
});

test("bless adds its die to attacks and saves, not checks", () => {
  const attack = conditionRollRiders(["blessed"], "attack");
  assert.equal(attack.diceSuffix, "+1d4");
  const save = conditionRollRiders(["blessed"], "save", "con");
  assert.equal(save.diceSuffix, "+1d4");
  const check = conditionRollRiders(["blessed"], "check");
  assert.equal(check.diceSuffix, "");
  assert.equal(attack.spent.length, 0);
});

test("bane subtracts, and stacks with bless into one suffix", () => {
  const both = conditionRollRiders(["blessed", "baned"], "attack");
  assert.equal(both.diceSuffix, "+1d4-1d4");
});

test("guidance is a one-shot check die", () => {
  const check = conditionRollRiders(["guidance"], "check");
  assert.equal(check.diceSuffix, "+1d4");
  assert.deepEqual(check.spent, ["guidance"]);
  const save = conditionRollRiders(["guidance"], "save", "dex");
  assert.equal(save.diceSuffix, "");
  assert.equal(save.spent.length, 0);
});

test("true strike grants one-shot attack advantage", () => {
  const attack = conditionRollRiders(["true strike"], "attack");
  assert.deepEqual(attack.advantageSources, ["advantage"]);
  assert.deepEqual(attack.spent, ["true strike"]);
});

test("haste: DEX-save advantage, speed x2, extra action, +2 AC", () => {
  const save = conditionRollRiders(["hasted"], "save", "dex");
  assert.deepEqual(save.advantageSources, ["advantage"]);
  const conSave = conditionRollRiders(["hasted"], "save", "con");
  assert.equal(conSave.advantageSources.length, 0);
  assert.equal(conditionSpeed(["hasted"], 30), 60);
  assert.equal(conditionExtraActions(["hasted"]), 1);
  assert.equal(conditionAcRiders(["hasted"]).bonus, 2);
});

test("slow: -2 AC, -2 DEX saves, half speed, no reactions", () => {
  const save = conditionRollRiders(["slowed"], "save", "dex");
  assert.equal(save.diceSuffix, "-2");
  const strSave = conditionRollRiders(["slowed"], "save", "str");
  assert.equal(strSave.diceSuffix, "");
  assert.equal(conditionAcRiders(["slowed"]).bonus, -2);
  assert.equal(conditionSpeed(["slowed"], 30), 15);
  assert.equal(conditionBlocksReactions(["slowed"]), "slowed");
  assert.equal(conditionBlocksReactions(["blessed"]), null);
});

test("AC riders: shield of faith, shield, mage armor, barkskin", () => {
  assert.equal(conditionAcRiders(["shield of faith"]).bonus, 2);
  assert.equal(conditionAcRiders(["shielded"]).bonus, 5);
  const mage = conditionAcRiders(["mage armor"]);
  assert.equal(mage.base, 13);
  assert.equal(mage.baseSource, "mage armor");
  assert.equal(conditionAcRiders(["barkskin"]).floor, 16);
  const stacked = conditionAcRiders(["shield of faith", "shielded"]);
  assert.equal(stacked.bonus, 7);
});

test("acBreakdownFor folds condition AC riders into the derived AC", () => {
  const base = {
    class: "wizard",
    abilities: { str: 10, dex: 14, con: 10, int: 16, wis: 10, cha: 10 },
    proficiencies: { armor: [] },
    equipment: [],
    features: [],
    level: 3,
  };
  const bare = acBreakdownFor(base);
  assert.equal(bare.ac, 12);
  const mage = acBreakdownFor({ ...base, conditions: ["mage armor"] });
  assert.equal(mage.ac, 15);
  const shielded = acBreakdownFor({ ...base, conditions: ["mage armor", "shielded"] });
  assert.equal(shielded.ac, 20);
  const bark = acBreakdownFor({ ...base, conditions: ["barkskin"] });
  assert.equal(bark.ac, 16);
  // Barkskin never lowers a better AC.
  const barkAndMage = acBreakdownFor({ ...base, conditions: ["mage armor", "shielded", "barkskin"] });
  assert.equal(barkAndMage.ac, 20);
});

test("blade ward and stoneskin grant resistances through pcResistances", () => {
  assert.deepEqual(conditionResistances(["blade ward"]), ["bludgeoning", "piercing", "slashing"]);
  const resist = pcResistances({
    race: "human",
    features: [],
    conditions: ["stoneskin"],
    equipment: [],
  });
  assert.ok(resist.includes("slashing"));
});

test("blur imposes disadvantage on incoming attacks via attackContext", () => {
  const incoming = conditionIncomingAttackState(["blurred"]);
  assert.deepEqual(incoming.sources, ["disadvantage"]);
  const context = attackContext({
    attackerConditions: [],
    targetConditions: ["blurred"],
    melee: true,
    adjacent: true,
    requested: "none",
  });
  assert.equal(context.advantage, "disadvantage");
});

test("faerie fire grants advantage on incoming attacks", () => {
  const context = attackContext({
    attackerConditions: [],
    targetConditions: ["faerie fire"],
    melee: true,
    adjacent: true,
    requested: "none",
  });
  assert.equal(context.advantage, "advantage");
});

test("on-hit dice: divine favor adds, reduced subtracts", () => {
  assert.equal(conditionOnHitDice(["divine favor"]).suffix, "+1d4");
  assert.equal(conditionOnHitDice(["reduced"]).suffix, "-1d4");
  assert.equal(conditionOnHitDice(["divine favor", "hunter's mark (wolf)"]).suffix, "+1d4+1d6");
});

test("enlarged: advantage on STR saves and checks plus the damage die", () => {
  const save = conditionRollRiders(["enlarged"], "save", "str");
  assert.deepEqual(save.advantageSources, ["advantage"]);
  const check = conditionRollRiders(["enlarged"], "check", "str");
  assert.deepEqual(check.advantageSources, ["advantage"]);
  const dexSave = conditionRollRiders(["enlarged"], "save", "dex");
  assert.equal(dexSave.advantageSources.length, 0);
});

test("granted attacks: starry form archer resolves with leveled dice", () => {
  const found = grantedAttackFor(["starry form: archer"], "Starry Form: Archer");
  assert.ok(found);
  assert.equal(found.attack.type, "radiant");
  assert.ok(found.attack.bonusAction);
  assert.equal(grantedAttackDice(found.attack, 2), "1d8");
  assert.equal(grantedAttackDice(found.attack, 10), "2d8");
  // Loose lookup: the model may just say "archer" or "starry form".
  assert.ok(grantedAttackFor(["starry form: archer"], "starry form"));
  assert.equal(grantedAttackFor(["starry form: archer"], "longsword"), null);
  assert.equal(grantedAttackFor([], "starry form"), null);
});

test("spiritual weapon is a melee bonus-action granted attack", () => {
  const found = grantedAttackFor(["spiritual weapon"], "spiritual weapon");
  assert.ok(found);
  assert.equal(found.attack.ranged, false);
  assert.ok(found.attack.bonusAction);
});

test("concentration floor comes from starry form dragon", () => {
  assert.equal(conditionConcentrationFloor(["starry form: dragon"]), 10);
  assert.equal(conditionConcentrationFloor(["starry form: archer"]), 0);
});

test("effectiveSpeed folds riders but hard zeroes still win", () => {
  assert.equal(effectiveSpeed(["hasted"], 30), 60);
  assert.equal(effectiveSpeed(["longstrider"], 30), 40);
  assert.equal(effectiveSpeed(["hasted", "grappled"], 30), 0);
});

test("summaries surface for the prompt", () => {
  const lines = describeConditionEffects(["blessed", "poisoned", "barkskin"]);
  assert.equal(lines.length, 2);
  assert.ok(lines[0].startsWith("Bless"));
});

test("activeConditionEffects keeps the sheet's exact condition string", () => {
  const active = activeConditionEffects(["Hunter's Mark (dire wolf)"]);
  assert.equal(active.length, 1);
  assert.equal(active[0].condition, "Hunter's Mark (dire wolf)");
});

console.log(`test-condition-effects: ${passed} tests passed`);
