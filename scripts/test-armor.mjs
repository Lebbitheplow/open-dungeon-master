// SRD armor matching, proficiency, and the derived-AC math that replaced
// the hand-typed armor class.
import assert from "node:assert/strict";
import {
  ATTUNEMENT_SLOTS,
  SRD_ARMOR,
  computeArmorClass,
  defaultArmor,
  isArmorProficient,
  magicItemBonus,
  matchArmor,
  suggestArmor,
  unarmoredFormulaFor,
} from "../src/lib/srd/armor.ts";

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

const mods = { con: 0, wis: 0 };
const ac = (input) =>
  computeArmorClass({
    armorProfs: ["light", "medium", "heavy", "shields"],
    dexMod: 0,
    abilityMods: mods,
    strength: 16,
    unarmored: null,
    ...input,
  }).ac;

test("matches armor by exact and trailing name", () => {
  assert.equal(matchArmor("Plate")?.name, "Plate");
  assert.equal(matchArmor("plate armor")?.name, "Plate");
  assert.equal(matchArmor("+1 Plate")?.name, "Plate");
  assert.equal(matchArmor("Dwarven Chain Mail")?.name, "Chain Mail");
  // Longest canonical name wins over its own suffix.
  assert.equal(matchArmor("Studded Leather")?.name, "Studded Leather");
  assert.equal(matchArmor("Chain Mail")?.name, "Chain Mail");
});

test("ordinary gear never becomes armor", () => {
  // The old substring approach turned every one of these into armor.
  for (const name of ["Leather Backpack", "Hide Rope", "Plate of Stew", "Shield Charm Scroll"]) {
    assert.equal(matchArmor(name), null, name);
  }
});

test("reads the magic bonus off an item name", () => {
  assert.equal(magicItemBonus("+1 Longsword"), 1);
  assert.equal(magicItemBonus("Plate +2"), 2);
  assert.equal(magicItemBonus("Shield, +3"), 3);
  assert.equal(magicItemBonus("Longsword"), 0);
  // No false positive from a quantity or a stray number in the name.
  assert.equal(magicItemBonus("Potion of Healing"), 0);
  assert.equal(magicItemBonus("+12 Nonsense"), 0);
});

test("armor proficiency cascades from heavy down", () => {
  const plate = matchArmor("Plate");
  const leather = matchArmor("Leather");
  const shield = matchArmor("Shield");
  assert.equal(isArmorProficient(["heavy"], plate), true);
  assert.equal(isArmorProficient(["heavy"], leather), true);
  assert.equal(isArmorProficient(["light"], plate), false);
  assert.equal(isArmorProficient(["light"], leather), true);
  assert.equal(isArmorProficient(["shields"], shield), true);
  assert.equal(isArmorProficient(["shields (nonmetal)"], shield), true);
  assert.equal(isArmorProficient(["light"], shield), false);
});

test("heavy armor ignores DEX, medium caps it, light takes it all", () => {
  assert.equal(ac({ equipment: [{ name: "Plate" }], dexMod: 4 }), 18);
  assert.equal(ac({ equipment: [{ name: "Breastplate" }], dexMod: 4 }), 16);
  assert.equal(ac({ equipment: [{ name: "Leather" }], dexMod: 4 }), 15);
});

test("shields and magic bonuses stack on top", () => {
  assert.equal(ac({ equipment: [{ name: "Plate" }, { name: "Shield" }] }), 20);
  assert.equal(ac({ equipment: [{ name: "+1 Plate" }, { name: "Shield" }] }), 21);
  assert.equal(ac({ equipment: [{ name: "Plate" }, { name: "+2 Shield" }] }), 22);
});

test("no armor falls back to 10 + DEX", () => {
  assert.equal(ac({ equipment: [{ name: "Rope" }], dexMod: 3 }), 13);
});

test("Unarmored Defense replaces the base only while unarmored", () => {
  const barbarian = unarmoredFormulaFor("barbarian", [{ name: "Unarmored Defense" }]);
  const monk = unarmoredFormulaFor("monk", [{ name: "Unarmored Defense" }]);
  assert.equal(barbarian.ability, "con");
  assert.equal(monk.ability, "wis");
  // Barbarian: 10 + DEX 2 + CON 3, shield allowed on top.
  assert.equal(
    ac({ equipment: [], dexMod: 2, abilityMods: { con: 3, wis: 0 }, unarmored: barbarian }),
    15,
  );
  assert.equal(
    ac({
      equipment: [{ name: "Shield" }],
      dexMod: 2,
      abilityMods: { con: 3, wis: 0 },
      unarmored: barbarian,
    }),
    17,
  );
  // The monk's version is switched off by a shield entirely.
  assert.equal(
    ac({
      equipment: [{ name: "Shield" }],
      dexMod: 2,
      abilityMods: { con: 0, wis: 3 },
      unarmored: monk,
    }),
    15,
  );
  // Wearing armor overrides the formula.
  assert.equal(
    ac({ equipment: [{ name: "Plate" }], dexMod: 2, abilityMods: { con: 3, wis: 0 }, unarmored: barbarian }),
    18,
  );
});

test("explicit equipped flags win over carrying everything", () => {
  // Nothing marked: the whole pack counts, so the best armor applies.
  assert.equal(ac({ equipment: [{ name: "Plate" }, { name: "Leather" }] }), 18);
  // Once anything is marked, only marked items count.
  assert.equal(
    ac({ equipment: [{ name: "Plate" }, { name: "Leather", equipped: true }] }),
    11,
  );
});

test("reports unproficient wear, stealth, and the Strength penalty", () => {
  const heavy = computeArmorClass({
    equipment: [{ name: "Plate" }],
    armorProfs: ["light"],
    dexMod: 0,
    abilityMods: mods,
    strength: 10,
    unarmored: null,
  });
  assert.equal(heavy.unproficient, true);
  assert.equal(heavy.stealthDisadvantage, true);
  assert.equal(heavy.speedPenalty, 10);
  assert.equal(heavy.armorName, "Plate");
  const light = computeArmorClass({
    equipment: [{ name: "Leather" }],
    armorProfs: ["light"],
    dexMod: 0,
    abilityMods: mods,
    strength: 10,
    unarmored: null,
  });
  assert.equal(light.unproficient, false);
  assert.equal(light.speedPenalty, 0);
});

test("the breakdown explains every part of the number", () => {
  const result = computeArmorClass({
    equipment: [{ name: "+1 Breastplate" }, { name: "Shield" }],
    armorProfs: ["medium", "shields"],
    dexMod: 3,
    abilityMods: mods,
    strength: 12,
    unarmored: null,
    bonus: 1,
  });
  // 14 base + 1 magic + 2 capped DEX + 2 shield + 1 bonus.
  assert.equal(result.ac, 20);
  assert.equal(result.parts.length, 4);
  assert.match(result.parts.join(" "), /Breastplate 15/);
});

test("AC is clamped to the sheet schema's range", () => {
  assert.equal(ac({ equipment: [{ name: "Plate" }, { name: "Shield" }], bonus: 50 }), 30);
});

test("starting armor follows class training", () => {
  assert.deepEqual(
    defaultArmor(["heavy", "medium", "light", "shields"]).map((armor) => armor.name),
    ["Chain Mail", "Shield"],
  );
  assert.deepEqual(defaultArmor(["light"]).map((armor) => armor.name), ["Leather"]);
  assert.deepEqual(defaultArmor([]), []);
  // Every suggestion must be something the class may actually wear.
  for (const armor of suggestArmor(["light"])) {
    assert.equal(isArmorProficient(["light"], armor), true, armor.name);
  }
});

test("the table itself is coherent", () => {
  assert.equal(ATTUNEMENT_SLOTS, 3);
  for (const armor of SRD_ARMOR) {
    assert.equal(matchArmor(armor.name)?.name, armor.name, armor.name);
    if (armor.category === "heavy") {
      assert.equal(armor.dexCap, 0, armor.name);
    }
    if (armor.category === "medium") {
      assert.equal(armor.dexCap, 2, armor.name);
    }
  }
});

console.log(`test-armor: ${passed} passed`);
