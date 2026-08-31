// Taking a stored sheet into a campaign that runs at a different level.
//
// This logic is not new: it was the body of instantiateIntoCampaign, where
// it had run since the character library existed and where no test could
// reach it, because it sat inside a database call. Phase 5 moved it out
// unchanged so a companion out of the same library gets the same work done
// to it, and these assertions are the first thing that has ever checked it.
// See docs/workshop-plan.md phase 5.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { adaptSheetToLevel } = await import("../src/lib/characters/adapt.ts");
const { earnedAsiCount } = await import("../src/lib/srd/asi.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

const sheet = (overrides = {}) => ({
  name: "Marla",
  race: "human",
  class: "fighter",
  subclass: "champion",
  background: "soldier",
  abilities: { str: 18, dex: 14, con: 16, int: 10, wis: 12, cha: 8 },
  maxHp: 84,
  hitDice: { total: 9, spent: 3 },
  ...overrides,
});

// ---- it does not eat the sheet it was given ----

test("the input sheet is never mutated", () => {
  // instantiateIntoCampaign used to clone before touching anything; this
  // still has to, or a library row would change every time it was read.
  const original = sheet({ asiChoices: [{ mode: "plus2", ability: "str" }] });
  const snapshot = structuredClone(original);
  adaptSheetToLevel(original, 9, 3);
  assert.deepEqual(original, snapshot);
});

test("a sheet joining at its own level comes back with the same abilities", () => {
  const original = sheet();
  const adapted = adaptSheetToLevel(original, 9, 9);
  assert.deepEqual(adapted.abilities, original.abilities);
  assert.equal(adapted.maxHp, original.maxHp, "hp should not move at the same level");
});

// ---- ability score improvements ----

test("a character joining below its level gives back improvements it has not earned", () => {
  const original = sheet({
    asiChoices: [
      { mode: "plus2", ability: "str" },
      { mode: "plus1x2", abilities: ["dex", "con"] },
    ],
  });
  // Level 3 has earned none of them.
  const adapted = adaptSheetToLevel(original, 9, 3);
  assert.equal(earnedAsiCount(3), 0);
  assert.equal(adapted.asiChoices.length, 0);
  assert.equal(adapted.abilities.str, 16, "the +2 was not given back");
  assert.equal(adapted.abilities.dex, 13);
  assert.equal(adapted.abilities.con, 15);
});

test("it keeps the improvements the target level has actually earned", () => {
  const original = sheet({
    asiChoices: [
      { mode: "plus2", ability: "str" },
      { mode: "plus1x2", abilities: ["dex", "con"] },
    ],
  });
  // Level 4 has earned exactly one.
  const adapted = adaptSheetToLevel(original, 9, 4);
  assert.equal(adapted.asiChoices.length, 1);
  assert.equal(adapted.abilities.str, 18, "the earned +2 was taken away");
  assert.equal(adapted.abilities.dex, 13, "the unearned +1 was kept");
});

test("a feat taken with an unearned improvement goes with it", () => {
  const original = sheet({
    feats: ["Alert", "Lucky"],
    asiChoices: [{ mode: "feat", feat: "Lucky" }],
  });
  const adapted = adaptSheetToLevel(original, 9, 3);
  assert.deepEqual(adapted.feats, ["Alert"], "the feat earned at level 4 was kept");
});

test("levelling up grants no automatic improvements", () => {
  // Deliberate and long-standing: the player edits the sheet in play rather
  // than the engine inventing choices nobody made.
  const original = sheet({ asiChoices: [{ mode: "plus2", ability: "str" }] });
  const adapted = adaptSheetToLevel(original, 4, 12);
  assert.equal(adapted.asiChoices.length, 1);
  assert.equal(adapted.abilities.str, 18);
});

// ---- multiclass ----

const multiclass = (overrides = {}) =>
  sheet({
    class: "fighter",
    classes: [
      { id: "fighter", subclass: "champion", level: 5 },
      { id: "rogue", subclass: "thief", level: 4 },
    ],
    hitDicePools: [
      { classId: "fighter", die: 10, total: 5, spent: 1 },
      { classId: "rogue", die: 8, total: 4, spent: 2 },
    ],
    ...overrides,
  });

test("levels come off the last class first, because that is the one taken last", () => {
  const adapted = adaptSheetToLevel(multiclass(), 9, 7);
  assert.equal(adapted.classes.length, 2);
  assert.equal(adapted.classes[0].level, 5, "the first class should not be touched yet");
  assert.equal(adapted.classes[1].level, 2);
});

test("a class stripped to nothing drops out entirely", () => {
  const adapted = adaptSheetToLevel(multiclass(), 9, 5);
  assert.equal(adapted.classes.length, 1);
  assert.equal(adapted.classes[0].id, "fighter");
});

test("its hit-die pool goes with it, and the pools come back unspent", () => {
  const adapted = adaptSheetToLevel(multiclass(), 9, 7);
  assert.equal(adapted.hitDicePools.length, 2);
  assert.equal(adapted.hitDicePools[1].total, 2, "the pool did not follow the class down");
  assert.equal(adapted.hitDicePools[1].spent, 0, "a fresh sheet should start unspent");
});

test("dropping to one class drops the multiclass pools altogether", () => {
  // A single-classed sheet tracks hit dice on hitDice, not on pools.
  const adapted = adaptSheetToLevel(multiclass(), 9, 5);
  assert.equal(adapted.hitDicePools, null);
});

test("a warlock stripped out takes its pact slots with it", () => {
  const original = sheet({
    class: "sorcerer",
    classes: [
      { id: "sorcerer", subclass: "draconic", level: 5 },
      { id: "warlock", subclass: "fiend", level: 3 },
    ],
    spellcasting: {
      casters: [
        { classId: "sorcerer", ability: "cha" },
        { classId: "warlock", ability: "cha" },
      ],
      pact: { level: 2, max: 2, used: 0 },
      slots: {},
    },
  });
  const adapted = adaptSheetToLevel(original, 8, 5);
  assert.equal(adapted.spellcasting.casters.length, 1);
  assert.equal(adapted.spellcasting.casters[0].classId, "sorcerer");
  assert.equal(adapted.spellcasting.pact, undefined, "pact magic survived its class");
});

test("levelling a multiclass up adds to the primary class", () => {
  const adapted = adaptSheetToLevel(multiclass(), 9, 12);
  assert.equal(adapted.classes[0].level, 8);
  assert.equal(adapted.classes[1].level, 4, "the second class should be untouched");
});

// ---- hit dice and hit points ----

test("hit dice resize to the level being played and come back whole", () => {
  const adapted = adaptSheetToLevel(sheet(), 9, 3);
  assert.equal(adapted.hitDice.total, 3);
  assert.equal(adapted.hitDice.spent, 0, "a character should not arrive already winded");
});

test("hit points come down with the level", () => {
  const adapted = adaptSheetToLevel(sheet(), 9, 3);
  assert.ok(adapted.maxHp < 84, "a level 3 fighter should not have a level 9 fighter's hp");
  assert.ok(adapted.maxHp > 0);
});

test("a class the SRD tables do not know is scaled by proportion instead", () => {
  // The fallback path: no suggestion available, so the stored hp is scaled.
  const original = sheet({ class: "gunslinger", maxHp: 80 });
  const adapted = adaptSheetToLevel(original, 10, 5);
  assert.equal(adapted.maxHp, 40);
});

test("a sheet stored at level zero cannot divide by it", () => {
  const adapted = adaptSheetToLevel(sheet({ class: "gunslinger", maxHp: 40 }), 0, 5);
  assert.ok(Number.isFinite(adapted.maxHp));
  assert.ok(adapted.maxHp > 0);
});

// ---- spell slots ----

test("spell slots are the ones for the level actually being played", () => {
  const original = sheet({
    class: "wizard",
    spellcasting: { ability: "int", slots: { 1: { max: 4, used: 3 }, 5: { max: 2, used: 1 } } },
  });
  const adapted = adaptSheetToLevel(original, 9, 3);
  assert.equal(adapted.spellcasting.slots["5"], undefined, "a level 3 wizard has no 5th slots");
  assert.equal(adapted.spellcasting.slots["1"].max, 4);
  assert.equal(adapted.spellcasting.slots["1"].used, 0, "slots should arrive full");
});

test("a sheet with no spellcasting is left alone", () => {
  const adapted = adaptSheetToLevel(sheet(), 9, 3);
  assert.equal(adapted.spellcasting, undefined);
});

// ---- the bounds ----

test("a level outside 1 to 20 is clamped rather than trusted", () => {
  assert.equal(adaptSheetToLevel(sheet(), 9, 0).hitDice.total, 1);
  assert.equal(adaptSheetToLevel(sheet(), 9, 99).hitDice.total, 20);
});

console.log(`character adapt: ${passed} assertions passed.`);
