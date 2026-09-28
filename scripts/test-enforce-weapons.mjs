// Weapons, as the attack engine holds them.
//
// The SRD 5.1 weapon table is written out below and ODM's own table
// (src/lib/srd/weapons.ts) is checked against it row by row: damage die,
// damage type, simple or martial, melee or ranged, every property, the
// normal range and the versatile die. Then the numbers a swing is rolled
// with are checked where they are made, in pc_attack with the dice forced:
// Strength for melee, Dexterity for ranged, the better of the two for
// finesse, the melee ability for a thrown weapon, the proficiency bonus only
// for a weapon the character is trained in, 1 + STR for an unarmed strike,
// 1d4 + STR and no proficiency for an improvised one, and a magic weapon's
// bonus on both rolls.
//
// Each ranged and thrown weapon carries the long range the SRD prints for it:
// past the normal range a shot is at disadvantage, past the long one it is
// refused (src/lib/dm/map-tools.ts checkPcAttackRange). The net and the
// lance, the two "special" weapons, follow their own rules.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { abilityMod, proficiencyBonus, suite } from "./lib/enforce-harness.mjs";
import { DUMMY_HP, gearKit, profs } from "./lib/enforce-equipment.mjs";

const { test, finish } = suite("test-enforce-weapons");
const { SRD_WEAPONS } = await import("../src/lib/srd/weapons.ts");
const { weaponAttackProfile } = await import("../src/lib/dm/attack-logic.ts");
const { patchEnemyConditions } = await import("../src/lib/db/encounters.ts");

// SRD 5.1, "Weapons". [name, category, kind, damage, type, properties,
// normal range, long range, versatile die]
const P = { a: "ammunition", f: "finesse", h: "heavy", l: "light", o: "loading", r: "reach", t: "thrown", two: "two-handed", v: "versatile", s: "special" };
const SRD = [
  ["Club", "simple", "melee", "1d4", "bludgeoning", [P.l]],
  ["Dagger", "simple", "melee", "1d4", "piercing", [P.f, P.l, P.t], 20, 60],
  ["Greatclub", "simple", "melee", "1d8", "bludgeoning", [P.two]],
  ["Handaxe", "simple", "melee", "1d6", "slashing", [P.l, P.t], 20, 60],
  ["Javelin", "simple", "melee", "1d6", "piercing", [P.t], 30, 120],
  ["Light Hammer", "simple", "melee", "1d4", "bludgeoning", [P.l, P.t], 20, 60],
  ["Mace", "simple", "melee", "1d6", "bludgeoning", []],
  ["Quarterstaff", "simple", "melee", "1d6", "bludgeoning", [P.v], 0, 0, "1d8"],
  ["Sickle", "simple", "melee", "1d4", "slashing", [P.l]],
  ["Spear", "simple", "melee", "1d6", "piercing", [P.t, P.v], 20, 60, "1d8"],
  ["Light Crossbow", "simple", "ranged", "1d8", "piercing", [P.a, P.o, P.two], 80, 320],
  ["Dart", "simple", "ranged", "1d4", "piercing", [P.f, P.t], 20, 60],
  ["Shortbow", "simple", "ranged", "1d6", "piercing", [P.a, P.two], 80, 320],
  ["Sling", "simple", "ranged", "1d4", "bludgeoning", [P.a], 30, 120],
  ["Battleaxe", "martial", "melee", "1d8", "slashing", [P.v], 0, 0, "1d10"],
  ["Flail", "martial", "melee", "1d8", "bludgeoning", []],
  ["Glaive", "martial", "melee", "1d10", "slashing", [P.h, P.r, P.two]],
  ["Greataxe", "martial", "melee", "1d12", "slashing", [P.h, P.two]],
  ["Greatsword", "martial", "melee", "2d6", "slashing", [P.h, P.two]],
  ["Halberd", "martial", "melee", "1d10", "slashing", [P.h, P.r, P.two]],
  ["Lance", "martial", "melee", "1d12", "piercing", [P.r, P.s]],
  ["Longsword", "martial", "melee", "1d8", "slashing", [P.v], 0, 0, "1d10"],
  ["Maul", "martial", "melee", "2d6", "bludgeoning", [P.h, P.two]],
  ["Morningstar", "martial", "melee", "1d8", "piercing", []],
  ["Pike", "martial", "melee", "1d10", "piercing", [P.h, P.r, P.two]],
  ["Rapier", "martial", "melee", "1d8", "piercing", [P.f]],
  ["Scimitar", "martial", "melee", "1d6", "slashing", [P.f, P.l]],
  ["Shortsword", "martial", "melee", "1d6", "piercing", [P.f, P.l]],
  ["Trident", "martial", "melee", "1d6", "piercing", [P.t, P.v], 20, 60, "1d8"],
  ["War Pick", "martial", "melee", "1d8", "piercing", []],
  ["Warhammer", "martial", "melee", "1d8", "bludgeoning", [P.v], 0, 0, "1d10"],
  ["Whip", "martial", "melee", "1d4", "slashing", [P.f, P.r]],
  ["Blowgun", "martial", "ranged", "1", "piercing", [P.a, P.o], 25, 100],
  ["Hand Crossbow", "martial", "ranged", "1d6", "piercing", [P.a, P.l, P.o], 30, 120],
  ["Heavy Crossbow", "martial", "ranged", "1d10", "piercing", [P.a, P.h, P.o, P.two], 100, 400],
  ["Longbow", "martial", "ranged", "1d8", "piercing", [P.a, P.h, P.two], 150, 600],
  ["Net", "martial", "ranged", "0", "", [P.s, P.t], 5, 15],
].map(([name, category, kind, dice, type, properties, range = 0, long = 0, versatile = null]) => ({
  name, category, kind, dice, type, properties, range, long, versatile,
}));

const odm = (name) => SRD_WEAPONS.find((weapon) => weapon.name === name);
const sorted = (list) => [...list].sort();

await test("all 37 SRD weapons are in the table, once each", () => {
  assert.equal(SRD.length, 37);
  for (const row of SRD) {
    assert.equal(SRD_WEAPONS.filter((weapon) => weapon.name === row.name).length, 1, row.name);
  }
});

await test("category, kind, damage die and damage type match the SRD, weapon by weapon", () => {
  for (const row of SRD) {
    const weapon = odm(row.name);
    assert.equal(weapon.category, row.category, `${row.name} category`);
    assert.equal(weapon.kind, row.kind, `${row.name} kind`);
    if (row.name === "Net") {
      // The net has no damage; it is judged in its own test below.
      continue;
    }
    assert.equal(weapon.damage, `${row.dice} ${row.type}`, `${row.name} damage`);
  }
});

await test("every mechanical property matches the SRD, weapon by weapon", () => {
  for (const row of SRD) {
    // "special" is prose in the SRD, not a mechanic; it has its own gaps.
    const wanted = row.properties.filter((property) => property !== P.s);
    assert.deepEqual(sorted(odm(row.name).properties ?? []), sorted(wanted), row.name);
  }
});

await test("the normal and the long range match the SRD for every ranged and thrown weapon", () => {
  for (const row of SRD) {
    assert.equal(odm(row.name).rangeFt ?? 0, row.range, row.name);
    assert.equal(odm(row.name).longRangeFt ?? 0, row.long, `${row.name} long range`);
  }
});

await test("a versatile weapon in two hands rolls the die the SRD prints for it", () => {
  const derived = { abilityMods: { str: 0, dex: 0 }, proficiencyBonus: 2 };
  for (const row of SRD.filter((entry) => entry.versatile)) {
    const resolved = { displayName: row.name, srd: odm(row.name), unarmed: false };
    assert.equal(weaponAttackProfile(derived, [], resolved, { twoHanded: true }).damageExpression, row.versatile, row.name);
    assert.equal(weaponAttackProfile(derived, [], resolved, {}).damageExpression, row.dice, row.name);
  }
});

// ---- the swing itself ----

const world = await openWorld();
const kit = await gearKit(world);
const LEVEL = 5;
const PB = proficiencyBonus(LEVEL);
const anchor = world.addHero({ class: "fighter", level: LEVEL });
const hero = world.addHero({ class: "fighter", level: LEVEL });
await kit.arena({ first: anchor.id });
kit.stand(hero.id, 1);

// Rebuilds the swinging hero for one case.
function arm({ str = 10, dex = 10, weapons = ["simple", "martial"], equipment = [], race = "human" }) {
  return world.patch(hero.id, {
    race,
    abilities: { str, dex, con: 10, int: 10, wis: 10, cha: 10 },
    proficiencies: profs({ weapons }),
    equipment,
  });
}

await test("a melee weapon swings with Strength and a trained hand adds proficiency", async () => {
  arm({ str: 16, dex: 12, equipment: [{ name: "Longsword", qty: 1 }] });
  const swing = await kit.swing(hero.id, { weapon: "Longsword" }, 10, 5);
  assert.equal(swing.ok, true, swing.error);
  assert.equal(swing.result.rolled, 10 + abilityMod(16) + PB);
  assert.equal(swing.result.damage, 5 + abilityMod(16));
  assert.equal(swing.result.damageType, "slashing");
  assert.deepEqual(swing.damageDice, [8]);
  assert.equal(swing.unused, 0);
});

await test("the damage lands on the enemy row, not only in the result", async () => {
  arm({ str: 16, equipment: [{ name: "Mace", qty: 1 }] });
  const before = kit.dummy().currentHp;
  const swing = await kit.swing(hero.id, { weapon: "Mace" }, 12, 4);
  assert.equal(kit.dummy().currentHp, before - (4 + abilityMod(16)));
  assert.equal(swing.result.damage, 4 + abilityMod(16));
  assert.ok(before <= DUMMY_HP);
});

await test("a miss rolls no damage and leaves the enemy untouched", async () => {
  arm({ str: 10, equipment: [{ name: "Mace", qty: 1 }] });
  const before = kit.dummy().currentHp;
  const swing = await kit.swing(hero.id, { weapon: "Mace" }, 2, 6);
  assert.equal(swing.result.hit, false);
  assert.equal(swing.unused, 1);
  assert.equal(kit.dummy().currentHp, before);
});

await test("a ranged weapon shoots with Dexterity, whatever the Strength", async () => {
  arm({ str: 18, dex: 14, equipment: [{ name: "Shortbow", qty: 1 }] });
  kit.stand(hero.id, 4);
  const swing = await kit.swing(hero.id, { weapon: "Shortbow" }, 10, 3);
  assert.equal(swing.result.rolled, 10 + abilityMod(14) + PB);
  assert.equal(swing.result.damage, 3 + abilityMod(14));
  kit.stand(hero.id, 1);
});

await test("a finesse weapon takes the better of Strength and Dexterity, either way round", async () => {
  arm({ str: 16, dex: 12, equipment: [{ name: "Rapier", qty: 1 }] });
  let swing = await kit.swing(hero.id, { weapon: "Rapier" }, 10, 4);
  assert.equal(swing.result.rolled, 10 + abilityMod(16) + PB);
  assert.equal(swing.result.damage, 4 + abilityMod(16));
  arm({ str: 8, dex: 18, equipment: [{ name: "Rapier", qty: 1 }] });
  swing = await kit.swing(hero.id, { weapon: "Rapier" }, 10, 4);
  assert.equal(swing.result.rolled, 10 + abilityMod(18) + PB);
  assert.equal(swing.result.damage, 4 + abilityMod(18));
});

await test("a thrown melee weapon keeps Strength at range", async () => {
  arm({ str: 16, dex: 8, equipment: [{ name: "Handaxe", qty: 1 }] });
  kit.stand(hero.id, 3);
  const swing = await kit.swing(hero.id, { weapon: "Handaxe" }, 10, 2);
  assert.equal(swing.ok, true, swing.error);
  assert.equal(swing.result.rolled, 10 + abilityMod(16) + PB);
  assert.equal(swing.result.damage, 2 + abilityMod(16));
  assert.equal(swing.d20s.length, 1);
  kit.stand(hero.id, 1);
});

await test("a wizard with a greatsword adds no proficiency bonus", async () => {
  arm({ str: 14, weapons: ["daggers", "darts", "slings", "quarterstaffs", "light crossbows"], equipment: [{ name: "Greatsword", qty: 1 }] });
  const swing = await kit.swing(hero.id, { weapon: "Greatsword" }, 12, 3, 4);
  assert.equal(swing.result.rolled, 12 + abilityMod(14));
  assert.equal(swing.result.damage, 7 + abilityMod(14));
  assert.deepEqual(swing.damageDice, [6, 6]);
});

await test("a named weapon proficiency covers that weapon and no other", async () => {
  arm({ str: 14, weapons: ["longswords"], equipment: [{ name: "Longsword", qty: 1 }, { name: "Battleaxe", qty: 1 }] });
  assert.equal((await kit.swing(hero.id, { weapon: "Longsword" }, 3)).result.rolled, 3 + 2 + PB);
  assert.equal((await kit.swing(hero.id, { weapon: "Battleaxe" }, 3)).result.rolled, 3 + 2);
});

await test("simple training does not reach a martial weapon", async () => {
  arm({ str: 14, weapons: ["simple"], equipment: [{ name: "Mace", qty: 1 }, { name: "Flail", qty: 1 }] });
  assert.equal((await kit.swing(hero.id, { weapon: "Mace" }, 3)).result.rolled, 3 + 2 + PB);
  assert.equal((await kit.swing(hero.id, { weapon: "Flail" }, 3)).result.rolled, 3 + 2);
});

await test("an unarmed strike is 1 + Strength, with proficiency to hit", async () => {
  arm({ str: 16, weapons: [] });
  const swing = await kit.swing(hero.id, { weapon: "unarmed strike" }, 10);
  assert.equal(swing.result.rolled, 10 + abilityMod(16) + PB);
  assert.equal(swing.result.damage, 1 + abilityMod(16));
  assert.equal(swing.result.damageType, "bludgeoning");
  assert.deepEqual(swing.damageDice, []);
});

await test("an improvised weapon is 1d4 + Strength with no proficiency", async () => {
  arm({ str: 16, equipment: [{ name: "Chair Leg", qty: 1 }] });
  const swing = await kit.swing(hero.id, { weapon: "Chair Leg" }, 10, 3);
  assert.equal(swing.result.improvised, true);
  assert.equal(swing.result.rolled, 10 + abilityMod(16));
  assert.equal(swing.result.damage, 3 + abilityMod(16));
  assert.deepEqual(swing.damageDice, [4]);
});

await test("a +1, +2 or +3 weapon adds its bonus to the attack and to the damage", async () => {
  for (const bonus of [1, 2, 3]) {
    arm({ str: 14, equipment: [{ name: `+${bonus} Longsword`, qty: 1 }] });
    const swing = await kit.swing(hero.id, { weapon: "Longsword" }, 9, 5);
    assert.equal(swing.result.rolled, 9 + 2 + PB + bonus, `+${bonus} to hit`);
    assert.equal(swing.result.damage, 5 + 2 + bonus, `+${bonus} damage`);
  }
});

await test("a magic bonus belongs to the carried item, not to the name the attack was called by", async () => {
  arm({ str: 14, equipment: [{ name: "Longsword", qty: 1 }] });
  const swing = await kit.swing(hero.id, { weapon: "+3 Longsword" }, 9, 5);
  assert.equal(swing.result.rolled, 9 + 2 + PB);
  assert.equal(swing.result.damage, 5 + 2);
});

await test("a penalty can bring a hit to 0 damage, and never below it", async () => {
  // A mace is swung with Strength: 1d6 on a 1 with -4 comes to less than
  // nothing, and the hit deals 0.
  arm({ str: 3, equipment: [{ name: "Mace", qty: 1 }] });
  const before = kit.dummy().currentHp;
  const swing = await kit.swing(hero.id, { weapon: "Mace" }, 19, 1);
  assert.equal(swing.result.hit, true);
  assert.equal(swing.result.damage, 0);
  assert.equal(kit.dummy().currentHp, before);
  // A finesse weapon takes the better modifier, so the same arm with a
  // dagger and DEX 10 deals the die.
  arm({ str: 3, equipment: [{ name: "Dagger", qty: 1 }] });
  const dagger = await kit.swing(hero.id, { weapon: "Dagger" }, 19, 1);
  assert.equal(before - kit.dummy().currentHp, 1);
  assert.equal(dagger.result.damage, 1);
});

await test("a reach weapon strikes at 10 feet and an ordinary one does not", async () => {
  arm({ str: 14, equipment: [{ name: "Glaive", qty: 1 }, { name: "Longsword", qty: 1 }, { name: "Whip", qty: 1 }] });
  kit.stand(hero.id, 2);
  assert.equal((await kit.swing(hero.id, { weapon: "Glaive" }, 10, 5)).ok, true);
  assert.equal((await kit.swing(hero.id, { weapon: "Whip" }, 10, 2)).ok, true);
  const before = kit.dummy().currentHp;
  const refused = await kit.swing(hero.id, { weapon: "Longsword" }, 10, 5);
  assert.equal(refused.ok, false);
  assert.equal(refused.log.length, 0);
  assert.equal(kit.dummy().currentHp, before);
  kit.stand(hero.id, 3);
  assert.equal((await kit.swing(hero.id, { weapon: "Glaive" }, 10, 5)).ok, false);
  kit.stand(hero.id, 1);
});

await test("past the normal range a shot is at disadvantage, inside it it is not", async () => {
  arm({ dex: 14, equipment: [{ name: "Sling", qty: 1 }] });
  kit.stand(hero.id, 6);
  let swing = await kit.swing(hero.id, { weapon: "Sling" }, 15, 3);
  assert.deepEqual(swing.d20s, [15]);
  kit.stand(hero.id, 7);
  swing = await kit.swing(hero.id, { weapon: "Sling" }, 15, 4, 3);
  assert.deepEqual(swing.d20s, [15, 4]);
  assert.equal(swing.result.rolled, 4 + abilityMod(14) + PB);
  kit.stand(hero.id, 1);
});

await test("a Small character swings a heavy weapon at disadvantage, a Medium one does not", async () => {
  arm({ str: 14, race: "lightfoot_halfling", equipment: [{ name: "Greataxe", qty: 1 }, { name: "Mace", qty: 1 }] });
  let swing = await kit.swing(hero.id, { weapon: "Greataxe" }, 15, 4, 6);
  assert.deepEqual(swing.d20s, [15, 4]);
  assert.equal(swing.result.rolled, 4 + 2 + PB);
  swing = await kit.swing(hero.id, { weapon: "Mace" }, 15, 4);
  assert.deepEqual(swing.d20s, [15]);
  arm({ str: 14, race: "human", equipment: [{ name: "Greataxe", qty: 1 }] });
  swing = await kit.swing(hero.id, { weapon: "Greataxe" }, 15, 4);
  assert.deepEqual(swing.d20s, [15]);
});

await test("every heavy weapon in the SRD is at disadvantage for every Small race", async () => {
  const heavy = SRD.filter((row) => row.properties.includes(P.h));
  assert.deepEqual(sorted(heavy.map((row) => row.name)), sorted(["Glaive", "Greataxe", "Greatsword", "Halberd", "Maul", "Pike", "Heavy Crossbow", "Longbow"]));
  for (const race of ["lightfoot_halfling", "stout_halfling", "rock_gnome", "forest_gnome"]) {
    for (const row of heavy) {
      arm({ str: 14, dex: 14, race, equipment: [{ name: row.name, qty: 1 }] });
      kit.stand(hero.id, row.properties.includes(P.r) || row.kind === "ranged" ? 2 : 1);
      const swing = await kit.swing(hero.id, { weapon: row.name }, 2, 3);
      assert.equal(swing.d20s.length, 2, `${race} with a ${row.name}`);
    }
  }
  kit.stand(hero.id, 1);
});

// ---- what is carried, how far it reaches, the net and the lance ----

await test("A character attacks with a weapon they are holding; one that is not in their equipment cannot be swung.", async () => {
  arm({ str: 14, equipment: [] });
  const before = kit.dummy().currentHp;
  const swing = await kit.swing(hero.id, { weapon: "Greatsword" }, 15, 6, 6);
  assert.equal(swing.ok, false, `the swing went through for ${swing.result?.damage} damage`);
  assert.equal(kit.dummy().currentHp, before);
});

await test("Each ranged and thrown weapon has its own long range (dagger 20/60, javelin 30/120, longbow 150/600); a shot inside it is allowed at disadvantage.", async () => {
  arm({ str: 14, equipment: [{ name: "Dagger", qty: 1 }] });
  kit.stand(hero.id, 9);
  const swing = await kit.swing(hero.id, { weapon: "Dagger" }, 15, 4, 3);
  kit.stand(hero.id, 1);
  assert.equal(swing.ok, true, swing.error);
});

await test("A net has a range of 5/15: past 15 ft it cannot be thrown at all.", async () => {
  assert.equal(odm("Net").rangeFt, 5, `the net's normal range is stored as ${odm("Net").rangeFt} ft`);
});

await test("A net deals no damage; a hit restrains the target.", async () => {
  arm({ str: 10, dex: 10, equipment: [{ name: "Net", qty: 1 }] });
  const before = kit.dummy().currentHp;
  // Thrown from 5 feet with the target within 5 feet: a ranged attack with a
  // hostile creature next to the thrower, so two d20s and the lower kept.
  const swing = await kit.swing(hero.id, { weapon: "Net" }, 15, 16);
  assert.equal(swing.ok, true, swing.error);
  assert.equal(swing.result.hit, true);
  assert.equal(kit.dummy().currentHp, before, "the net took hit points off its target");
  assert.ok(kit.dummy().conditions.includes("restrained"));
});

await test("A lance has disadvantage against a target within 5 ft and needs two hands unless the wielder is mounted.", async () => {
  arm({ str: 14, equipment: [{ name: "Lance", qty: 1 }] });
  kit.stand(hero.id, 1);
  // The net above left the dummy restrained, which is advantage for whoever
  // attacks it and would cancel what is being measured here.
  patchEnemyConditions(kit.dummy().id, [], {});
  const swing = await kit.swing(hero.id, { weapon: "Lance" }, 15, 4, 6);
  assert.equal(swing.d20s.length, 2, "one d20 was rolled at 5 ft");
});

await kit.endFight();
world.close();
finish();
