// The ⓘ item card folds every row sharing an item's name, plus the bundled
// SRD tables, into one sheet (src/lib/help/item-sheet.ts). Guards that
// weight and value surface, that armour and weapons get their stats, that
// genre gear the pack lacks still gets a card, and that prose rides along.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { buildItemSheet } = await import("../src/lib/help/item-sheet.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

// Rows as the Open5e pack stores them.
const longsword = {
  name: "Longsword",
  category: "Martial Melee Weapons",
  cost: "15 gp",
  damage_dice: "1d8",
  damage_type: "slashing",
  weight: "3 lb.",
  properties: ["versatile (1d10)"],
};
const plate = {
  name: "Plate",
  category: "Heavy Armor",
  base_ac: 18,
  plus_dex_mod: false,
  plus_max: 0,
  plus_flat_mod: 0,
  ac_string: "18",
  strength_requirement: 15,
  cost: "1500 gp",
  weight: "",
  stealth_disadvantage: true,
};
const shieldV1 = {
  name: "Shield",
  category: "Shield",
  base_ac: 0,
  plus_dex_mod: false,
  plus_flat_mod: 2,
  ac_string: "0 +2",
  strength_requirement: null,
  cost: "10 gp",
  weight: "",
  stealth_disadvantage: false,
};
const shieldV2 = {
  name: "Shield",
  desc: "A shield is made from wood or metal and is carried in one hand.",
  category: { name: "Shield", key: "shield" },
  weapon: null,
  armor: null,
  weight: "6.000",
  weight_unit: "lb",
  cost: "10.00",
};

test("a weapon row shows weight, value, damage and explained properties", () => {
  const sheet = buildItemSheet("Longsword", [longsword]);
  assert.equal(sheet.type, "Martial melee weapon");
  assert.equal(sheet.weight, "3 lb.");
  assert.equal(sheet.cost, "15 gp");
  assert.equal(sheet.weapon.damage, "1d8");
  assert.equal(sheet.weapon.damageType, "slashing");
  assert.equal(sheet.weapon.properties[0].name, "Versatile (1d10)");
  assert.match(sheet.weapon.properties[0].blurb, /one hand or two/);
  assert.equal(sheet.armor, null);
  assert.equal(sheet.description, null);
});

test("a pack armour row borrows its weight from the bundled table", () => {
  const sheet = buildItemSheet("Plate", [plate]);
  assert.equal(sheet.type, "Heavy armor");
  assert.equal(sheet.armor.ac, "18");
  assert.equal(sheet.armor.strength, 15);
  assert.equal(sheet.armor.stealthDisadvantage, true);
  assert.equal(sheet.weight, "65 lb.");
  assert.equal(sheet.cost, "1500 gp");
});

test("genre armour the pack lacks comes from the bundled table", () => {
  const sheet = buildItemSheet("Kevlar Vest", [undefined]);
  assert.equal(sheet.type, "Medium armor");
  assert.equal(sheet.armor.ac, "13 + Dex (max 2)");
  assert.match(sheet.armor.dex, /up to \+2/);
  assert.equal(sheet.weight, "15 lb.");
  assert.equal(sheet.cost, null);
});

test("a shield merges its stat row with the prose row", () => {
  const sheet = buildItemSheet("Shield", [shieldV1, shieldV2]);
  assert.equal(sheet.armor.ac, "+2");
  assert.equal(sheet.armor.shield, true);
  assert.equal(sheet.weight, "6 lb.");
  assert.equal(sheet.cost, "10 gp");
  assert.match(sheet.description, /carried in one hand/);
});

test("a +1 weapon with no row of its own reads the SRD weapon and the bonus", () => {
  const sheet = buildItemSheet("+1 Longsword", []);
  assert.equal(sheet.bonus, 1);
  assert.equal(sheet.weapon.damage, "1d8 + 1");
  assert.equal(sheet.type, "Martial melee weapon");
});

test("a name that only contains a weapon is not read as that weapon", () => {
  assert.equal(buildItemSheet("Pistol Holster", []), null);
});

test("a net deals no damage and says so", () => {
  const sheet = buildItemSheet("Net", [
    { category: "Martial Ranged Weapons", damage_dice: "0", damage_type: "", properties: ["special", "thrown (range 5/15)"] },
  ]);
  assert.equal(sheet.weapon.damage, null);
  assert.equal(sheet.weapon.range, "5/15 ft.");
});

test("a magic item carries type, rarity, attunement and prose", () => {
  const sheet = buildItemSheet("Flame Tongue", [
    {
      name: "Flame Tongue",
      type: "Weapon (any sword)",
      desc: "You can use a bonus action to speak this magic sword's command word.",
      rarity: "rare",
      requires_attunement: "requires attunement",
    },
  ]);
  assert.equal(sheet.type, "Weapon (any sword)");
  assert.equal(sheet.rarity, "Rare");
  assert.equal(sheet.attunement, true);
  assert.match(sheet.description, /command word/);
});

test("v2 gear gets its category, weight and a small price in silver", () => {
  const sheet = buildItemSheet("Torch", [
    { name: "Torch", desc: "A torch burns for 1 hour.", category: { name: "Adventuring Gear" }, weight: "1.000", cost: "0.01" },
  ]);
  assert.equal(sheet.type, "Adventuring gear");
  assert.equal(sheet.weight, "1 lb.");
  assert.equal(sheet.cost, "1 cp");
});

test("homebrew armour reads its own block", () => {
  const sheet = buildItemSheet("Dragonhide Coat", [
    {
      itemKind: "armor",
      desc: "Stitched from a wyrmling's hide.",
      cost: "400 gp",
      weight: 12,
      armor: { name: "Dragonhide Coat", category: "light", baseAc: 12, weightLb: 12 },
    },
  ]);
  assert.equal(sheet.armor.ac, "12 + Dex");
  assert.equal(sheet.weight, "12 lb.");
  assert.equal(sheet.cost, "400 gp");
  assert.match(sheet.description, /wyrmling/);
});

test("nothing known is null", () => {
  assert.equal(buildItemSheet("Mysterious Trinket", [undefined, null]), null);
});

console.log(`\n${passed} item-sheet tests passed.`);
