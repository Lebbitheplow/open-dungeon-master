// What an item is (src/lib/srd/item-tags.ts): that item-tags.json is current
// with the content pack, that the SRD potions' kinds carry the numbers their
// tables give, and that an item is read by the row it names or the tags it
// carries, the same at every table, never by the words of its name.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);
const { itemTags, itemRow } = await import("../src/lib/srd/item-tags.ts");
const { ITEM_TAGS } = await import("../src/lib/schemas/item-tags.ts");
const { consumableEffect, itemUseProblem } = await import("../src/lib/dm/item-logic.ts");
const { potionPlan } = await import("../src/lib/dm/consumables.ts");
const { carriedLight } = await import("../src/lib/dm/light-timers.ts");
const { ammoKindForItem } = await import("../src/lib/srd/ammunition.ts");
const { isBasicPoison } = await import("../src/lib/dm/attack-onhit.ts");

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const table = JSON.parse(readFileSync(join(root, "src", "lib", "classes", "item-tags.json"), "utf8"));

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

test("item-tags.json is not stale against the content pack", () => {
  // Only meaningful when the content DB is present (CI without it skips).
  if (!existsSync(join(root, "data", "content", "open5e.sqlite"))) {
    return;
  }
  const result = spawnSync(process.execPath, [join(here, "generate-item-tags.mjs"), "--check"], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("every tag the table gives is a listed tag", () => {
  const given = [...table.items.map(([, , tags]) => tags), ...table.added.map(([, tags]) => tags), ...table.potions.map(([, tags]) => tags)].flat();
  assert.ok(given.length > 1000, `only ${given.length} tags`);
  for (const tag of given) {
    assert.ok(ITEM_TAGS.includes(tag), `"${tag}" is not in ITEM_TAGS`);
  }
});

test("the SRD potions' kinds carry their tables' numbers (SRD 5.1, Potions of Healing, Giant Strength, Resistance)", () => {
  const healing = { "Potion of Healing": "2d4+2", "Potion of Greater Healing": "4d4+4", "Potion of Superior Healing": "8d4+8", "Potion of Supreme Healing": "10d4+20" };
  for (const [name, dice] of Object.entries(healing)) {
    assert.deepEqual(consumableEffect({ name }), { kind: "healing", expression: dice }, name);
  }
  const giants = { Hill: 21, Frost: 23, Stone: 23, Fire: 25, Cloud: 27, Storm: 29 };
  for (const [giant, score] of Object.entries(giants)) {
    assert.deepEqual(potionPlan({ name: `Potion of ${giant} Giant Strength` }), { kind: "giant", score });
  }
  for (const type of ["acid", "cold", "fire", "force", "lightning", "necrotic", "poison", "psychic", "radiant", "thunder"]) {
    assert.deepEqual(potionPlan({ name: `Potion of ${type} Resistance` }), { kind: "condition", condition: `protection from energy (${type})`, minutes: 60 });
  }
  assert.deepEqual(potionPlan({ name: "Potion of Heroism" }), { kind: "heroism" });
  assert.deepEqual(potionPlan({ name: "Potion of Vitality" }), { kind: "vitality" });
  assert.deepEqual(potionPlan({ name: "Elixir of Health" }), { kind: "health" });
});

test("a row is found by its slug, its spellings, a trailing count or note, and a magic bonus", () => {
  assert.ok(itemTags({ name: "Torches" }).includes("torch"));
  assert.ok(itemTags({ name: "Spell Scroll (Fireball)" }).includes("scroll"));
  assert.equal(ammoKindForItem({ name: "Arrows (20)" }), "arrows");
  assert.equal(ammoKindForItem({ name: "Crossbow bolts" }), "bolts");
  assert.equal(itemRow({ name: "+1 Longsword" })?.name, "Longsword");
  assert.deepEqual(consumableEffect({ name: "Pozione di guarigione", slug: "potion-of-healing" }), { kind: "healing", expression: "2d4+2" });
});

test("the rules' misreadings stay out: a wand of lightning bolts is no ammunition, holy water no drink, a scroll case no scroll", () => {
  assert.equal(ammoKindForItem({ name: "Wand of Lightning Bolts" }), null);
  assert.equal(itemTags({ name: "Holy Water (flask)" }).includes("water"), false);
  assert.equal(itemTags({ name: "Case, Map or Scroll" }).includes("scroll"), false);
  assert.notEqual(itemUseProblem({ name: "Case, Map or Scroll" }), null, "a scroll case was used up");
  assert.equal(itemTags({ name: "Oil of Sharpness" }).includes("lamp_oil"), false);
});

test("a vial of basic poison is its row, by any of the row's spellings, and no sentence that holds the words", () => {
  for (const name of ["Poison, Basic (vial)", "Basic Poison", "vial of basic poison"]) {
    assert.equal(isBasicPoison(name), true, name);
  }
  assert.equal(isBasicPoison("a basic note on poison"), false);
  assert.equal(isBasicPoison("Veleno base"), false);
});

// The same thing at five tables: the English row's name, then the name a
// player writes in Italian, French, Spanish and German, read by no word of it
// and by the tags it carries.
const TABLES = [
  ["Potion of Healing", "Pozione di guarigione", "Potion de soins", "Poción de curación", "Heiltrank"],
  ["Torch", "Torcia", "Torche", "Antorcha", "Fackel"],
  ["Rations (1 day)", "Razioni (1 giorno)", "Vivres (1 jour)", "Raciones (1 día)", "Rationen (1 Tag)"],
  ["Arrows (20)", "Frecce (20)", "Flèches (20)", "Flechas (20)", "Pfeile (20)"],
];
const TAGS = [["consumable", "potion", "healing_potion"], ["consumable", "torch"], ["consumable", "food"], ["consumable", "arrows", "carried"]];

test("an English row's name gives its tags; a name in another language gives none until the item carries them", () => {
  for (const [index, [english, ...others]] of TABLES.entries()) {
    for (const tag of TAGS[index]) {
      assert.ok(itemTags({ name: english }).includes(tag), `${english} is not ${tag}`);
    }
    for (const name of others) {
      assert.deepEqual(itemTags({ name }), [], `${name} was read by its words`);
      assert.deepEqual(itemTags({ name, tags: TAGS[index] }), TAGS[index]);
    }
  }
});

test("the engines read a tagged item in any language as its English row", () => {
  for (const name of TABLES[0]) {
    assert.deepEqual(consumableEffect({ name, tags: TAGS[0] }), { kind: "healing", expression: "2d4+2" }, name);
  }
  for (const name of TABLES[1]) {
    assert.deepEqual(carriedLight({ equipment: [{ name, qty: 1, tags: TAGS[1] }] }), { radius: 4, minutes: 60 }, name);
  }
  for (const name of TABLES[3]) {
    assert.equal(ammoKindForItem({ name, tags: TAGS[3] }), "arrows", name);
  }
});

test("an unidentified item is nothing: its name is the party's description", () => {
  assert.deepEqual(itemTags({ name: "Potion of Healing", identified: false }), []);
  assert.deepEqual(itemTags({ name: "a red vial", identified: false, tags: ["potion"] }), []);
});

console.log(`test-item-tags: ${passed} tests passed`);
