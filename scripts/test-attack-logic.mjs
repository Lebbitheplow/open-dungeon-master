// Pure attack math for the pc_attack engine: weapon resolution, to-hit and
// damage profiles, and hit adjudication.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const {
  resolveAttackWeapon,
  weaponAttackProfile,
  spellAttackProfile,
  adjudicateHit,
  ragingMeleeBonus,
  splitDamage,
} = await import("../src/lib/dm/attack-logic.ts");
const { matchWeapon, isWeaponProficient } = await import("../src/lib/srd/weapons.ts");
const { combatRiders } = await import("../src/lib/srd/feature-effects.ts");

const ridersFor = (klass, level, ...names) =>
  combatRiders({ class: klass, level, features: names.map((name) => ({ name })) });

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

test("rage bonus applies to melee Strength attacks only", () => {
  const raging = { conditions: ["raging"], level: 5 };
  assert.equal(ragingMeleeBonus(raging, { ranged: false, ability: "str" }), 2);
  // A finesse weapon swung with Dexterity, and any bow, get nothing.
  assert.equal(ragingMeleeBonus(raging, { ranged: false, ability: "dex" }), 0);
  assert.equal(ragingMeleeBonus(raging, { ranged: true, ability: "str" }), 0);
  // Not raging: nothing at all.
  assert.equal(
    ragingMeleeBonus({ conditions: [], level: 5 }, { ranged: false, ability: "str" }),
    0,
  );
});

test("rage bonus scales at levels 9 and 16", () => {
  const melee = { ranged: false, ability: "str" };
  assert.equal(ragingMeleeBonus({ conditions: ["raging"], level: 8 }, melee), 2);
  assert.equal(ragingMeleeBonus({ conditions: ["raging"], level: 9 }, melee), 3);
  assert.equal(ragingMeleeBonus({ conditions: ["raging"], level: 16 }, melee), 4);
});

test("weapon profiles report which ability drove the attack", () => {
  // STR 3 / DEX 1: a finesse rapier uses Strength here.
  const rapier = weaponAttackProfile(derived, ["martial"], resolveAttackWeapon([], [], "rapier"));
  assert.equal(rapier.ability, "str");
  // STR -1 / DEX 4: the same rapier flips to Dexterity.
  const finesse = weaponAttackProfile(dexDerived, ["martial"], resolveAttackWeapon([], [], "rapier"));
  assert.equal(finesse.ability, "dex");
  const bow = weaponAttackProfile(dexDerived, ["martial"], resolveAttackWeapon([], [], "shortbow"));
  assert.equal(bow.ability, "dex");
});

test("a magic weapon's name adds its bonus to hit and damage", () => {
  const plain = weaponAttackProfile(derived, ["martial"], resolveAttackWeapon([], [], "longsword"));
  const magic = weaponAttackProfile(
    derived,
    ["martial"],
    resolveAttackWeapon([{ name: "+2 Longsword", qty: 1 }], ["martial"], "longsword"),
  );
  assert.equal(magic.toHit, plain.toHit + 2);
  assert.equal(magic.magicBonus, 2);
  assert.equal(plain.damageExpression, "1d8+3");
  assert.equal(magic.damageExpression, "1d8+5");
});

test("versatile weapons step up their die in two hands", () => {
  const oneHanded = weaponAttackProfile(derived, ["martial"], resolveAttackWeapon([], [], "longsword"));
  const twoHanded = weaponAttackProfile(
    derived,
    ["martial"],
    resolveAttackWeapon([], [], "longsword"),
    { twoHanded: true },
  );
  assert.equal(oneHanded.damageExpression, "1d8+3");
  assert.equal(twoHanded.damageExpression, "1d10+3");
  assert.equal(twoHanded.twoHanded, true);
  // A greatsword is two-handed whether or not the caller says so.
  const greatsword = weaponAttackProfile(derived, ["martial"], resolveAttackWeapon([], [], "greatsword"));
  assert.equal(greatsword.twoHanded, true);
});

test("Archery lifts ranged to-hit only", () => {
  const archery = ridersFor("fighter", 5, "Fighting Style: Archery");
  const bow = weaponAttackProfile(dexDerived, ["martial"], resolveAttackWeapon([], [], "shortbow"), {
    riders: archery,
  });
  const sword = weaponAttackProfile(dexDerived, ["martial"], resolveAttackWeapon([], [], "longsword"), {
    riders: archery,
  });
  const plainBow = weaponAttackProfile(dexDerived, ["martial"], resolveAttackWeapon([], [], "shortbow"));
  const plainSword = weaponAttackProfile(dexDerived, ["martial"], resolveAttackWeapon([], [], "longsword"));
  assert.equal(bow.toHit, plainBow.toHit + 2);
  assert.equal(sword.toHit, plainSword.toHit);
  assert.match(bow.riderNotes.join(" "), /Archery/);
});

test("Dueling pays out one-handed melee only", () => {
  const dueling = ridersFor("fighter", 5, "Fighting Style: Dueling");
  const oneHanded = weaponAttackProfile(derived, ["martial"], resolveAttackWeapon([], [], "longsword"), {
    riders: dueling,
  });
  assert.equal(oneHanded.damageExpression, "1d8+5");
  // Both hands on the same weapon is not Dueling.
  const bothHands = weaponAttackProfile(derived, ["martial"], resolveAttackWeapon([], [], "longsword"), {
    riders: dueling,
    twoHanded: true,
  });
  assert.equal(bothHands.damageExpression, "1d10+3");
  // Neither is a bow.
  const bow = weaponAttackProfile(derived, ["martial"], resolveAttackWeapon([], [], "shortbow"), {
    riders: dueling,
  });
  assert.equal(bow.damageExpression, "1d6+1");
});

test("the off-hand swing loses its modifier without the style", () => {
  const untrained = weaponAttackProfile(derived, ["martial"], resolveAttackWeapon([], [], "shortsword"), {
    offHand: true,
  });
  assert.equal(untrained.damageExpression, "1d6");
  const trained = weaponAttackProfile(derived, ["martial"], resolveAttackWeapon([], [], "shortsword"), {
    offHand: true,
    riders: ridersFor("ranger", 5, "Fighting Style: Two-Weapon Fighting"),
  });
  assert.equal(trained.damageExpression, "1d6+3");
});

test("Martial Arts arms the monk's unarmed strike", () => {
  const monk = ridersFor("monk", 5, "Martial Arts");
  const fist = weaponAttackProfile(dexDerived, [], resolveAttackWeapon([], [], "unarmed"), {
    riders: monk,
  });
  // DEX 4 beats STR -1, and level 5 rolls a d6.
  assert.equal(fist.damageExpression, "1d6+4");
  assert.equal(fist.ability, "dex");
  // Without the feature it is the SRD's 1 + STR.
  const untrained = weaponAttackProfile(dexDerived, [], resolveAttackWeapon([], [], "unarmed"));
  assert.equal(untrained.damageExpression, "1-1");
});

test("only finesse and ranged weapons can carry Sneak Attack", () => {
  const rapier = weaponAttackProfile(derived, ["martial"], resolveAttackWeapon([], [], "rapier"));
  const bow = weaponAttackProfile(derived, ["martial"], resolveAttackWeapon([], [], "shortbow"));
  const maul = weaponAttackProfile(derived, ["martial"], resolveAttackWeapon([], [], "maul"));
  assert.equal(rapier.sneakEligible, true);
  assert.equal(bow.sneakEligible, true);
  assert.equal(maul.sneakEligible, false);
});

test("an expanded crit range crits without changing what hits", () => {
  // A natural 19 against AC 25 still misses, and still is not a crit.
  assert.deepEqual(adjudicateHit(19, undefined, 25, { natural: 19, critRange: 19 }), {
    hit: false,
    crit: false,
  });
  // A natural 19 that beats the AC crits for a Champion.
  assert.deepEqual(adjudicateHit(24, undefined, 20, { natural: 19, critRange: 19 }), {
    hit: true,
    crit: true,
  });
  // Without the feature the same roll is an ordinary hit.
  assert.deepEqual(adjudicateHit(24, undefined, 20, { natural: 19 }), {
    hit: true,
    crit: false,
  });
  // A natural 1 is still a miss no matter the range.
  assert.deepEqual(adjudicateHit(30, "nat1", 10, { natural: 1, critRange: 18 }), {
    hit: false,
    crit: false,
  });
  // A natural 20 always hits and crits.
  assert.deepEqual(adjudicateHit(2, "nat20", 30, { natural: 20 }), { hit: true, crit: true });
});

test("the heavy property lands on the profile for the Small-creature rule", () => {
  const derived = {
    abilityMods: { str: 3, dex: 1, con: 2, int: 0, wis: 0, cha: 0 },
    proficiencyBonus: 2,
  };
  const greataxe = weaponAttackProfile(derived, ["martial"], {
    displayName: "Greataxe",
    srd: matchWeapon("Greataxe"),
    unarmed: false,
  });
  assert.equal(greataxe.heavy, true);
  const shortsword = weaponAttackProfile(derived, ["martial"], {
    displayName: "Shortsword",
    srd: matchWeapon("Shortsword"),
    unarmed: false,
  });
  assert.equal(shortsword.heavy, false);
});

console.log(`test-attack-logic: ${passed} tests passed`);
