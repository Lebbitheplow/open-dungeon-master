// Pure attack math for the pc_attack engine: weapon resolution, to-hit and
// damage profiles, and hit adjudication.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { resolveAttackWeapon, weaponAttackProfile, spellAttackProfile, adjudicateHit, splitDamage, ammoKindFor } =
  await import("../src/lib/dm/attack-logic.ts");
const { matchWeapon, isWeaponProficient } = await import("../src/lib/srd/weapons.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

const derived = {
  proficiencyBonus: 3,
  abilityMods: { str: 3, dex: 1, con: 2, int: 0, wis: 1, cha: -1 },
};
const dexDerived = {
  proficiencyBonus: 2,
  abilityMods: { str: -1, dex: 4, con: 1, int: 1, wis: 2, cha: 0 },
};

test("matchWeapon: exact, plural, containment both ways", () => {
  assert.equal(matchWeapon("Longsword")?.name, "Longsword");
  assert.equal(matchWeapon("longswords")?.name, "Longsword");
  assert.equal(matchWeapon("Longsword of the Dawn")?.name, "Longsword");
  assert.equal(matchWeapon("hand crossbow")?.name, "Hand Crossbow");
  assert.equal(matchWeapon("a rusty pipe"), null);
});

test("isWeaponProficient: category and specific terms", () => {
  const longbow = matchWeapon("longbow");
  assert.equal(isWeaponProficient(["martial"], longbow), true);
  assert.equal(isWeaponProficient(["simple"], longbow), false);
  assert.equal(isWeaponProficient(["simple", "longbows"], longbow), true);
});

test("resolveAttackWeapon: named weapon matches carried equipment", () => {
  const resolved = resolveAttackWeapon(
    [{ name: "Longsword of the Dawn", qty: 1 }],
    ["martial"],
    "longsword",
  );
  assert.equal(resolved.displayName, "Longsword of the Dawn");
  assert.equal(resolved.srd?.name, "Longsword");
});

test("resolveAttackWeapon: no arg picks best proficient carried weapon", () => {
  const resolved = resolveAttackWeapon(
    [
      { name: "Dagger", qty: 1 },
      { name: "Greatsword", qty: 1 },
      { name: "Rope", qty: 1 },
    ],
    ["martial"],
    undefined,
  );
  assert.equal(resolved.srd?.name, "Greatsword");
});

test("resolveAttackWeapon: proficient weapon beats stronger unproficient one", () => {
  const resolved = resolveAttackWeapon(
    [
      { name: "Dagger", qty: 1 },
      { name: "Greatsword", qty: 1 },
    ],
    ["simple"],
    undefined,
  );
  assert.equal(resolved.srd?.name, "Dagger");
});

test("resolveAttackWeapon: nothing usable falls back to unarmed", () => {
  const resolved = resolveAttackWeapon([{ name: "Rope", qty: 1 }], ["simple"], undefined);
  assert.equal(resolved.unarmed, true);
  const profile = weaponAttackProfile(derived, ["simple"], resolved);
  assert.equal(profile.toHit, 6); // str 3 + pb 3, unarmed is proficient
  assert.equal(profile.damageExpression, "1+3");
});

test("resolveAttackWeapon: unknown named weapon is improvised", () => {
  const resolved = resolveAttackWeapon([], ["martial"], "barstool");
  assert.equal(resolved.srd, null);
  const profile = weaponAttackProfile(derived, ["martial"], resolved);
  assert.equal(profile.improvised, true);
  assert.equal(profile.toHit, 3); // str only, no proficiency
  assert.equal(profile.damageExpression, "1d4+3");
});

test("weaponAttackProfile: melee STR with proficiency", () => {
  const profile = weaponAttackProfile(derived, ["martial"], resolveAttackWeapon([], [], "longsword"));
  assert.equal(profile.toHit, 6);
  assert.equal(profile.damageExpression, "1d8+3");
  assert.equal(profile.damageType, "slashing");
  assert.equal(profile.ranged, false);
  assert.equal(profile.reachTiles, 1);
});

test("weaponAttackProfile: finesse takes the better of STR/DEX", () => {
  const profile = weaponAttackProfile(dexDerived, ["martial"], resolveAttackWeapon([], [], "rapier"));
  assert.equal(profile.toHit, 6); // dex 4 + pb 2
  assert.equal(profile.damageExpression, "1d8+4");
});

test("weaponAttackProfile: ranged uses DEX and weapon range", () => {
  const profile = weaponAttackProfile(dexDerived, ["martial"], resolveAttackWeapon([], [], "longbow"));
  assert.equal(profile.toHit, 6);
  assert.equal(profile.ranged, true);
  assert.equal(profile.rangeTiles, 30); // 150 ft
});

test("weaponAttackProfile: thrown ranged-kind (dart) is finesse", () => {
  const profile = weaponAttackProfile(dexDerived, ["simple"], resolveAttackWeapon([], [], "dart"));
  assert.equal(profile.toHit, 6); // finesse: dex 4 + pb 2
  assert.equal(profile.thrown, true);
});

test("weaponAttackProfile: thrown melee weapon keeps STR", () => {
  const profile = weaponAttackProfile(derived, ["simple"], resolveAttackWeapon([], [], "javelin"));
  assert.equal(profile.toHit, 6); // str 3 + pb 3
  assert.equal(profile.thrown, true);
  assert.equal(profile.rangeTiles, 6); // 30 ft
});

test("weaponAttackProfile: reach weapon gets 2 tiles", () => {
  const profile = weaponAttackProfile(derived, ["martial"], resolveAttackWeapon([], [], "whip"));
  assert.equal(profile.reachTiles, 2);
});

test("weaponAttackProfile: negative modifier formats correctly", () => {
  const profile = weaponAttackProfile(dexDerived, [], resolveAttackWeapon([], [], "club"));
  assert.equal(profile.toHit, -1);
  assert.equal(profile.damageExpression, "1d4-1");
});

test("splitDamage handles dice, flat, and odd entries", () => {
  assert.deepEqual(splitDamage("1d8 slashing"), { dice: "1d8", type: "slashing" });
  assert.deepEqual(splitDamage("1 piercing"), { dice: "1", type: "piercing" });
  assert.deepEqual(splitDamage("0 (restrains)"), { dice: "0", type: "restrains" });
});

test("spellAttackProfile uses the sheet spell attack bonus", () => {
  const profile = spellAttackProfile({ spellAttack: 7 }, "Fire Bolt", "2d10", "fire");
  assert.equal(profile.toHit, 7);
  assert.equal(profile.damageExpression, "2d10");
  assert.equal(profile.ranged, true);
  assert.equal(spellAttackProfile({ spellAttack: null }, "Fire Bolt", "1d10", "fire"), null);
});

test("adjudicateHit: nat1 always misses, nat20 always crits", () => {
  assert.deepEqual(adjudicateHit(25, "nat1", 10), { hit: false, crit: false });
  assert.deepEqual(adjudicateHit(8, "nat20", 18), { hit: true, crit: true });
  assert.deepEqual(adjudicateHit(15, undefined, 15), { hit: true, crit: false });
  assert.deepEqual(adjudicateHit(14, undefined, 15), { hit: false, crit: false });
});

test("ammoKindFor maps weapon families", () => {
  assert.equal(ammoKindFor(matchWeapon("longbow")), "arrows");
  assert.equal(ammoKindFor(matchWeapon("heavy crossbow")), "bolts");
  assert.equal(ammoKindFor(matchWeapon("sling")), "sling bullets");
  assert.equal(ammoKindFor(matchWeapon("blowgun")), "needles");
  assert.equal(ammoKindFor(matchWeapon("pistol")), "rounds");
  assert.equal(ammoKindFor(matchWeapon("longsword")), null);
  assert.equal(ammoKindFor(null), null);
});

console.log(`test-attack-logic: ${passed} tests passed`);
