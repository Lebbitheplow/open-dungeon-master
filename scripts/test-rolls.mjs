// request_roll expression resolution: sheet-derived modifiers, conditions
// that shape the d20, and the Bardic Inspiration die a character spends by
// rolling.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { resolveRollExpression } = await import("../src/lib/dm/rolls.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

// A level 5 barbarian: STR 18 (+4), DEX 12 (+1), proficient in Athletics
// and Strength saves (proficiency +3).
function sheet(overrides = {}) {
  return {
    id: "sheet-1",
    name: "Korgath",
    level: 5,
    abilities: { str: 18, dex: 12, con: 16, int: 8, wis: 10, cha: 10 },
    proficiencies: {
      saves: ["str", "con"],
      skills: ["athletics"],
      expertise: [],
      languages: [],
      tools: [],
      armor: [],
      weapons: [],
    },
    spellcasting: null,
    conditions: [],
    conditionMeta: {},
    exhaustion: 0,
    ...overrides,
  };
}

test("skill checks come off the sheet", () => {
  const resolved = resolveRollExpression({ kind: "skill_check", skill: "athletics" }, sheet());
  assert.equal(resolved.expression, "1d20+7");
  assert.equal(resolved.spendInspiration, undefined);
});

test("raging gives advantage on Athletics, a Strength skill", () => {
  const raging = sheet({ conditions: ["raging"] });
  assert.equal(
    resolveRollExpression({ kind: "skill_check", skill: "athletics" }, raging).expression,
    "2d20kh1+7",
  );
  // Stealth is Dexterity: rage does nothing for it.
  assert.equal(
    resolveRollExpression({ kind: "skill_check", skill: "stealth" }, raging).expression,
    "1d20+1",
  );
});

test("raging gives advantage on Strength saves but not Dexterity ones", () => {
  const raging = sheet({ conditions: ["raging"] });
  assert.equal(
    resolveRollExpression({ kind: "saving_throw", ability: "str" }, raging).expression,
    "2d20kh1+7",
  );
  assert.equal(
    resolveRollExpression({ kind: "saving_throw", ability: "dex" }, raging).expression,
    "1d20+1",
  );
});

test("a held inspiration die rides along and is reported as spent", () => {
  const inspired = sheet({ conditions: ["bardic inspiration (d8)"] });
  const resolved = resolveRollExpression({ kind: "skill_check", skill: "athletics" }, inspired);
  assert.equal(resolved.expression, "1d20+7+1d8");
  assert.equal(resolved.spendInspiration, "bardic inspiration (d8)");
  assert.ok(resolved.conditionNotes.some((note) => note.includes("+1d8")));
});

test("the inspiration die applies to saves and ability checks too", () => {
  const inspired = sheet({ conditions: ["bardic inspiration (d6)"] });
  assert.equal(
    resolveRollExpression({ kind: "saving_throw", ability: "con" }, inspired).expression,
    "1d20+6+1d6",
  );
  assert.equal(
    resolveRollExpression({ kind: "ability_check", ability: "int" }, inspired).expression,
    "1d20-1+1d6",
  );
});

test("initiative never eats the inspiration die", () => {
  const inspired = sheet({ conditions: ["bardic inspiration (d8)"] });
  const resolved = resolveRollExpression({ kind: "initiative" }, inspired);
  assert.equal(resolved.expression, "1d20+1");
  assert.equal(resolved.spendInspiration, undefined);
});

test("advantage and the inspiration die stack on one expression", () => {
  const both = sheet({ conditions: ["raging", "bardic inspiration (d8)"] });
  assert.equal(
    resolveRollExpression({ kind: "saving_throw", ability: "str" }, both).expression,
    "2d20kh1+7+1d8",
  );
});

test("an auto-failed save spends nothing", () => {
  const paralyzed = sheet({ conditions: ["paralyzed", "bardic inspiration (d8)"] });
  const resolved = resolveRollExpression({ kind: "saving_throw", ability: "str" }, paralyzed);
  assert.equal(resolved.autoFail, true);
  assert.equal(resolved.spendInspiration, undefined);
});

test("Jack of All Trades adds half proficiency to unproficient checks only", () => {
  const bard = sheet({
    class: "bard",
    equipment: [],
    features: [{ name: "Jack of All Trades" }],
  });
  // CHA ability check: +0 mod, half of +3 proficiency = +1.
  const cha = resolveRollExpression({ kind: "ability_check", ability: "cha" }, bard);
  assert.equal(cha.expression, "1d20+1");
  assert.ok(cha.conditionNotes.some((note) => /half proficiency/.test(note)));
  // Saves never get it.
  assert.equal(
    resolveRollExpression({ kind: "saving_throw", ability: "cha" }, bard).expression,
    "1d20",
  );
  // Skill checks route through computeSheetDerived: unproficient Stealth
  // (DEX +1) picks up the half bonus there.
  assert.equal(
    resolveRollExpression({ kind: "skill_check", skill: "stealth" }, bard).expression,
    "1d20+2",
  );
  // Proficient Athletics keeps the full bonus, not both.
  assert.equal(
    resolveRollExpression({ kind: "skill_check", skill: "athletics" }, bard).expression,
    "1d20+7",
  );
});

test("Remarkable Athlete covers physical checks only", () => {
  const champion = sheet({
    class: "fighter",
    equipment: [],
    features: [{ name: "Remarkable Athlete" }],
  });
  assert.equal(
    resolveRollExpression({ kind: "ability_check", ability: "con" }, champion).expression,
    "1d20+4",
  );
  assert.equal(
    resolveRollExpression({ kind: "ability_check", ability: "cha" }, champion).expression,
    "1d20",
  );
});

test("noisy armor imposes disadvantage on Stealth checks", () => {
  const trained = {
    saves: ["str", "con"],
    skills: ["athletics"],
    expertise: [],
    languages: [],
    tools: [],
    armor: ["light", "medium", "heavy"],
    weapons: [],
  };
  const armored = sheet({
    class: "fighter",
    features: [],
    proficiencies: trained,
    equipment: [{ name: "Half Plate", equipped: true }],
  });
  const resolved = resolveRollExpression({ kind: "skill_check", skill: "stealth" }, armored);
  assert.match(resolved.expression, /^2d20kl1/);
  assert.ok(resolved.conditionNotes.some((note) => /armor imposes disadvantage/.test(note)));
  // Quiet armor stays a plain roll.
  const quiet = sheet({
    class: "fighter",
    features: [],
    proficiencies: trained,
    equipment: [{ name: "Breastplate", equipped: true }],
  });
  assert.match(
    resolveRollExpression({ kind: "skill_check", skill: "stealth" }, quiet).expression,
    /^1d20/,
  );
});

test("an ally's aura bonus rides saving throws only", () => {
  const aura = { saveBonus: 3, saveNote: "Seraphina's aura (within 10 ft): +3 on saving throws" };
  const save = resolveRollExpression({ kind: "saving_throw", ability: "str" }, sheet(), aura);
  // STR save +7 plus the aura's +3.
  assert.equal(save.expression, "1d20+10");
  assert.ok(save.conditionNotes.some((note) => /aura/.test(note)));
  // Ability checks never take it.
  assert.equal(
    resolveRollExpression({ kind: "ability_check", ability: "str" }, sheet(), aura).expression,
    "1d20+4",
  );
});

test("armor worn without training = disadvantage on STR and DEX rolls", () => {
  const wizard = sheet({
    class: "wizard",
    features: [],
    equipment: [{ name: "Chain Mail", equipped: true }],
  });
  const save = resolveRollExpression({ kind: "saving_throw", ability: "dex" }, wizard);
  assert.match(save.expression, /^2d20kl1/);
  assert.ok(save.conditionNotes.some((note) => /not trained in/.test(note)));
  // Mental rolls are untouched.
  assert.match(
    resolveRollExpression({ kind: "saving_throw", ability: "wis" }, wizard).expression,
    /^1d20/,
  );
});

console.log(`test-rolls: ${passed} tests passed`);
