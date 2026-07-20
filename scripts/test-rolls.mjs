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

console.log(`test-rolls: ${passed} tests passed`);
