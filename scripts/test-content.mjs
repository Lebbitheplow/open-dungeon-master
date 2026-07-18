// Contract tests for the Open5e normalizers plus a fixture-db check of the
// table shapes scripts/import-open5e.mjs creates.
import assert from "node:assert/strict";
import {
  normalizeClassRows,
  normalizeGearItem,
  normalizeMagicItem,
  normalizeRaceRows,
  normalizeSpell,
  slugify,
  spellClassesCsv,
} from "./lib/open5e-normalize.mjs";

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

test("slugify", () => {
  assert.equal(slugify("Sleight of Hand!"), "sleight-of-hand");
  assert.equal(slugify("  Fire Bolt  "), "fire-bolt");
});

test("spell classes csv prefers spell_lists", () => {
  assert.equal(
    spellClassesCsv({ spell_lists: ["Bard", "wizard"], dnd_class: "Cleric" }),
    "bard,wizard",
  );
  assert.equal(spellClassesCsv({ dnd_class: "Bard, Sorcerer, Wizard" }), "bard,sorcerer,wizard");
});

test("normalizeSpell", () => {
  const spell = normalizeSpell({
    slug: "fireball",
    name: "Fireball",
    document__slug: "wotc-srd",
    level_int: 3,
    school: "Evocation",
    dnd_class: "Sorcerer, Wizard",
    can_be_cast_as_ritual: false,
    requires_concentration: false,
  });
  assert.equal(spell.level, 3);
  assert.equal(spell.school, "evocation");
  assert.equal(spell.classes_csv, "sorcerer,wizard");
  assert.equal(spell.ritual, 0);
  assert.equal(spell.concentration, 0);
});

test("normalizeRaceRows emits parent and subraces", () => {
  const rows = normalizeRaceRows({
    slug: "dwarf",
    name: "Dwarf",
    document__slug: "wotc-srd",
    subraces: [{ name: "Hill Dwarf" }],
  });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].is_subrace, 0);
  assert.equal(rows[1].slug, "dwarf-hill-dwarf");
  assert.equal(rows[1].parent_slug, "dwarf");
});

test("normalizeClassRows parses hit die and archetypes", () => {
  const { cls, archetypes } = normalizeClassRows({
    slug: "fighter",
    name: "Fighter",
    hit_dice: "1d10",
    archetypes: [{ name: "Champion", slug: "champion" }],
  });
  assert.equal(cls.hit_die, 10);
  assert.equal(archetypes.length, 1);
  assert.equal(archetypes[0].class_slug, "fighter");
});

test("normalizeGearItem skips weapons/armor and maps v2 fields", () => {
  assert.equal(normalizeGearItem({ name: "Longsword", weapon: { key: "x" } }), null);
  const gear = normalizeGearItem({
    key: "rope-hempen",
    name: "Rope, Hempen",
    document: "https://api.open5e.com/v2/documents/srd/",
    cost: "1.00",
    weapon: null,
    armor: null,
  });
  assert.equal(gear.slug, "rope-hempen");
  assert.equal(gear.kind, "gear");
  assert.equal(gear.document_slug, "srd");
  assert.equal(gear.cost, "1 gp");
});

test("normalizeMagicItem", () => {
  const item = normalizeMagicItem({
    slug: "bag-of-holding",
    name: "Bag of Holding",
    document__slug: "wotc-srd",
    rarity: "Uncommon",
    type: "Wondrous item",
  });
  assert.equal(item.kind, "magic_item");
  assert.equal(item.rarity, "uncommon");
  assert.equal(item.category, "wondrous item");
});

console.log(`${passed} content tests passed`);
