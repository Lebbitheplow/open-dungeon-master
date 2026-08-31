// Ammunition tracking: which weapon draws on which inventory line, how a
// count is read from a line that carries it in the name, and the half-back
// recovery after a fight.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const {
  ammoCount,
  ammoKindForWeapon,
  findAmmo,
  recoveredAmmo,
  spendAmmo,
  withAmmoCount,
} = await import("../src/lib/srd/ammunition.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

test("every ammunition weapon maps to a kind", () => {
  assert.equal(ammoKindForWeapon("Longbow"), "arrows");
  assert.equal(ammoKindForWeapon("Shortbow"), "arrows");
  assert.equal(ammoKindForWeapon("Heavy Crossbow"), "bolts");
  assert.equal(ammoKindForWeapon("Hand Crossbow"), "bolts");
  assert.equal(ammoKindForWeapon("Sling"), "bullets");
  assert.equal(ammoKindForWeapon("Revolver"), "bullets");
  assert.equal(ammoKindForWeapon("Blowgun"), "needles");
});

test("melee weapons draw on nothing", () => {
  assert.equal(ammoKindForWeapon("Longsword"), null);
  assert.equal(ammoKindForWeapon("Greataxe"), null);
  // A thrown weapon is its own ammunition; it must not consume arrows.
  assert.equal(ammoKindForWeapon("Handaxe"), null);
});

test("a count written into the name is read from it", () => {
  assert.equal(ammoCount({ name: "Arrows (20)", qty: 1 }), 20);
  // An explicit qty is authoritative once someone has edited it.
  assert.equal(ammoCount({ name: "Arrows (20)", qty: 7 }), 7);
  assert.equal(ammoCount({ name: "Arrows", qty: 12 }), 12);
});

test("the right line is found for each kind", () => {
  const kit = [
    { name: "Longsword", qty: 1 },
    { name: "Crossbow Bolts (20)", qty: 1 },
    { name: "Arrows (30)", qty: 1 },
  ];
  assert.equal(findAmmo(kit, "arrows").count, 30);
  assert.equal(findAmmo(kit, "bolts").count, 20);
  assert.equal(findAmmo(kit, "needles"), null);
});

test("a word inside another word does not count as ammunition", () => {
  // "Bolt of silk" is cloth, not crossbow bolts; the word boundary check is
  // what stops a merchant's bolt of cloth arming a crossbow.
  assert.equal(findAmmo([{ name: "Arrowroot Powder", qty: 3 }], "arrows"), null);
});

test("firing spends one and reports the remainder", () => {
  const kit = [{ name: "Arrows (20)", qty: 1 }];
  const spend = spendAmmo(kit, "Longbow", "Kara");
  assert.equal(spend.ok, true);
  assert.equal(spend.remaining, 19);
  assert.equal(spend.kind, "arrows");
});

test("an empty quiver refuses the shot by name", () => {
  const spend = spendAmmo([{ name: "Longbow", qty: 1 }], "Longbow", "Kara");
  assert.equal(spend.ok, false);
  assert.match(spend.error, /Kara is out of arrows/);
  assert.match(spend.error, /Longbow/);
});

test("a melee swing is not an ammunition question at all", () => {
  assert.equal(spendAmmo([], "Longsword", "Brom"), null);
});

test("the rewritten line keeps name and qty agreeing", () => {
  const kit = [{ name: "Arrows (20)", qty: 1 }];
  const next = withAmmoCount(kit, 0, 19);
  assert.equal(next[0].name, "Arrows (19)");
  assert.equal(next[0].qty, 19);
  // The original is untouched: the caller decides what to persist.
  assert.equal(kit[0].name, "Arrows (20)");
});

test("the last round removes the line", () => {
  assert.deepEqual(withAmmoCount([{ name: "Arrows", qty: 1 }], 0, 0), []);
});

test("half the spent rounds come back, rounded down", () => {
  assert.equal(recoveredAmmo(0), 0);
  assert.equal(recoveredAmmo(1), 0);
  assert.equal(recoveredAmmo(7), 3);
  assert.equal(recoveredAmmo(20), 10);
});

console.log(`ammunition: ${passed} tests passed`);
