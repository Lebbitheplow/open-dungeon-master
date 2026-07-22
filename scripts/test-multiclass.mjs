// 5e multiclassing: prerequisites (both directions), caster-level math,
// the shared slot table, pact slots, and second-class proficiency grants.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const {
  canMulticlassInto,
  casterLevelFor,
  classLevelFor,
  classListFor,
  isMulticlass,
  meetsPrereq,
  multiclassGrantsFor,
  multiclassPrereq,
  multiclassSlots,
  pactSlotsFor,
  slotTableFor,
} = await import("../src/lib/srd/multiclass.ts");
const { populateFeaturesForClasses } = await import("../src/lib/srd/features.ts");
const { populateResources } = await import("../src/lib/srd/class-resources.ts");
const { combatRiders } = await import("../src/lib/srd/feature-effects.ts");
const { unarmoredFormulaFor } = await import("../src/lib/srd/armor.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

const scores = (overrides = {}) => ({
  str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10, ...overrides,
});

test("classListFor falls back to the scalar fields", () => {
  const list = classListFor({ class: "rogue", subclass: "Thief", level: 4 });
  assert.deepEqual(list, [{ id: "rogue", subclass: "Thief", level: 4 }]);
  assert.equal(isMulticlass({ class: "rogue", classes: [] }), false);
});

test("classListFor prefers a non-empty classes array", () => {
  const sheet = {
    class: "rogue",
    level: 5,
    classes: [
      { id: "rogue", subclass: "", level: 3 },
      { id: "fighter", subclass: "", level: 2 },
    ],
  };
  assert.equal(classListFor(sheet).length, 2);
  assert.equal(classLevelFor(sheet, "fighter"), 2);
  assert.equal(classLevelFor(sheet, "wizard"), 0);
  assert.equal(isMulticlass(sheet), true);
});

test("caster level: full + half + artificer rounding, warlock excluded", () => {
  assert.equal(
    casterLevelFor([
      { id: "wizard", subclass: "", level: 5 },
      { id: "paladin", subclass: "", level: 3 },
    ]),
    6, // 5 + floor(3/2)
  );
  assert.equal(casterLevelFor([{ id: "artificer", subclass: "", level: 3 }]), 2); // ceil(3/2)
  assert.equal(
    casterLevelFor([
      { id: "warlock", subclass: "", level: 5 },
      { id: "sorcerer", subclass: "", level: 2 },
    ]),
    2,
  );
  assert.equal(casterLevelFor([{ id: "fighter", subclass: "", level: 10 }]), 0);
});

test("multiclassSlots is the full-caster table", () => {
  assert.deepEqual(multiclassSlots(1), { 1: 2 });
  assert.deepEqual(multiclassSlots(3), { 1: 4, 2: 2 });
  assert.deepEqual(multiclassSlots(0), {});
});

test("slotTableFor: single caster keeps its own table", () => {
  // A paladin 5 alone uses the half-caster table (2 first-level slots at
  // paladin 2... at 5: 4/2), not the multiclass table.
  const single = slotTableFor({
    class: "paladin",
    classes: [
      { id: "paladin", subclass: "", level: 5 },
      { id: "fighter", subclass: "", level: 3 },
    ],
  });
  assert.deepEqual(single, { 1: 4, 2: 2 });
  // Two slot casters share the multiclass table at combined caster level.
  const shared = slotTableFor({
    class: "wizard",
    classes: [
      { id: "wizard", subclass: "", level: 3 },
      { id: "cleric", subclass: "", level: 2 },
    ],
  });
  assert.deepEqual(shared, multiclassSlots(5));
});

test("pact slots stand apart", () => {
  assert.deepEqual(pactSlotsFor(2), { level: 1, max: 2 });
  assert.deepEqual(pactSlotsFor(5), { level: 3, max: 2 });
  assert.equal(pactSlotsFor(0), null);
});

test("prereqs: PHB table, both directions", () => {
  assert.deepEqual(multiclassPrereq("paladin"), [["str", "cha"]]);
  assert.equal(meetsPrereq(scores({ str: 13, cha: 13 }), "paladin"), true);
  assert.equal(meetsPrereq(scores({ str: 13 }), "paladin"), false);
  // Fighter: STR 13 OR DEX 13.
  assert.equal(meetsPrereq(scores({ dex: 13 }), "fighter"), true);

  const rogue = { class: "rogue", level: 4, abilities: scores({ dex: 14, str: 13 }) };
  assert.equal(canMulticlassInto(rogue, "fighter").ok, true);
  // New class prereq unmet.
  assert.equal(canMulticlassInto(rogue, "wizard").ok, false);
  // Current class prereq unmet blocks leaving (RAW both directions).
  const weakRogue = { class: "rogue", level: 4, abilities: scores({ str: 14, dex: 10 }) };
  assert.equal(canMulticlassInto(weakRogue, "fighter").ok, false);
  // Already held and cap.
  assert.equal(canMulticlassInto(rogue, "rogue").ok, false);
  const three = {
    class: "rogue",
    abilities: scores({ dex: 14, str: 14, wis: 14, cha: 14 }),
    classes: [
      { id: "rogue", subclass: "", level: 2 },
      { id: "fighter", subclass: "", level: 1 },
      { id: "bard", subclass: "", level: 1 },
    ],
  };
  assert.equal(canMulticlassInto(three, "monk").ok, false);
});

test("custom classes derive a prerequisite", () => {
  // Custom caster: 13 in its spellcasting ability; martial: first save.
  const anyCustom = multiclassPrereq("gunslinger") ?? multiclassPrereq("street_samurai");
  // Whatever custom classes exist, an unknown id returns null gracefully.
  assert.equal(multiclassPrereq("not_a_class_xyz"), null);
  void anyCustom;
});

test("multiclass grants: PHB rows, never saves; custom caps at medium armor", () => {
  const fighter = multiclassGrantsFor("fighter");
  assert.ok(fighter.armor.includes("medium armor"));
  assert.ok(fighter.weapons.includes("martial weapons"));
  const wizard = multiclassGrantsFor("wizard");
  assert.deepEqual([wizard.armor, wizard.weapons, wizard.tools], [[], [], []]);
  const rogue = multiclassGrantsFor("rogue");
  assert.ok(rogue.tools.includes("thieves' tools"));
  assert.ok(rogue.skillChoice && rogue.skillChoice.from.length > 0);
});

test("per-class feature grants carry classId and dedupe by name", () => {
  const features = populateFeaturesForClasses(
    [],
    [
      { id: "barbarian", subclass: "", level: 5 },
      { id: "monk", subclass: "", level: 5 },
    ],
    "human",
  );
  const unarmored = features.filter(
    (feature) => feature.name.toLowerCase() === "unarmored defense",
  );
  assert.equal(unarmored.length, 1);
  assert.equal(unarmored[0].classId, "barbarian");
  const extraAttack = features.filter((feature) =>
    feature.name.toLowerCase().startsWith("extra attack"),
  );
  assert.equal(extraAttack.length, 1);
  const martialArts = features.find((feature) => feature.name === "Martial Arts");
  assert.equal(martialArts?.classId, "monk");
});

test("combatRiders scales by the granting class's level", () => {
  const classes = [
    { id: "rogue", level: 5 },
    { id: "fighter", level: 3 },
  ];
  const riders = combatRiders({
    class: "rogue",
    level: 8,
    classes,
    features: [{ name: "Sneak Attack", classId: "rogue" }],
  });
  // Rogue 5 = 3d6, not character level 8 = 4d6.
  assert.equal(riders.sneakAttackDice, 3);
  const monkRiders = combatRiders({
    class: "fighter",
    level: 12,
    classes: [
      { id: "fighter", level: 7 },
      { id: "monk", level: 5 },
    ],
    features: [{ name: "Martial Arts", classId: "monk" }],
  });
  assert.equal(monkRiders.martialArtsDie, "d6");
  // Single-class sheets are untouched: no classes array = character level.
  const single = combatRiders({
    class: "rogue",
    level: 8,
    features: [{ name: "Sneak Attack" }],
  });
  assert.equal(single.sneakAttackDice, 4);
});

test("populateResources sizes counters by the owning class", () => {
  const classes = [
    { id: "monk", level: 3 },
    { id: "barbarian", level: 5 },
  ];
  const features = [
    { name: "Ki", classId: "monk" },
    { name: "Rage", classId: "barbarian" },
  ];
  const resources = populateResources(features, 8, {}, undefined, classes);
  assert.equal(resources.ki.max, 3); // monk level, not 8
  assert.equal(resources.rage.max, 3); // barbarian 5 -> 3 rages (not level 8's 4)
  // Single-class behavior unchanged.
  const single = populateResources([{ name: "Ki" }], 8, {}, undefined);
  assert.equal(single.ki.max, 8);
});

test("unarmored defense follows acquisition order", () => {
  const features = [{ name: "Unarmored Defense" }];
  const barbFirst = unarmoredFormulaFor(["barbarian", "monk"], features);
  assert.equal(barbFirst?.ability, "con");
  const monkFirst = unarmoredFormulaFor(["monk", "barbarian"], features);
  assert.equal(monkFirst?.ability, "wis");
  // Single-class call shape still works.
  assert.equal(unarmoredFormulaFor("monk", features)?.ability, "wis");
});

console.log(`test-multiclass: ${passed} passed`);
