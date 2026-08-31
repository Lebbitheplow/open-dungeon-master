// The monster catalogue: turning a race/class/weapon pick into stat block fields.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const {
  ANCESTRY_OPTIONS,
  CLASS_KIT_OPTIONS,
  CONDITIONS,
  DAMAGE_TYPES,
  acFromArmor,
  addAttack,
  addTrait,
  addTraits,
  applyAncestry,
  applyArmor,
  applyClassChassis,
  armorOptionsFor,
  classFeatureLines,
  describeChassis,
  findAncestry,
  findArmor,
  findClassKit,
  findWeapon,
  formatSpeed,
  formatTerms,
  hasTerm,
  parseSpeed,
  parseTerms,
  subclassOptionsFor,
  toggleTerm,
  weaponAttack,
  weaponOptionsFor,
} = await import("../src/lib/bestiary/kit.ts");

const { MAX_ATTACKS, MAX_TRAITS, draftFromCr, checkMonsterDraft } = await import(
  "../src/lib/bestiary/monster-draft.ts"
);
const { isValidExpression } = await import("../src/lib/dice.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

const base = () => draftFromCr("Bone Tyrant", 5);

// ---- speed ----

test("a speed string round-trips through the picker's fields", () => {
  assert.deepEqual(parseSpeed("30, fly 60"), { walk: 30, fly: 60 });
  assert.equal(formatSpeed({ walk: 30, fly: 60 }), "30, fly 60");
  assert.equal(formatSpeed(parseSpeed("25, burrow 20, swim 40")), "25, burrow 20, swim 40");
});

test("a bare number is the walking speed and a zero mode disappears", () => {
  assert.deepEqual(parseSpeed("40"), { walk: 40 });
  assert.equal(formatSpeed({ walk: 40, fly: 0 }), "40");
  assert.equal(formatSpeed({ walk: 0 }), "0");
});

test("nonsense speed text degrades to a standing monster rather than NaN", () => {
  assert.equal(formatSpeed(parseSpeed("")), "0");
  assert.equal(formatSpeed(parseSpeed("quite fast")), "0");
  assert.equal(formatSpeed({ walk: Number.NaN }), "0");
});

// ---- term fields ----

test("terms parse, dedupe and rejoin", () => {
  assert.deepEqual(parseTerms("fire, cold ; poison"), ["fire", "cold", "poison"]);
  assert.equal(formatTerms(["fire", "Fire", "cold"]), "fire, cold");
  assert.equal(formatTerms([]), "");
});

test("toggling a term adds it, then takes it away, whatever its case", () => {
  assert.equal(toggleTerm("", "fire"), "fire");
  assert.equal(toggleTerm("fire", "cold"), "fire, cold");
  assert.equal(toggleTerm("Fire, cold", "fire"), "cold");
  assert.equal(hasTerm("Fire, cold", "fire"), true);
  assert.equal(hasTerm("fire", "radiant"), false);
});

test("a term the catalogue never heard of survives a toggle of another", () => {
  const custom = "sunlight, fire";
  assert.equal(toggleTerm(custom, "cold"), "sunlight, fire, cold");
  assert.equal(toggleTerm(custom, "fire"), "sunlight");
});

test("the vocabularies are the ones the engine reads", () => {
  assert.equal(DAMAGE_TYPES.length, 13);
  assert.ok(DAMAGE_TYPES.includes("necrotic"));
  assert.equal(CONDITIONS.length, 15);
  assert.ok(CONDITIONS.includes("restrained"));
});

// ---- ancestry ----

test("an ancestry brings its size, walking speed and traits", () => {
  const dwarf = findAncestry("hill_dwarf");
  assert.ok(dwarf);
  const built = applyAncestry(base(), "hill_dwarf");
  assert.equal(built.stats.size, "Medium");
  assert.equal(parseSpeed(built.stats.speed).walk, 25);
  for (const trait of dwarf.traits) {
    assert.ok(built.stats.traits.includes(trait), `missing ${trait}`);
  }
});

test("an ancestry keeps a fly speed the block already had", () => {
  const flying = { ...base(), stats: { ...base().stats, speed: "30, fly 60" } };
  const built = applyAncestry(flying, "hill_dwarf");
  assert.deepEqual(parseSpeed(built.stats.speed), { walk: 25, fly: 60 });
});

test("applying the same ancestry twice writes its traits once", () => {
  const once = applyAncestry(base(), "hill_dwarf");
  const twice = applyAncestry(once, "hill_dwarf");
  assert.deepEqual(twice.stats.traits, once.stats.traits);
});

test("an unknown ancestry changes nothing", () => {
  const draft = base();
  assert.deepEqual(applyAncestry(draft, "moon-goblin"), draft);
  assert.equal(findAncestry("moon-goblin"), null);
  assert.ok(ANCESTRY_OPTIONS.length > 5);
});

// ---- class chassis ----

const chassis = (over = {}) => ({
  classId: "barbarian",
  subclass: "",
  level: 5,
  con: 16,
  ancestryId: "",
  ...over,
});

test("a class raises its own saves, and nothing else's", () => {
  const built = applyClassChassis(base(), chassis());
  const klass = findClassKit("barbarian");
  assert.deepEqual(klass.saves, ["str", "con"]);
  // Level 5 proficiency is +3.
  assert.ok(built.stats.saveMods.str >= 3);
  assert.ok(built.stats.saveMods.con >= 3);
  assert.equal(built.stats.saveMods.cha, base().stats.saveMods.cha);
});

test("a class raises hit points, but never below what the rating already had", () => {
  // A CR 1 baseline is 25 hit points; a level 5 barbarian with CON 16 is 55.
  const weak = draftFromCr("Thug", 1);
  assert.ok(applyClassChassis(weak, chassis()).stats.maxHp > weak.stats.maxHp);
  // A CR 5 baseline is 85, which the same chassis must not drag down.
  assert.equal(applyClassChassis(base(), chassis()).stats.maxHp, base().stats.maxHp);
});

test("Extra Attack becomes a second swing", () => {
  // A CR 1 baseline swings once, so the extra swing here is the class's.
  const weak = () => draftFromCr("Thug", 1);
  assert.equal(applyClassChassis(weak(), chassis({ level: 1 })).stats.attacksPerTurn, 1);
  assert.equal(applyClassChassis(weak(), chassis({ level: 5 })).stats.attacksPerTurn, 2);
  // Fighters get it three times; the engine caps a turn at three swings.
  assert.equal(
    applyClassChassis(weak(), chassis({ classId: "fighter", level: 20 })).stats.attacksPerTurn,
    3,
  );
});

test("applying a chassis is idempotent and never lowers a hand edit", () => {
  const once = applyClassChassis(base(), chassis());
  const twice = applyClassChassis(once, chassis());
  assert.deepEqual(twice.stats.saveMods, once.stats.saveMods);
  assert.equal(twice.stats.maxHp, once.stats.maxHp);

  const tougher = { ...once, stats: { ...once.stats, maxHp: 400, saveMods: { ...once.stats.saveMods, str: 12 } } };
  const reapplied = applyClassChassis(tougher, chassis());
  assert.equal(reapplied.stats.maxHp, 400);
  assert.equal(reapplied.stats.saveMods.str, 12);
});

test("mixing two classes keeps both sets of saves", () => {
  const mixed = applyClassChassis(
    applyClassChassis(base(), chassis()),
    chassis({ classId: "wizard" }),
  );
  assert.ok(mixed.stats.saveMods.str >= 3, "barbarian STR survived");
  assert.ok(mixed.stats.saveMods.int >= 3, "wizard INT arrived");
  assert.ok(mixed.stats.saveMods.wis >= 3, "wizard WIS arrived");
});

test("an unknown class changes nothing, and describes nothing", () => {
  const draft = base();
  assert.deepEqual(applyClassChassis(draft, chassis({ classId: "beholder" })), draft);
  assert.equal(describeChassis(chassis({ classId: "beholder" })), "");
  assert.ok(describeChassis(chassis()).includes("d12"));
});

test("the class list covers the SRD and the genre catalogue", () => {
  const ids = CLASS_KIT_OPTIONS.map((entry) => entry.id);
  assert.ok(ids.includes("barbarian"));
  assert.ok(ids.includes("wizard"));
  assert.ok(new Set(ids).size === ids.length, "no duplicate class ids");
});

// ---- features ----

test("a class offers its features up to the chosen level, and no further", () => {
  const early = classFeatureLines("barbarian", "", 1).map((entry) => entry.name);
  const later = classFeatureLines("barbarian", "", 5).map((entry) => entry.name);
  assert.ok(early.includes("Rage"));
  assert.ok(!early.includes("Extra Attack"));
  assert.ok(later.includes("Extra Attack"));
});

test("a subclass adds its own features on top of the base class", () => {
  const bare = classFeatureLines("barbarian", "", 6);
  for (const subclass of subclassOptionsFor("barbarian")) {
    const lines = classFeatureLines("barbarian", subclass, 6);
    assert.ok(lines.length > bare.length, `${subclass} added nothing`);
    assert.ok(lines.every((entry) => entry.line.startsWith(entry.name)));
  }
});

test("the subclasses we wrote ourselves carry their rules text into the trait", () => {
  // The SRD subclass ships names only; the authored catalogue
  // (src/lib/srd/subclasses.json) ships a line of rules text per feature,
  // and that line is what makes a borrowed ability usable at the table.
  const withText = subclassOptionsFor("barbarian").filter((subclass) =>
    classFeatureLines("barbarian", subclass, 6).some((entry) => entry.text.length > 0),
  );
  assert.ok(withText.length > 0, "no barbarian subclass carries rules text");
  const line = classFeatureLines("barbarian", withText[0], 6).find((entry) => entry.text);
  assert.ok(line.line.startsWith(`${line.name}: `));
});

test("a class with no subclasses offers none rather than throwing", () => {
  assert.deepEqual(subclassOptionsFor(""), []);
  assert.deepEqual(classFeatureLines("", "", 5), []);
  assert.deepEqual(classFeatureLines("beholder", "", 5), []);
});

// ---- traits ----

test("a trait goes on once and the box has a floor", () => {
  const once = addTrait(base(), "Rage");
  assert.deepEqual(once.stats.traits, ["Rage"]);
  assert.deepEqual(addTrait(once, " rage ").stats.traits, ["Rage"]);
  assert.deepEqual(addTrait(once, "   ").stats.traits, ["Rage"]);
});

test("the trait box refuses to overflow", () => {
  const many = Array.from({ length: MAX_TRAITS + 5 }, (_, index) => `Trait ${index}`);
  assert.equal(addTraits(base(), many).stats.traits.length, MAX_TRAITS);
});

test("a dwarf paladin mixing in a barbarian ability is an ordinary draft", () => {
  let boss = applyAncestry(base(), "mountain_dwarf");
  boss = applyClassChassis(boss, chassis({ classId: "paladin", ancestryId: "mountain_dwarf" }));
  boss = addTrait(boss, classFeatureLines("barbarian", "", 5)[0].line);
  boss = addAttack(boss, weaponAttack(findWeapon("Greatsword"), { profBonus: 3, abilityMod: 4 }));
  const checked = checkMonsterDraft({
    name: boss.name,
    ...boss.stats,
    extraDamagePerRound: boss.extraDamagePerRound,
  });
  assert.ok(!("error" in checked), `server refused the draft: ${checked.error ?? ""}`);
  assert.ok(checked.draft.stats.traits.some((trait) => trait.startsWith("Rage")));
});

// ---- armour ----

test("armour class is the armour, as much DEX as it allows, and a shield", () => {
  assert.equal(acFromArmor(findArmor("Leather"), 3, false), 14);
  // Half plate caps DEX at 2.
  assert.equal(acFromArmor(findArmor("Half Plate"), 5, false), 17);
  // Plate allows none.
  assert.equal(acFromArmor(findArmor("Plate"), 5, false), 18);
  assert.equal(acFromArmor(findArmor("Plate"), 5, true), 20);
  // Unarmoured is base 10.
  assert.equal(acFromArmor(null, 3, false), 13);
  assert.equal(acFromArmor(null, 3, true), 15);
});

test("applying armour writes the armour class and leaves the rest alone", () => {
  const draft = { ...base(), stats: { ...base().stats, dexMod: 2 } };
  const armored = applyArmor(draft, "Chain Mail", true);
  assert.equal(armored.stats.ac, 18);
  assert.equal(armored.stats.maxHp, draft.stats.maxHp);
});

test("the armour list puts what the class can wear first, and hides nothing", () => {
  const forWizard = armorOptionsFor("wizard");
  const forFighter = armorOptionsFor("fighter");
  assert.equal(forWizard.length, forFighter.length, "same list, different order");
  assert.equal(forFighter[0].category, "light");
  assert.ok(forWizard.some((armor) => armor.name === "Plate"), "plate is still offered");
});

// ---- weapons ----

test("a weapon becomes an attack the dice engine can roll", () => {
  const attack = weaponAttack(findWeapon("Greatsword"), { profBonus: 3, abilityMod: 4 });
  assert.equal(attack.name, "Greatsword");
  assert.equal(attack.toHit, 7);
  assert.equal(attack.damage, "2d6+4");
  assert.equal(attack.type, "slashing");
  assert.ok(isValidExpression(attack.damage));
});

test("every weapon in the table makes a rollable attack", () => {
  for (const weapon of weaponOptionsFor("")) {
    const attack = weaponAttack(weapon, { profBonus: 2, abilityMod: 0 });
    assert.ok(isValidExpression(attack.damage), `${weapon.name} -> ${attack.damage}`);
    assert.ok(attack.type, `${weapon.name} has no damage type`);
  }
});

test("a zero ability modifier leaves the dice bare", () => {
  assert.equal(weaponAttack(findWeapon("Dagger"), { profBonus: 2, abilityMod: 0 }).damage, "1d4");
});

test("the attack list refuses to overflow", () => {
  let draft = base();
  const attack = weaponAttack(findWeapon("Dagger"), { profBonus: 2, abilityMod: 1 });
  for (let index = 0; index < MAX_ATTACKS + 3; index += 1) {
    draft = addAttack(draft, { ...attack, name: `Dagger ${index}` });
  }
  assert.equal(draft.stats.attacks.length, MAX_ATTACKS);
});

test("the weapon list puts what the class can use first, and hides nothing", () => {
  const forWizard = weaponOptionsFor("wizard");
  const forFighter = weaponOptionsFor("fighter");
  assert.equal(forWizard.length, forFighter.length);
  assert.ok(forWizard[0].category === "simple", "a wizard's own weapons come first");
  assert.ok(forWizard.some((weapon) => weapon.name === "Greatsword"), "greatsword still offered");
});

console.log(`monster kit: ${passed} tests passed.`);
