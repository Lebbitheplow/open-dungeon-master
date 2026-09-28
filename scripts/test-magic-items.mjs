// The magic-item effects table: that magic-items.json is current with the
// content pack, and that worn/attuned items grant their mechanics.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);
const {
  matchMagicItem,
  magicItemRiders,
  effectiveAbilities,
  mayAttune,
  attunementProblem,
  settleAttunement,
} = await import("../src/lib/srd/magic-items.ts");

// The thirteen damage types and the one keyword the damage engine reads.
const RESISTABLE = [
  "acid", "bludgeoning", "cold", "fire", "force", "lightning", "necrotic",
  "piercing", "poison", "psychic", "radiant", "slashing", "thunder", "nonmagical",
];

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const items = JSON.parse(
  readFileSync(join(root, "src", "lib", "classes", "magic-items.json"), "utf8"),
).items;

const baseAbilities = { str: 10, dex: 14, con: 12, int: 8, wis: 13, cha: 10 };
const attuned = (name) => [{ name, attuned: true }];

test("magic-items.json is not stale against the content pack", () => {
  // Only meaningful when the content DB is present (CI without it skips).
  if (!existsSync(join(root, "data", "content", "open5e.sqlite"))) {
    return;
  }
  const result = spawnSync(
    process.execPath,
    [join(here, "generate-magic-items.mjs"), "--check"],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("the generated table has a real body of items", () => {
  assert.ok(items.length > 50, `only ${items.length} magic items`);
});

test("a flat-AC item grants its bonus only while attuned", () => {
  const cloak = "Cloak of Protection";
  assert.equal(matchMagicItem(cloak)?.requiresAttunement, true);
  // Attuned: +1 AC, +1 saves.
  const on = magicItemRiders(attuned(cloak));
  assert.equal(on.acBonus, 1);
  assert.equal(on.saveBonus, 1);
  // Carried but not attuned: nothing.
  const off = magicItemRiders([{ name: cloak }]);
  assert.equal(off.acBonus, 0);
  assert.equal(off.saveBonus, 0);
});

test("Bracers of Defense are an unarmored bonus, kept separate", () => {
  const riders = magicItemRiders(attuned("Bracers of Defense"));
  assert.equal(riders.acUnarmoredBonus, 2);
  assert.equal(riders.acBonus, 0);
});

test("an ability-setting item raises the score, never lowers it", () => {
  // Gauntlets set STR to 19.
  const raised = effectiveAbilities(baseAbilities, attuned("Gauntlets of Ogre Power"));
  assert.equal(raised.str, 19);
  assert.equal(raised.dex, 14);
  // A character already stronger keeps their score.
  const strong = effectiveAbilities({ ...baseAbilities, str: 20 }, attuned("Gauntlets of Ogre Power"));
  assert.equal(strong.str, 20);
  // Unattuned: no change.
  assert.deepEqual(effectiveAbilities(baseAbilities, [{ name: "Gauntlets of Ogre Power" }]), baseAbilities);
});

test("resistances come off worn items and dedupe", () => {
  const resistItem = items.find((item) => item.effects.some((e) => e.kind === "resistance"));
  const riders = magicItemRiders([{ name: resistItem.name, attuned: true }]);
  assert.ok(riders.resistances.length >= 1);
  // The same item twice does not double the list.
  const twice = magicItemRiders([
    { name: resistItem.name, attuned: true },
    { name: resistItem.name, attuned: true },
  ]);
  assert.deepEqual(new Set(twice.resistances), new Set(riders.resistances));
});

test("a non-attunement item works just by being carried", () => {
  const free = items.find((item) => !item.requiresAttunement && item.effects.length);
  if (!free) {
    return;
  }
  const riders = magicItemRiders([{ name: free.name }]);
  assert.ok(riders.sources.includes(free.name));
});

test("every generated item is well formed", () => {
  const names = new Set();
  for (const item of items) {
    assert.ok(item.name.length > 0);
    assert.equal(item.match, item.name.toLowerCase());
    assert.equal(names.has(item.match), false, `duplicate ${item.match}`);
    names.add(item.match);
    // A row with no effect is in the table for one reason: who may attune.
    assert.ok(item.effects.length > 0 || item.attunedBy, item.name);
    assert.equal(typeof item.requiresAttunement, "boolean", item.name);
    for (const effect of item.effects) {
      if (effect.kind === "resistance") {
        for (const type of effect.types) {
          assert.ok(RESISTABLE.includes(type), `${item.name} resists "${type}"`);
        }
      }
    }
  }
});

test("a name matches whole, by name or by pack slug, never by a fragment", () => {
  assert.equal(matchMagicItem("+1 Cloak of Protection")?.name, "Cloak of Protection");
  assert.equal(matchMagicItem("cloak  of PROTECTION")?.name, "Cloak of Protection");
  assert.equal(matchMagicItem("Ring of Protection (spare)")?.name, "Ring of Protection");
  assert.equal(matchMagicItem("Grandmother's band", "ring-of-protection")?.name, "Ring of Protection");
  assert.equal(matchMagicItem("Ring of Resistance (Fire)")?.name, "Ring of Fire Resistance");
  for (const name of ["a mundane rope", "Pouch", "Potion", "Staff", "Ring", "Basilisk Fang", "Cloak of Protection of the Owl"]) {
    assert.equal(matchMagicItem(name), null, name);
  }
});

test("an item in the pack gives nothing once wearing is explicit, unless its text says carried", () => {
  const worn = [{ name: "Leather", equipped: true }];
  assert.equal(magicItemRiders([...worn, { name: "Ring of Protection", attuned: true, equipped: false }]).acBonus, 0);
  assert.equal(magicItemRiders([...worn, { name: "Ring of Protection", attuned: true, equipped: true }]).acBonus, 1);
  // "While the sword is on your person".
  assert.equal(magicItemRiders([...worn, { name: "Luck Blade", attuned: true, equipped: false }]).saveBonus, 1);
});

test("two copies of an item are one item's magic", () => {
  const riders = magicItemRiders([
    { name: "Ring of Protection", attuned: true },
    { name: "Ring of Protection (spare)", attuned: true },
  ]);
  assert.equal(riders.acBonus, 1);
  assert.equal(riders.saveBonus, 1);
});

test("an item gives its magic only to someone its text lets attune", () => {
  const staff = [{ name: "Staff of Power", attuned: true }];
  assert.equal(magicItemRiders(staff, { class: "fighter" }).acBonus, 0);
  assert.equal(magicItemRiders(staff, { class: "wizard" }).acBonus, 2);
  assert.equal(magicItemRiders(staff, { class: "fighter", classes: [{ id: "fighter" }, { id: "warlock" }] }).saveBonus, 2);
  assert.equal(mayAttune(matchMagicItem("Holy Avenger"), { class: "paladin" }), true);
  assert.equal(mayAttune(matchMagicItem("Holy Avenger"), { class: "fighter" }), false);
  assert.equal(mayAttune(matchMagicItem("Wand of Fireballs"), { class: "fighter", spellcasting: null }), false);
  assert.equal(mayAttune(matchMagicItem("Wand of Fireballs"), { class: "bard", spellcasting: { ability: "cha" } }), true);
  assert.equal(mayAttune(matchMagicItem("Talisman of Pure Good"), { alignment: "Lawful Good" }), true);
  assert.equal(mayAttune(matchMagicItem("Talisman of Pure Good"), { alignment: "Chaotic Evil" }), false);
});

test("attunement is refused with the reason, and settled the same way on a write", () => {
  const fighter = { name: "Brakk", class: "fighter" };
  assert.match(attunementProblem({ name: "Staff of Power" }, [], fighter), /only by/);
  assert.match(attunementProblem({ name: "Hair Pick of Protection" }, [], fighter), /needs no attunement/);
  assert.match(
    attunementProblem({ name: "Ring of Protection (spare)" }, [{ name: "Ring of Protection", attuned: true }], fighter),
    /one copy/,
  );
  assert.equal(attunementProblem({ name: "Ring of Protection" }, [], fighter), null);
  // A name the table does not know may be a narrated item: it attunes.
  assert.equal(attunementProblem({ name: "Grandfather's Compass" }, [], fighter), null);
  const settled = settleAttunement(
    ["Staff of Power", "Ring of Protection", "Ring of Protection", "Hair Pick of Protection", "Cloak of Protection", "Robe of Stars", "Luck Blade"].map(
      (name) => ({ name, attuned: true }),
    ),
    fighter,
  );
  assert.deepEqual(
    settled.filter((item) => item.attuned).map((item) => item.name),
    ["Ring of Protection", "Cloak of Protection", "Robe of Stars"],
  );
});

test("the rows a person corrected against the item's own text", () => {
  assert.equal(matchMagicItem("Vorpal Sword"), null);
  assert.equal(matchMagicItem("Defender"), null);
  assert.equal(matchMagicItem("Asi"), null);
  assert.deepEqual(matchMagicItem("Staff of Power").effects, [
    { kind: "ac_bonus", amount: 2 },
    { kind: "save_bonus", amount: 2 },
  ]);
  assert.deepEqual(matchMagicItem("Belt of Storm Giant Strength").effects, [
    { kind: "set_ability", ability: "str", score: 29 },
  ]);
  assert.deepEqual(matchMagicItem("Red Dragon Scale Mail").effects, [
    { kind: "ac_bonus", amount: 1 },
    { kind: "resistance", types: ["fire"] },
  ]);
  for (const potion of ["Potion of Ebbing Strength", "Potion of Malleability", "Wisp of the Void"]) {
    assert.equal(matchMagicItem(potion), null, potion);
  }
});

console.log(`test-magic-items: ${passed} passed`);
