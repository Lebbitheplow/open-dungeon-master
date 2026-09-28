// Ability scores and every number derived from them.
//
// SRD 5.1: a score's modifier is (score - 10) / 2 rounded down, from -5 at 1
// to +10 at 30. The proficiency bonus is +2 at levels 1 to 4 and rises by one
// every four levels to +6. A skill or save bonus is the ability's modifier,
// plus the proficiency bonus when proficient, plus it twice with expertise.
// Passive Perception is 10 + the Perception bonus, initiative is a Dexterity
// check, a spell save DC is 8 + proficiency + the casting modifier and a
// spell attack is proficiency + that modifier.
//
// Scores come from one of three methods: the standard array (15, 14, 13, 12,
// 10, 8), a 27-point buy of scores from 8 to 15 (0, 1, 2, 3, 4, 5, 7 and 9
// points), or 4d6 drop the lowest, six times. The race's bonus is added
// after, and an ability score improvement never takes a score past 20.
//
// The expected numbers below are written out from the rulebook, not read
// from src/lib/srd. What the ROUTES accept is another file's question
// (test-enforce-creation-routes.mjs); this one holds the arithmetic and the
// builder's own gate (src/app/characters/builder/submit.ts).
//
// ODM's own rules, pinned: rolled scores are a pool of six placed freely, and
// the pool may be rerolled only while it totals under 70
// (builder/abilityDice.ts); SRD 5.1 has no reroll rule at all.
import assert from "node:assert/strict";
import { register } from "node:module";
import { suite, abilityMod, proficiencyBonus } from "./lib/enforce-harness.mjs";

register("./lib/register-alias.mjs", import.meta.url);

const { openBuilder, STANDARD_ARRAY } = await import("./lib/enforce-builder.mjs");
const srd = await import("../src/lib/srd/index.ts");
const pointBuy = await import("../src/lib/srd/point-buy.ts");
const dice = await import("../src/app/characters/builder/abilityDice.ts");

const { test, finish } = suite("test-enforce-abilities");
const builder = await openBuilder();

// SRD 5.1, "Ability Scores and Modifiers".
const MODIFIERS = [
  -5, -4, -4, -3, -3, -2, -2, -1, -1, 0, 0, 1, 1, 2, 2,
  3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10,
];
// SRD 5.1, "Character Advancement".
const PROFICIENCY = [2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 6, 6, 6, 6];
// SRD 5.1, "Variant: Customizing Ability Scores".
const POINT_COST = { 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9 };
// SRD 5.1, the skills and the ability each is a check of.
const SKILLS = {
  athletics: "str",
  acrobatics: "dex", sleight_of_hand: "dex", stealth: "dex",
  arcana: "int", history: "int", investigation: "int", nature: "int", religion: "int",
  animal_handling: "wis", insight: "wis", medicine: "wis", perception: "wis", survival: "wis",
  deception: "cha", intimidation: "cha", performance: "cha", persuasion: "cha",
};

const ABILITIES = ["str", "dex", "con", "int", "wis", "cha"];
const SCORES = { str: 8, dex: 14, con: 13, int: 10, wis: 15, cha: 20 };
const fighter = (fields = {}) => ({
  race: "human",
  class: "fighter",
  background: "soldier",
  chosenSkills: ["perception", "survival"],
  bonusLanguages: ["Dwarvish"],
  stylePicks: ["defense"],
  ...fields,
});

await test("the modifier of every score from 1 to 30", () => {
  assert.equal(MODIFIERS.length, 30);
  for (let score = 1; score <= 30; score += 1) {
    assert.equal(srd.abilityMod(score), MODIFIERS[score - 1], `score ${score}`);
    assert.equal(abilityMod(score), MODIFIERS[score - 1], `harness, score ${score}`);
    const derived = srd.computeSheetDerived({
      abilities: { str: score, dex: score, con: score, int: score, wis: score, cha: score },
      level: 1,
      proficiencies: { saves: [], skills: [], expertise: [] },
      spellcasting: null,
    });
    for (const ability of ABILITIES) {
      assert.equal(derived.abilityMods[ability], MODIFIERS[score - 1], `${ability} ${score}`);
    }
  }
});

await test("the proficiency bonus at every level, and never outside the table", () => {
  for (let level = 1; level <= 20; level += 1) {
    assert.equal(srd.proficiencyBonus(level), PROFICIENCY[level - 1], `level ${level}`);
    assert.equal(proficiencyBonus(level), PROFICIENCY[level - 1], `harness, level ${level}`);
  }
  assert.equal(srd.proficiencyBonus(0), 2);
  assert.equal(srd.proficiencyBonus(-3), 2);
  assert.equal(srd.proficiencyBonus(21), 6);
  assert.equal(srd.proficiencyBonus(99), 6);
});

await test("point buy: the cost of each score, the budget, and the 8 to 15 range", () => {
  assert.equal(pointBuy.POINT_BUY_BUDGET, 27);
  assert.equal(pointBuy.POINT_BUY_MIN, 8);
  assert.equal(pointBuy.POINT_BUY_MAX, 15);
  for (const [score, cost] of Object.entries(POINT_COST)) {
    assert.equal(pointBuy.pointBuyCost(Number(score)), cost, `score ${score}`);
  }
  for (const outside of [7, 16, 3, 18, 0, 20, 8.5]) {
    assert.throws(() => pointBuy.pointBuyCost(outside), `score ${outside} has no cost`);
  }
  assert.equal(pointBuy.pointBuyRemaining([8, 8, 8, 8, 8, 8]), 27);
  assert.equal(pointBuy.pointBuyRemaining([15, 15, 15, 8, 8, 8]), 0);
  assert.equal(pointBuy.pointBuyRemaining([15, 15, 15, 9, 8, 8]), -1);
  // The standard array is itself a 27-point character.
  assert.equal(pointBuy.pointBuyTotal(STANDARD_ARRAY), 27);
});

await test("the builder refuses a point buy that is over budget, to the point", () => {
  const spent27 = builder.build(fighter({ method: "pointbuy", scores: { str: 15, dex: 15, con: 15, int: 8, wis: 8, cha: 8 } }));
  assert.equal(spent27.blocker, null);
  const spent28 = builder.build(fighter({ method: "pointbuy", scores: { str: 15, dex: 15, con: 15, int: 9, wis: 8, cha: 8 } }));
  assert.equal(spent28.blocker?.kind, "error");
  const spent54 = builder.build(fighter({ method: "pointbuy", scores: { str: 15, dex: 15, con: 15, int: 15, wis: 15, cha: 15 } }));
  assert.equal(spent54.blocker?.kind, "error");
});

await test("the builder never passes a point-buy score outside 8 to 15", () => {
  for (const outside of [7, 16, 18, 3]) {
    let passed = false;
    try {
      const built = builder.build(fighter({ method: "pointbuy", scores: { str: outside, dex: 8, con: 8, int: 8, wis: 8, cha: 8 } }));
      passed = built.blocker === null;
    } catch {
      // pointBuyCost throws on a score it has no cost for, which stops the
      // submit just as a message would.
    }
    assert.equal(passed, false, `a point-buy ${outside} went through`);
  }
});

await test("the builder refuses a character with a score still unassigned", () => {
  const built = builder.build(fighter({ scores: { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: null } }));
  assert.equal(built.blocker?.kind, "error");
  assert.equal(built.sheet, null);
});

await test("4d6 drop the lowest: every total is 3 to 18 and the pool is six", () => {
  const faces = (list) => {
    let index = 0;
    // The builder's die is 1 + floor(rng * 6).
    return () => (list[index++ % list.length] - 1) / 6 + 0.01;
  };
  assert.equal(dice.rollFourDice(faces([1, 1, 1, 1])).total, 3);
  assert.equal(dice.rollFourDice(faces([6, 6, 6, 6])).total, 18);
  assert.equal(dice.rollFourDice(faces([6, 6, 6, 1])).total, 18);
  assert.equal(dice.rollFourDice(faces([2, 5, 3, 4])).total, 12);
  assert.equal(dice.rollPool(faces([3, 4, 5, 6])).length, 6);
  // ODM's rule, not the SRD's: a fresh six only when the pool is under 70.
  assert.equal(dice.REROLL_BELOW, 70);
  assert.equal(dice.canRerollPool([11, 11, 12, 12, 12, 11].map((total) => ({ total, roll: null }))), true);
  assert.equal(dice.canRerollPool([12, 12, 12, 12, 11, 11].map((total) => ({ total, roll: null }))), false);
});

await test("an improvement taken in the builder stops at 20", () => {
  // Mountain dwarf: STR +2, CON +2. A rolled 18 in each becomes 20.
  const base = { str: 18, dex: 10, con: 18, int: 10, wis: 10, cha: 10 };
  const built = builder.build(fighter({
    race: "mountain_dwarf",
    method: "roll",
    scores: base,
    level: 8,
    subclass: "Champion",
    bonusLanguages: [],
    racialTool: "smith's tools",
    // A fighter of 8th level has improved three times: at 4th, 6th and 8th.
    asiChoices: [
      { mode: "plus2", ability: "str" },
      { mode: "plus1x2", abilities: ["con", "dex"] },
      { mode: "plus2", ability: "con" },
    ],
  }));
  assert.equal(built.blocker, null);
  assert.deepEqual(built.sheet.abilities, { str: 20, dex: 11, con: 20, int: 10, wis: 10, cha: 10 });
  assert.equal(built.level, 8);
});

await test("the builder asks for every improvement the level has earned, and no more", () => {
  // SRD 5.1: every class improves at 4, 8, 12, 16 and 19; a fighter also at
  // 6 and 14, a rogue also at 10.
  const EARNED = {
    wizard: { 1: 0, 3: 0, 4: 1, 7: 1, 8: 2, 12: 3, 16: 4, 18: 4, 19: 5, 20: 5 },
    fighter: { 1: 0, 3: 0, 4: 1, 5: 1, 6: 2, 8: 3, 12: 4, 14: 5, 16: 6, 19: 7, 20: 7 },
    rogue: { 1: 0, 4: 1, 8: 2, 9: 2, 10: 3, 12: 4, 16: 5, 19: 6, 20: 6 },
  };
  for (const [classId, earned] of Object.entries(EARNED)) {
    for (const [level, count] of Object.entries(earned)) {
      // The picks each class needs to be let through are another test's;
      // this one reads the slots and the improvement gate alone.
      const built = builder.build(fighter({ class: classId, level: Number(level), subclass: "Champion", stylePicks: classId === "fighter" ? ["defense"] : [] }));
      assert.equal(built.derived.asiSlotLevels.length, count, `${classId} ${level}`);
      const gate = builder.submit.abilitiesBlocker(built.derived, built.state);
      assert.equal(gate === null, count === 0, `${classId} ${level} with no improvement chosen`);
    }
  }
});

await test("skills, saves, passive Perception and initiative at every level", () => {
  const proficiencies = {
    saves: ["dex", "wis"],
    skills: ["stealth", "perception", "arcana", "athletics"],
    expertise: ["stealth", "perception"],
  };
  for (let level = 1; level <= 20; level += 1) {
    const bonus = PROFICIENCY[level - 1];
    const derived = srd.computeSheetDerived({
      abilities: SCORES,
      level,
      proficiencies,
      spellcasting: { ability: "cha", slots: {}, prepared: [], known: [], cantrips: [] },
    });
    assert.equal(derived.proficiencyBonus, bonus);
    assert.equal(Object.keys(derived.skills).length, 18);
    for (const [skill, ability] of Object.entries(SKILLS)) {
      const trained = proficiencies.expertise.includes(skill) ? bonus * 2 : proficiencies.skills.includes(skill) ? bonus : 0;
      assert.equal(derived.skills[skill], MODIFIERS[SCORES[ability] - 1] + trained, `${skill} at level ${level}`);
    }
    for (const ability of ABILITIES) {
      const trained = proficiencies.saves.includes(ability) ? bonus : 0;
      assert.equal(derived.saves[ability], MODIFIERS[SCORES[ability] - 1] + trained, `${ability} save at level ${level}`);
    }
    // WIS 15 (+2) with expertise in Perception.
    assert.equal(derived.passivePerception, 10 + 2 + bonus * 2, `passive Perception at level ${level}`);
    // DEX 14.
    assert.equal(derived.initiative, 2, `initiative at level ${level}`);
    // CHA 20.
    assert.equal(derived.spellSaveDc, 8 + bonus + 5);
    assert.equal(derived.spellAttack, bonus + 5);
  }
});

await test("a low score is a penalty all the way through", () => {
  const derived = srd.computeSheetDerived({
    abilities: { str: 3, dex: 1, con: 6, int: 7, wis: 4, cha: 9 },
    level: 1,
    proficiencies: { saves: ["dex"], skills: ["perception"], expertise: [] },
    spellcasting: { ability: "wis", slots: {}, prepared: [], known: [], cantrips: [] },
  });
  assert.equal(derived.skills.athletics, -4);
  assert.equal(derived.saves.dex, -5 + 2);
  assert.equal(derived.initiative, -5);
  assert.equal(derived.passivePerception, 10 - 3 + 2);
  assert.equal(derived.spellSaveDc, 8 + 2 - 3);
  assert.equal(derived.spellAttack, 2 - 3);
  // Someone who casts nothing has no spell numbers at all.
  const mundane = srd.computeSheetDerived({
    abilities: SCORES, level: 1, proficiencies: { saves: [], skills: [], expertise: [] }, spellcasting: null,
  });
  assert.equal(mundane.spellSaveDc, null);
  assert.equal(mundane.spellAttack, null);
});

await test("Alert and Observant add 5; Jack of All Trades adds half proficiency, rounded down", () => {
  const sheet = (level, features, feats = []) => ({
    class: "bard",
    abilities: SCORES,
    level,
    proficiencies: { saves: [], skills: ["perception"], expertise: [] },
    spellcasting: null,
    features,
    feats,
  });
  const plain = srd.computeSheetDerived(sheet(1, []));
  const gifted = srd.computeSheetDerived(sheet(1, [], ["Alert", "Observant"]));
  assert.equal(gifted.initiative, plain.initiative + 5);
  assert.equal(gifted.passivePerception, plain.passivePerception + 5);
  for (let level = 2; level <= 20; level += 1) {
    const half = Math.floor(PROFICIENCY[level - 1] / 2);
    const derived = srd.computeSheetDerived(sheet(level, [{ name: "Jack of All Trades" }]));
    // Untrained skills and initiative gain it; a proficient skill does not.
    assert.equal(derived.skills.arcana, 0 + half, `Arcana at level ${level}`);
    assert.equal(derived.skills.athletics, -1 + half, `Athletics at level ${level}`);
    assert.equal(derived.initiative, 2 + half, `initiative at level ${level}`);
    assert.equal(derived.skills.perception, 2 + PROFICIENCY[level - 1], `Perception at level ${level}`);
    // Saving throws are not ability checks.
    assert.equal(derived.saves.dex, 2);
  }
});

await test("Remarkable Athlete adds half the proficiency bonus, ROUNDED UP, to Strength, Dexterity and Constitution checks that lack it (SRD 5.1, Champion, level 7).", () => {
  for (let level = 7; level <= 20; level += 1) {
    const derived = srd.computeSheetDerived({
      class: "fighter",
      abilities: SCORES,
      level,
      proficiencies: { saves: [], skills: [], expertise: [] },
      spellcasting: null,
      features: [{ name: "Remarkable Athlete" }],
      feats: [],
    });
    const half = Math.ceil(PROFICIENCY[level - 1] / 2);
    assert.equal(derived.skills.athletics, -1 + half, `Athletics at level ${level}`);
    assert.equal(derived.initiative, 2 + half, `initiative at level ${level}`);
    // Not Intelligence, Wisdom or Charisma.
    assert.equal(derived.skills.arcana, 0);
  }
});

await test("The standard array is the six numbers 15, 14, 13, 12, 10 and 8, each used once.", () => {
  const built = builder.build(fighter({ method: "standard", scores: { str: 15, dex: 15, con: 15, int: 15, wis: 15, cha: 15 } }));
  assert.notEqual(built.blocker, null, "six 15s passed as a standard array");
});

finish();
