// Open5e stat-block parsing into enemy snapshots, CR-baseline synthesis,
// and crit-expression doubling. Fixtures mirror real Open5e rows.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { parseMonster, saveModFor, sizeRank } = await import("../src/lib/bestiary/statblock.ts");
const { synthesizeStats } = await import("../src/lib/bestiary/synthesize.ts");
const { healthState } = await import("../src/lib/bestiary/health.ts");
const { critDamageExpression } = await import("../src/lib/dm/encounter-logic.ts");
const { isValidExpression } = await import("../src/lib/dice.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

// Shaped like the real hell-hound row (multi-part damage, save trait).
const hellHound = {
  cr: 3,
  hit_points: 45,
  armor_class: 15,
  dexterity: 12,
  speed: { walk: 50 },
  actions: [
    {
      name: "Bite",
      desc: "Melee Weapon Attack: +5 to hit, reach 5 ft., one target. Hit: 7 (1d8 + 3) piercing damage plus 7 (2d6) fire damage.",
      attack_bonus: 5,
      damage_dice: "1d8",
      damage_bonus: 3,
    },
    {
      name: "Fire Breath (Recharge 5-6)",
      desc: "The hound exhales fire in a 15-foot cone. Each creature in that area must make a DC 12 Dexterity saving throw, taking 21 (6d6) fire damage on a failed save.",
      attack_bonus: 0,
      damage_dice: "6d6",
      damage_bonus: null,
    },
  ],
  special_abilities: [
    { name: "Keen Hearing and Smell", desc: "The hound has advantage on Wisdom (Perception) checks that rely on hearing or smell." },
  ],
  damage_resistances: "",
  damage_immunities: "fire",
  damage_vulnerabilities: "",
  condition_immunities: "",
};

test("hell hound parses to an honest snapshot", () => {
  const stats = parseMonster(hellHound, 3);
  assert.equal(stats.maxHp, 45);
  assert.equal(stats.ac, 15);
  assert.equal(stats.dexMod, 1);
  assert.equal(stats.cr, 3);
  assert.equal(stats.xp, 700);
  assert.equal(stats.immune, "fire");
  assert.equal(stats.speed, "50");
  assert.equal(stats.attacks.length, 1);
  const bite = stats.attacks[0];
  assert.equal(bite.name, "Bite");
  assert.equal(bite.toHit, 5);
  assert.equal(bite.damage, "1d8+3+2d6");
  assert.equal(bite.type, "piercing/fire");
});

test("non-attack actions and specials become traits", () => {
  const stats = parseMonster(hellHound, 3);
  assert.ok(stats.traits.some((line) => line.startsWith("Fire Breath")));
  assert.ok(stats.traits.some((line) => line.startsWith("Keen Hearing")));
});

test("multiattack lines with null bonus become traits, dice attacks parse", () => {
  const dragon = {
    cr: 17,
    hit_points: 256,
    armor_class: 19,
    dexterity: 10,
    actions: [
      { name: "Multiattack", desc: "The dragon makes three attacks.", attack_bonus: null, damage_dice: null, damage_bonus: null },
      { name: "Bite", desc: "Hit: 19 (2d10 + 8) piercing damage plus 7 (2d6) fire damage.", attack_bonus: 14, damage_dice: "2d10+2d6", damage_bonus: 8 },
    ],
  };
  const stats = parseMonster(dragon, 17);
  assert.equal(stats.attacks.length, 1);
  assert.equal(stats.attacks[0].damage, "2d10+2d6+8+2d6");
  assert.ok(stats.traits.some((line) => line.startsWith("Multiattack")));
});

test("every parsed damage expression rolls", () => {
  for (const source of [hellHound]) {
    for (const attack of parseMonster(source, 3).attacks) {
      assert.ok(isValidExpression(attack.damage), attack.damage);
    }
  }
});

test("missing fields degrade to sane defaults", () => {
  const stats = parseMonster({}, 1);
  assert.equal(stats.ac, 12);
  assert.equal(stats.maxHp, 10);
  assert.equal(stats.attacks.length, 0);
  assert.equal(stats.xp, 200);
});

test("synthesizeStats scales monotonically and rolls", () => {
  let lastHp = 0;
  for (const cr of [0, 1, 3, 5, 10, 20, 30]) {
    const stats = synthesizeStats(cr);
    assert.ok(stats.maxHp >= lastHp, `hp not monotonic at CR ${cr}`);
    lastHp = stats.maxHp;
    assert.equal(stats.attacks.length, 1);
    assert.ok(isValidExpression(stats.attacks[0].damage));
    assert.ok(stats.ac >= 12 && stats.ac <= 19);
  }
});

test("crit doubles dice, not modifiers", () => {
  assert.equal(critDamageExpression("1d8+3"), "1d8+1d8+3");
  assert.equal(critDamageExpression("2d6"), "2d6+2d6");
  assert.equal(critDamageExpression("1d8+3+2d6"), "1d8+1d8+3+2d6+2d6");
  assert.ok(isValidExpression(critDamageExpression("1d8+3+2d6")));
});

test("save mods parse from scores with explicit saves winning", () => {
  const stats = parseMonster(
    {
      armor_class: 15,
      hit_points: 30,
      strength: 16,
      dexterity: 14,
      constitution: 12,
      wisdom: 8,
      dexterity_save: 6,
      cr: 2,
    },
    2,
  );
  assert.equal(stats.saveMods.str, 3);
  assert.equal(stats.saveMods.dex, 6);
  assert.equal(stats.saveMods.con, 1);
  assert.equal(stats.saveMods.wis, -1);
});

test("saveModFor falls back for legacy snapshots without saveMods", () => {
  const legacy = { ...synthesizeStats(4), saveMods: undefined, dexMod: 2, cr: 4 };
  assert.equal(saveModFor(legacy, "dex"), 2);
  assert.equal(saveModFor(legacy, "con"), 1);
  const modern = synthesizeStats(4);
  assert.equal(saveModFor(modern, "dex"), modern.saveMods.dex);
});

test("health states", () => {
  assert.equal(healthState(45, 45), "healthy");
  assert.equal(healthState(30, 45), "wounded");
  assert.equal(healthState(20, 45), "bloodied");
  assert.equal(healthState(5, 45), "near death");
  assert.equal(healthState(0, 45), "dead");
});

test("multiattack parsing", async () => {
  const { parseMultiattackCount, parseMonster } = await import("../src/lib/bestiary/statblock.ts");
  assert.equal(parseMultiattackCount("The wolf makes two bite attacks."), 2);
  assert.equal(parseMultiattackCount("makes three attacks: one with its bite"), 3);
  assert.equal(parseMultiattackCount("makes four claw attacks"), 3);
  assert.equal(parseMultiattackCount("It attacks once."), null);
  const parsed = parseMonster(
    {
      armor_class: 13,
      hit_points: 26,
      dexterity: 15,
      actions: [
        { name: "Multiattack", desc: "The thug makes two melee attacks." },
        { name: "Mace", desc: "Melee Weapon Attack: +4 to hit, reach 5 ft. Hit: 5 (1d6+2) bludgeoning damage." },
      ],
    },
    0.5,
  );
  assert.equal(parsed.attacksPerTurn, 2);
});

test("creature size parses and ranks for the grapple cap", () => {
  const parsed = parseMonster({ size: "Large", hit_points: 30 }, 1);
  assert.equal(parsed.size, "Large");
  // Synthesized stats and old snapshots carry no size and rank as Medium.
  assert.equal(synthesizeStats(2).size, undefined);
  assert.equal(sizeRank(undefined), sizeRank("Medium"));
  assert.ok(sizeRank("Tiny") < sizeRank("Small"));
  assert.ok(sizeRank("Small") < sizeRank("Medium"));
  assert.ok(sizeRank("Large") < sizeRank("Huge"));
  assert.ok(sizeRank("Huge") < sizeRank("Gargantuan"));
  // A Medium attacker can grapple up to Large, never Huge.
  assert.ok(sizeRank("Large") <= sizeRank("Medium") + 1);
  assert.ok(sizeRank("Huge") > sizeRank("Medium") + 1);
});

console.log(`test-statblock: ${passed} passed`);
