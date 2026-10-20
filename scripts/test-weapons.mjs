// Starting-weapon loadouts and suggestion lists from class proficiencies.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SRD_WEAPONS, defaultLoadout, suggestWeapons, weaponNamed } from "../src/lib/srd/weapons.ts";
import { getContentDb } from "../src/lib/content/db.ts";
import srdClasses from "../src/lib/srd/classes.json" with { type: "json" };

const catalogDir = join(dirname(fileURLToPath(import.meta.url)), "../src/lib/classes");
const catalogClasses = readdirSync(catalogDir)
  .filter((file) => file.endsWith(".json") && !file.endsWith("-features.json"))
  .map((file) => JSON.parse(readFileSync(join(catalogDir, file), "utf8")))
  // The classes dir also holds generated data (resources.json); only the
  // catalog files carry a `classes` array.
  .filter((parsed) => Array.isArray(parsed.classes))
  .flatMap((parsed) => parsed.classes);

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

const names = (weapons) => weapons.map((weapon) => weapon.name);

test("weapon table has unique names", () => {
  const all = names(SRD_WEAPONS);
  assert.equal(new Set(all).size, all.length);
});

test("martial classes get longsword and longbow", () => {
  const loadout = names(defaultLoadout(["simple", "martial"]));
  assert.deepEqual(loadout, ["Longsword", "Longbow"]);
});

test("simple-only classes get mace and light crossbow", () => {
  const loadout = names(defaultLoadout(["simple"]));
  assert.deepEqual(loadout, ["Mace", "Light Crossbow"]);
});

test("wizard-style specific list lands on quarterstaff + light crossbow", () => {
  const loadout = names(
    defaultLoadout(["daggers", "darts", "slings", "quarterstaffs", "light crossbows"]),
  );
  assert.deepEqual(loadout, ["Quarterstaff", "Light Crossbow"]);
});

test("finesse-flavored lists prefer the rapier over the longsword", () => {
  const loadout = names(
    defaultLoadout(["simple", "hand crossbows", "longswords", "rapiers", "shortswords"]),
  );
  assert.deepEqual(loadout, ["Rapier", "Hand Crossbow"]);
});

test("monk gets the shortsword", () => {
  assert.equal(names(defaultLoadout(["simple", "shortswords"]))[0], "Shortsword");
});

test("empty proficiencies mean no weapons", () => {
  assert.deepEqual(defaultLoadout([]), []);
  assert.deepEqual(suggestWeapons([]), []);
});

test("every SRD class gets a non-empty loadout", () => {
  const list = srdClasses.classes;
  for (const klass of list) {
    const loadout = defaultLoadout(klass.weapons);
    assert.ok(loadout.length >= 1, `${klass.id} got no weapons`);
  }
});

test("firearm classes start with a pistol, even when martial-trained", () => {
  assert.deepEqual(names(defaultLoadout(["simple", "firearms"])), ["Mace", "Pistol"]);
  assert.deepEqual(
    names(defaultLoadout(["simple", "martial", "firearms", "tech blades"])),
    ["Longsword", "Pistol"],
  );
});

test("sidearms alias expands to the pistol class only", () => {
  assert.deepEqual(names(defaultLoadout(["sidearms"])), ["Pistol"]);
  assert.deepEqual(names(suggestWeapons(["sidearms"])), ["Pistol", "Revolver"]);
});

test("occult alias expands to the ritual kit", () => {
  const suggested = names(suggestWeapons(["occult"]));
  assert.deepEqual(suggested, ["Silvered Stake", "Censer Mace", "Dagger", "Hurled Vial"]);
  assert.ok(names(defaultLoadout(["occult"])).includes("Hurled Vial"));
});

test("tech-blade classes get an exotic melee pick and suggestions", () => {
  assert.deepEqual(names(defaultLoadout(["tech blades"])), ["Chainblade"]);
  const suggested = names(suggestWeapons(["simple", "tech blades"]));
  assert.deepEqual(suggested.slice(0, 3), ["Monoblade", "Shock Baton", "Chainblade"]);
});

test("every weapon term across SRD and catalog classes resolves", () => {
  for (const klass of [...srdClasses.classes, ...catalogClasses]) {
    for (const term of klass.weapons) {
      assert.ok(
        defaultLoadout([term]).length >= 1,
        `${klass.id}: weapon term "${term}" resolves to nothing`,
      );
    }
  }
});

test("every catalog class gets a non-empty loadout", () => {
  for (const klass of catalogClasses) {
    assert.ok(defaultLoadout(klass.weapons).length >= 1, `${klass.id} got no weapons`);
  }
});

test("fighter suggestions include longsword and longbow", () => {
  const suggested = names(suggestWeapons(["simple", "martial"]));
  assert.ok(suggested.includes("Longsword"));
  assert.ok(suggested.includes("Longbow"));
});

test("wizard suggestions are exactly its specific proficiencies", () => {
  const suggested = names(
    suggestWeapons(["daggers", "darts", "slings", "quarterstaffs", "light crossbows"]),
  );
  assert.deepEqual(suggested, ["Dagger", "Dart", "Sling", "Quarterstaff", "Light Crossbow"]);
});

test("suggestions dedupe and respect the cap", () => {
  const suggested = names(suggestWeapons(["longswords", "simple", "martial"], 4));
  assert.equal(suggested.length, 4);
  assert.equal(new Set(suggested).size, 4);
  assert.equal(suggested[0], "Longsword");
});

// A weapon is found by its whole name past a "+N" bonus, also written apart
// or in the book's order; a name that holds one among other words is another
// item, whose row srdName names, and ammunition is no weapon. What a sheet, a
// shop or a stat block names reads the same.
test("the weapon finder reads whole names, never a fragment", () => {
  for (const [name, weapon] of [
    ["+1 long sword", "Longsword"],
    ["Hand crossbows", "Hand Crossbow"],
    ["Crossbow, light", "Light Crossbow"],
    ["Crossbow, heavy", "Heavy Crossbow"],
    ["Crossbow, hand", "Hand Crossbow"],
    ["Battle axe", "Battleaxe"],
    ["Hand axe", "Handaxe"],
    ["War hammer", "Warhammer"],
    ["Morning star", "Morningstar"],
    ["Staff", "Quarterstaff"],
    ["Net", "Net"],
  ]) {
    assert.equal(weaponNamed(name)?.name, weapon, name);
  }
  for (const name of [
    "Signet Ring", "Spikes, Iron", "Chain", "Silver", "Vial", "Hammer", "Bullets, Sling (20)", "Sling bullets", "Blowgun needles",
    "Longsword of the Dawn", "Dagger of Venom", "Angry Hornet", "Bed of Spikes", "Signet of the Magister", "Stone Glance", "Telekinetic Pull", "Nether Bolt", "Tail Spike", "Shock", "Sword", "Bow",
  ]) {
    assert.equal(weaponNamed(name), null, name);
  }
});

// The pack's own rows, where it is installed (CI runs without it): every
// SRD weapon is its weapon, and no other row is one unless the weapon table
// holds its name.
test("every SRD weapon in the pack is its weapon, and nothing else is one", () => {
  const db = getContentDb();
  if (!db) {
    console.log("note: content pack absent; skipping the pack's weapon rows");
    return;
  }
  const rows = db.prepare("SELECT DISTINCT name, kind, document_slug FROM items").all();
  for (const { name } of rows.filter((row) => row.kind === "weapon" && row.document_slug === "wotc-srd")) {
    assert.ok(weaponNamed(name), `${name} is no weapon`);
  }
  const misread = rows
    .filter((row) => row.kind !== "weapon" && row.kind !== "magic_item")
    .filter(({ name }) => weaponNamed(name) && weaponNamed(name).name.toLowerCase() !== name.toLowerCase());
  assert.deepEqual(misread.map(({ name }) => name), []);
});

console.log(`test-weapons: ${passed} tests passed.`);
