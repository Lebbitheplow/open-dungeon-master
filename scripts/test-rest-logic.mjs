// 5e rest math: long-rest restoration and short-rest hit-dice planning.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { longRestPatch, defaultShortRestDice, hitDiceExpression, shortRestResourcePatch, slotsRefillOnShortRest } = await import(
  "../src/lib/dm/rest-logic.ts"
);

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

function makeSheet(overrides = {}) {
  return {
    maxHp: 30,
    currentHp: 10,
    tempHp: 3,
    hitDice: { die: "d8", total: 4, spent: 3 },
    conditions: [],
    spellcasting: {
      ability: "wis",
      slots: { 1: { max: 4, used: 2 }, 2: { max: 2, used: 2 } },
      prepared: ["Cure Wounds"],
      known: [],
    },
    deathSaves: null,
    concentratingOn: null,
    ...overrides,
  };
}

test("long rest restores HP, slots, and half the hit dice", () => {
  const patch = longRestPatch(makeSheet());
  assert.equal(patch.currentHp, 30);
  assert.equal(patch.tempHp, 0);
  assert.equal(patch.deathSaves, null);
  assert.equal(patch.concentratingOn, null);
  // 4 total -> 2 recovered: spent 3 -> 1.
  assert.equal(patch.hitDice.spent, 1);
  assert.equal(patch.spellcasting.slots["1"].used, 0);
  assert.equal(patch.spellcasting.slots["2"].used, 0);
});

test("long rest recovers at least one hit die and clears exhaustion", () => {
  const patch = longRestPatch(
    makeSheet({
      hitDice: { die: "d6", total: 1, spent: 1 },
      conditions: ["exhaustion", "poisoned"],
      spellcasting: null,
    }),
  );
  assert.equal(patch.hitDice.spent, 0);
  assert.deepEqual(patch.conditions, ["poisoned"]);
  assert.equal(patch.spellcasting, undefined);
});

test("default short-rest spending targets half HP", () => {
  // 10/30 HP, d8 (avg 4.5) + con 2 per die: needs 5 HP -> 1 die.
  assert.equal(defaultShortRestDice(makeSheet(), 2), 1);
  // Above half HP: nothing to spend.
  assert.equal(defaultShortRestDice(makeSheet({ currentHp: 20 }), 2), 0);
  // At 0 HP: cannot spend.
  assert.equal(defaultShortRestDice(makeSheet({ currentHp: 0 }), 2), 0);
  // No dice left: nothing.
  assert.equal(
    defaultShortRestDice(makeSheet({ hitDice: { die: "d8", total: 4, spent: 4 } }), 2),
    0,
  );
  // Deep deficit clamps to what remains.
  assert.equal(
    defaultShortRestDice(
      makeSheet({ currentHp: 1, maxHp: 60, hitDice: { die: "d8", total: 8, spent: 6 } }),
      0,
    ),
    2,
  );
});

test("hit-dice expressions fold the CON modifier per die", () => {
  assert.equal(hitDiceExpression("d8", 2, 3), "2d8+6");
  assert.equal(hitDiceExpression("d6", 1, 0), "1d6");
  assert.equal(hitDiceExpression("d10", 2, -1), "2d10-2");
});

test("long rest reduces exhaustion by one level, not to zero", async () => {
  const { longRestPatch } = await import("../src/lib/dm/rest-logic.ts");
  const sheet = {
    maxHp: 20,
    currentHp: 10,
    hitDice: { die: "d8", total: 4, spent: 2 },
    spellcasting: null,
    conditions: [],
    conditionMeta: {},
    resources: {},
    exhaustion: 3,
  };
  const patch = longRestPatch(sheet);
  assert.equal(patch.exhaustion, 2);
  const rested = longRestPatch({ ...sheet, exhaustion: 0 });
  assert.equal(rested.exhaustion, undefined);
});

test("long rest converts legacy exhaustion condition strings", async () => {
  const { longRestPatch } = await import("../src/lib/dm/rest-logic.ts");
  const sheet = {
    maxHp: 20,
    currentHp: 10,
    hitDice: { die: "d8", total: 4, spent: 0 },
    spellcasting: null,
    conditions: ["exhaustion", "prone"],
    conditionMeta: {},
    resources: {},
    exhaustion: 0,
  };
  const patch = longRestPatch(sheet);
  assert.equal(patch.exhaustion, 0);
  assert.deepEqual(patch.conditions, ["prone"]);
});

test("a long rest drops a wild shape form and any lingering rage", () => {
  const patch = longRestPatch(
    makeSheet({
      conditions: ["raging"],
      conditionMeta: { raging: { rounds: 4 } },
      wildShape: { form: "dire wolf", beastHp: 20, beastMaxHp: 37, beastAc: 14 },
    }),
  );
  assert.equal(patch.wildShape, null);
  assert.deepEqual(patch.conditions, []);
  assert.deepEqual(patch.conditionMeta, {});
});

const casterSheet = (klass, slots, resources = {}) => ({
  class: klass,
  currentHp: 10,
  maxHp: 20,
  hitDice: { die: "d8", total: 5, spent: 0 },
  conditions: [],
  conditionMeta: {},
  exhaustion: 0,
  resources,
  spellcasting: { ability: "cha", slots, prepared: [], known: [] },
});

test("only pact casters get their slots back on a short rest", () => {
  assert.equal(slotsRefillOnShortRest({ class: "warlock" }), true);
  assert.equal(slotsRefillOnShortRest({ class: "wizard" }), false);
  assert.equal(slotsRefillOnShortRest({ class: "fighter" }), false);
});

test("a warlock's pact slots refill on a short rest", () => {
  const warlock = casterSheet("warlock", { 2: { max: 2, used: 2 } });
  const patch = shortRestResourcePatch(warlock);
  assert.deepEqual(patch.spellcasting.slots, { 2: { max: 2, used: 0 } });
});

test("a wizard's slots survive a short rest untouched", () => {
  const wizard = casterSheet("wizard", { 1: { max: 4, used: 3 } });
  assert.equal(shortRestResourcePatch(wizard), null);
});

test("a short rest with nothing to restore writes nothing", () => {
  const warlock = casterSheet("warlock", { 2: { max: 2, used: 0 } });
  assert.equal(shortRestResourcePatch(warlock), null);
});

test("short-recharge resources refill alongside the slots", () => {
  const monk = casterSheet("monk", {}, { ki: { max: 5, used: 5 } });
  const patch = shortRestResourcePatch(monk);
  assert.equal(patch.resources.ki.used, 0);
});

console.log(`test-rest-logic: ${passed} tests passed.`);
