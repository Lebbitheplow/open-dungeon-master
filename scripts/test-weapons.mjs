// Starting-weapon loadouts and suggestion lists from class proficiencies.
import assert from "node:assert/strict";
import { SRD_WEAPONS, defaultLoadout, suggestWeapons } from "../src/lib/srd/weapons.ts";
import srdClasses from "../src/lib/srd/classes.json" with { type: "json" };

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

console.log(`test-weapons: ${passed} tests passed.`);
