// A monster fights with the stat block it prints (SRD 5.1, Monsters): its
// Multiattack routine, its attacks' reach, range and damage types, the riders
// a hit carries, its legendary actions and resistance, its spellcasting and
// the traits that change a roll. Blocks are staged from SRD text written out
// in scripts/lib/enforce-monsters.mjs, so the suite reads the same with the
// content pack and without it; the pack rows are checked too when present.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";
import { d20Count, monsterKit, ROWS } from "./lib/enforce-monsters.mjs";

const { test, finish } = suite("test-enforce-monster-blocks");
const world = await openWorld();
const kit = await combatKit(world);
const mk = await monsterKit(world, kit);
const { legendaryProfile } = await import("../src/lib/dm/legendary-logic.ts");
const { rollsForCampaign } = await (async () => {
  const rolls = await import("../src/lib/db/rolls.ts");
  return { rollsForCampaign: (count) => rolls.listRecentRolls(world.campaignId, count) };
})();

// A pack row as the engine reads it, or null without the pack.
function packRow(slug) {
  if (!world.hasPack) {
    return null;
  }
  const out = execFileSync("sqlite3", [process.env.CONTENT_DB_PATH, `select data_json from monsters where slug='${slug}' limit 1`]).toString();
  return out.trim() ? JSON.parse(out) : null;
}

const tank = world.addHero({
  name: "Tank", class: "fighter", level: 5, abilities: { str: 16, dex: 10 }, proficiencies: TRAINED,
  maxHp: 300, ac: 10, acOverride: true,
});
const tief = world.addHero({
  name: "Tief", class: "fighter", level: 5, race: "tiefling", proficiencies: TRAINED,
  maxHp: 300, ac: 10, acOverride: true,
});

async function stage(row, patch = {}, count = 1) {
  await kit.endFight();
  await kit.fight(count, { heroFaces: { [tank.id]: 19, [tief.id]: 18 } });
  const enemies = world.enemies();
  for (const enemy of enemies) {
    mk.stage(enemy.id, row, patch);
  }
  for (const hero of [tank, tief]) {
    world.patch(hero.id, { currentHp: 300, conditions: [], conditionMeta: {} });
  }
  kit.place(tank.id, 5, 5);
  kit.place(tief.id, 9, 9);
  kit.place(enemies[0].id, 5, 6);
  return enemies;
}

// One enemy attack with its dice forced, the rolls it stored in the order
// they were made (listRecentRolls reads them back in that order).
async function strike(enemy, target, faces, args = {}) {
  kit.freshRound();
  const before = new Set(rollsForCampaign(60).map((roll) => roll.id));
  const out = await mk.forced(faces, () =>
    world.invoke("enemy_attack", { enemyId: enemy.id, targetCharacterId: target.id, ...args }),
  );
  const made = rollsForCampaign(60).filter((roll) => !before.has(roll.id));
  return { ...out, made };
}

// ---- Multiattack (G2) ----

await test("A Multiattack routine names its attacks: an adult red dragon bites once and claws twice; a bandit captain has a melee routine and a ranged one.", () => {
  assert.deepEqual(mk.parse(ROWS.adultRedDragon).routines, [[{ attack: "Bite", count: 1 }, { attack: "Claw", count: 2 }]]);
  assert.deepEqual(mk.parse(ROWS.banditCaptain).routines, [
    [{ attack: "Scimitar", count: 2 }, { attack: "Dagger", count: 1 }],
    [{ attack: "Dagger", count: 2 }],
  ]);
  assert.deepEqual(mk.parse(ROWS.hillGiant).routines, [[{ attack: "Greatclub", count: 2 }]]);
  const pack = packRow("adult-red-dragon");
  if (pack) {
    assert.deepEqual(mk.parse(pack).routines, [[{ attack: "Bite", count: 1 }, { attack: "Claw", count: 2 }]]);
  }
});

await test("An enemy's Multiattack makes the attacks its routine lists, each with its own numbers: bite, claw, claw.", async () => {
  const [dragon] = await stage(ROWS.adultRedDragon);
  const out = await strike(dragon, tank, [15, 1, 1, 1, 1, 15, 1, 1, 15, 1, 1]);
  assert.equal(out.ok, true, out.error);
  const attacks = out.made.filter((roll) => roll.kind === "attack").map((roll) => roll.detail);
  assert.deepEqual(attacks, [`${dragon.displayName}: Bite`, `${dragon.displayName}: Claw`, `${dragon.displayName}: Claw`]);
  assert.equal(out.unused, 0);
});

// ---- rider damage counted once (G3) ----

await test("An attack's rider damage is rolled once: an adult red dragon's bite is 2d10 + 8 piercing plus 2d6 fire.", () => {
  const bite = mk.parse(ROWS.adultRedDragon).attacks.find((attack) => attack.name === "Bite");
  assert.equal(bite.damage, "2d10+2d6+8");
  const vampire = mk.parse(ROWS.vampireBite).attacks.find((attack) => attack.name.startsWith("Bite"));
  assert.equal(vampire.damage, "1d6+3d6+4");
  const pack = packRow("adult-red-dragon");
  if (pack) {
    assert.equal(mk.parse(pack).attacks.find((attack) => attack.name === "Bite").damage, "2d10+2d6+8");
  }
});

await test("A rider the damage dice leave out is still added", () => {
  const row = {
    name: "Hound", armor_class: 15, hit_points: 45,
    actions: [{ name: "Bite", desc: "Melee Weapon Attack: +5 to hit, reach 5 ft., one target. Hit: 7 (1d8 + 3) piercing damage plus 7 (2d6) fire damage.", attack_bonus: 5, damage_dice: "1d8", damage_bonus: 3 }],
  };
  assert.equal(mk.parse(row).attacks[0].damage, "1d8+3+2d6");
});

// ---- legendary actions and resistance (G4) ----

await test("A legendary creature from the pack has its legendary actions (3 a round, each at its cost) and its Legendary Resistance (3/Day).", async () => {
  const profile = legendaryProfile(mk.parse(ROWS.adultRedDragon));
  assert.equal(profile?.actionsPerRound, 3);
  assert.equal(profile.resistances, 3);
  assert.deepEqual(profile.actions.map((action) => [action.name, action.cost]), [["Detect", 1], ["Tail Attack", 1], ["Wing Attack", 2]]);
  const vampire = legendaryProfile(mk.parse(ROWS.vampireBite));
  assert.equal(vampire?.resistances, 3);
  assert.deepEqual(vampire.actions.map((action) => action.name), ["Move", "Unarmed Strike", "Bite"]);
  for (const slug of ["adult-red-dragon", "lich", "vampire"]) {
    const pack = packRow(slug);
    if (pack) {
      const fromPack = legendaryProfile(mk.parse(pack));
      assert.equal(fromPack?.actionsPerRound, 3, slug);
      assert.equal(fromPack.resistances, 3, slug);
    }
  }
  const [dragon] = await stage(ROWS.adultRedDragon);
  const tail = await world.invoke("legendary_action", { enemyId: dragon.id, action: "Tail Attack" });
  assert.equal(tail.ok, true, tail.error);
  assert.equal(world.encounter().legendary.pools[dragon.id].actions, 2);
});

// ---- on-hit riders (G10b) ----

await test("An attack's rider is part of its block: a wolf's bite knocks prone on a failed DC 11 Strength save; a giant spider's adds 2d8 poison, half on a DC 11 Constitution save.", () => {
  const wolf = mk.parse(ROWS.wolf).attacks[0].onHit;
  assert.equal(wolf?.save, "str");
  assert.equal(wolf.dc, 11);
  assert.equal(wolf.condition, "prone");
  const spider = mk.parse(ROWS.giantSpider).attacks[0].onHit;
  assert.equal(spider?.save, "con");
  assert.equal(spider.dc, 11);
  assert.equal(spider.damage, "2d8");
  assert.equal(spider.damageType, "poison");
  assert.equal(spider.halfOnSave, true);
  const snake = mk.parse(ROWS.constrictor).attacks.find((attack) => attack.name === "Constrict").onHit;
  assert.equal(snake?.escapeDc, 14);
  assert.equal(snake.condition, "grappled");
});

await test("A hit applies its rider: the wolf's target fails the Strength save and falls prone; the spider's poison is halved on a made save.", async () => {
  const [wolf] = await stage(ROWS.wolf);
  // Hit 15, bite 2d4 = 2+2, then the target's Strength save: a 1.
  const bite = await strike(wolf, tank, [15, 2, 2, 1]);
  assert.equal(bite.ok, true, bite.error);
  assert.ok(world.sheet(tank.id).conditions.includes("prone"), "the wolf's bite left the target standing");
  assert.equal(bite.unused, 0);
  const [spider] = await stage(ROWS.giantSpider);
  // Hit 15, bite 1d8 = 8, the save a 20, the poison 2d8 = 6 + 6 halved.
  const venom = await strike(spider, tank, [15, 8, 20, 6, 6]);
  assert.equal(venom.ok, true, venom.error);
  assert.equal(world.sheet(tank.id).currentHp, 300 - (8 + 3) - 6);
  assert.equal(venom.unused, 0);
});

// ---- two damage types in one blow (G12) ----

await test("Each damage type in a monster's blow meets its own resistance: a tiefling bitten by a red dragon halves only the fire.", async () => {
  const [dragon] = await stage(ROWS.adultRedDragon, { stats: { routines: undefined, attacksPerTurn: 1 } });
  kit.place(tief.id, 7, 6);
  // Bite 2d10 = 5 + 5 piercing, + 8; 2d6 = 6 + 6 fire, halved.
  const out = await strike(dragon, tief, [15, 5, 5, 6, 6], { attack: "Bite" });
  assert.equal(out.ok, true, out.error);
  assert.equal(world.sheet(tief.id).currentHp, 300 - (5 + 5 + 8) - 6);
});

// ---- reach (G14) ----

await test("A monster with a reach 10 ft. attack strikes from two squares away without stepping in.", async () => {
  const [giant] = await stage(ROWS.hillGiant, { stats: { size: "Medium" } });
  kit.place(giant.id, 5, 7);
  const out = await strike(giant, tank, [15, 1, 1, 1, 15, 1, 1, 1], { attack: "Greatclub" });
  assert.equal(out.ok, true, out.error);
  assert.deepEqual([kit.token(giant.id).x, kit.token(giant.id).y], [5, 7]);
  assert.ok(out.made.some((roll) => roll.kind === "attack"));
});

// ---- ranged profiles (G15) ----

await test("A monster's ranged attack has its printed normal and long range: past the normal range it rolls at disadvantage, past the long range it cannot shoot; a thrown weapon used in melee is a melee attack.", async () => {
  // The mage's dagger: reach 5 ft. or range 20/60 ft.
  const [mage] = await stage(ROWS.mage);
  kit.place(mage.id, 5, 11);
  const far = await strike(mage, tank, [15, 15, 1], { attack: "Dagger" });
  assert.equal(far.ok, true, far.error);
  assert.deepEqual([kit.token(mage.id).x, kit.token(mage.id).y], [5, 11], "the thrower walked in instead of throwing");
  assert.equal(d20Count(far.rolled), 2, "a throw past normal range was not at disadvantage");
  // The ogre's javelin next to its target is a melee attack: no
  // disadvantage for a hostile within 5 feet.
  const [ogre] = await stage(ROWS.ogre);
  const close = await strike(ogre, tank, [15, 1, 1], { attack: "Javelin" });
  assert.equal(close.ok, true, close.error);
  assert.equal(d20Count(close.rolled), 1, "a javelin stabbed in melee rolled at disadvantage");
});

await test("Past its long range a monster's ranged attack cannot be made.", async () => {
    const [mage] = await stage(ROWS.mage);
    kit.place(mage.id, 5, 19);
    // Out of movement for the round, so it cannot close the gap.
    kit.place(mage.id, 5, 19, 12);
    const out = await strike(mage, tank, [15, 1], { attack: "Dagger" });
    assert.equal(out.ok, false, "a dagger was thrown 70 ft");
});

// ---- spellcasting (G32) ----

await test("A spellcasting monster's block gives its spell save DC, attack bonus, slots and spell list.", () => {
  const lich = mk.parse(ROWS.lich);
  assert.equal(lich.spellcasting?.dc, 20);
  assert.equal(lich.spellcasting.attack, 12);
  assert.equal(lich.spellcasting.slots["9"], 1);
  assert.equal(lich.spellcasting.slots["1"], 4);
  assert.ok(lich.spells.includes("Fireball"));
  assert.ok(lich.spells.includes("Power Word Kill"));
  const pack = packRow("lich");
  if (pack) {
    assert.equal(mk.parse(pack).spellcasting?.dc, 20);
    assert.ok(mk.parse(pack).spells.includes("Fireball"));
  }
});

// ---- common traits (G33) ----

await test("Pack Tactics: advantage on an attack when an ally of the monster that is not incapacitated stands within 5 feet of the target.", async () => {
  const [wolf, other] = await stage(ROWS.wolf, {}, 2);
  kit.place(other.id, 12, 12);
  const alone = await strike(wolf, tank, [15, 15, 1, 1, 20]);
  assert.equal(alone.ok, true, alone.error);
  assert.equal(d20Count(alone.rolled.slice(0, 2)), 1);
  world.patch(tank.id, { conditions: [], conditionMeta: {} });
  kit.place(other.id, 6, 5);
  const pack = await strike(wolf, tank, [15, 15, 1, 1, 20]);
  assert.equal(pack.ok, true, pack.error);
  assert.equal(d20Count(pack.rolled.slice(0, 2)), 2, "Pack Tactics gave no advantage");
});

await kit.endFight();
world.close();
finish();
