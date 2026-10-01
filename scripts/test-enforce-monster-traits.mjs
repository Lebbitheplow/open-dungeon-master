// The traits a stat block prints that change what the dice do (SRD 5.1,
// Monsters), and the smaller combat rules around the monsters: Undead
// Fortitude, Regeneration, Sunlight Sensitivity, Nimble Escape, Magic
// Weapons, an enemy's reach drawing opportunity attacks, a legendary
// creature waiting for the end of another creature's turn, exhaustion on
// an enemy, a fall, a healer's kit and its ten uses, and what bare
// incapacitation does and does not take away.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";
import { d20Count, monsterKit, ROWS } from "./lib/enforce-monsters.mjs";

const { test, finish } = suite("test-enforce-monster-traits");
const world = await openWorld();
const kit = await combatKit(world);
const mk = await monsterKit(world, kit);
const rolls = await import("../src/lib/db/rolls.ts");
const { getDatabase } = await import("../src/lib/db/core.ts");

const tank = world.addHero({
  name: "Tank", class: "fighter", level: 5, abilities: { str: 16, wis: 12 }, proficiencies: { ...TRAINED, skills: ["medicine"] },
  maxHp: 60, ac: 10, acOverride: true,
  equipment: [{ name: "Healer's Kit", qty: 1 }, { name: "Longsword", qty: 1, equipped: true }],
});
const other = world.addHero({
  name: "Other", class: "fighter", level: 5, proficiencies: TRAINED, maxHp: 60, ac: 10, acOverride: true,
});
const heroes = [tank, other];

const ZOMBIE = {
  name: "Zombie", size: "Medium", type: "Undead", armor_class: 8, hit_points: 22, cr: 0.25,
  constitution: 16, constitution_save: 3,
  actions: [{ name: "Slam", desc: "Melee Weapon Attack: +3 to hit, reach 5 ft., one target. Hit: 4 (1d6 + 1) bludgeoning damage.", attack_bonus: 3, damage_dice: "1d6", damage_bonus: 1 }],
  special_abilities: [{ name: "Undead Fortitude", desc: "If damage reduces the zombie to 0 hit points, it must make a Constitution saving throw with a DC of 5 + the damage taken, unless the damage is radiant or from a critical hit. On a success, the zombie drops to 1 hit point instead." }],
};
const TROLL = {
  name: "Troll", size: "Large", type: "Giant", armor_class: 15, hit_points: 84, cr: 5,
  actions: [{ name: "Claw", desc: "Melee Weapon Attack: +7 to hit, reach 5 ft., one target. Hit: 11 (2d6 + 4) slashing damage.", attack_bonus: 7, damage_dice: "2d6", damage_bonus: 4 }],
  special_abilities: [{ name: "Regeneration", desc: "The troll regains 10 hit points at the start of its turn. If the troll takes acid or fire damage, this trait doesn't function at the start of the troll's next turn. The troll dies only if it starts its turn with 0 hit points and doesn't regenerate." }],
};
const KOBOLD = {
  name: "Kobold", size: "Small", type: "Humanoid", armor_class: 12, hit_points: 5, cr: 0.125,
  actions: [{ name: "Dagger", desc: "Melee Weapon Attack: +4 to hit, reach 5 ft., one target. Hit: 4 (1d4 + 2) piercing damage.", attack_bonus: 4, damage_dice: "1d4", damage_bonus: 2 }],
  special_abilities: [{ name: "Sunlight Sensitivity", desc: "While in sunlight, the kobold has disadvantage on attack rolls, as well as on Wisdom (Perception) checks that rely on sight." }],
};
const GOLEM_FIST = {
  name: "Golem", size: "Large", type: "Construct", armor_class: 17, hit_points: 93, cr: 5,
  actions: [{ name: "Slam", desc: "Melee Weapon Attack: +7 to hit, reach 5 ft., one target. Hit: 13 (2d8 + 4) bludgeoning damage.", attack_bonus: 7, damage_dice: "2d8", damage_bonus: 4 }],
  special_abilities: [{ name: "Magic Weapons", desc: "The golem's weapon attacks are magical." }],
};

// Tank 19, Other 18, the enemy 1: both heroes act before it.
async function stage(row, count = 1) {
  await kit.endFight();
  for (const hero of heroes) {
    world.patch(hero.id, { currentHp: 60, conditions: [], conditionMeta: {}, deathSaves: null });
  }
  await kit.fight(count, { heroFaces: { [tank.id]: 19, [other.id]: 18 } });
  const enemies = world.enemies();
  if (row) {
    enemies.forEach((enemy) => mk.stage(enemy.id, row));
  }
  kit.place(tank.id, 5, 5);
  kit.place(other.id, 5, 12);
  enemies.forEach((enemy, index) => kit.place(enemy.id, 5 + index * 2, 6));
  return world.enemies();
}

function nextRound(...faces) {
  const round = world.encounter().round;
  world.clearDice();
  world.diceLog();
  world.dice(...faces);
  for (let guard = 0; guard < 10 && world.encounter().round === round; guard += 1) {
    assert.equal(kit.endTurn(kit.current().userId), true);
  }
  const rolled = world.diceLog();
  world.clearDice();
  return rolled;
}

async function walk(hero, x, y) {
  const route = await world.route("campaigns/[campaignId]/battle-map/move");
  world.signIn({ id: hero.userId });
  return route.POST(
    new Request("http://odm.test/move", { method: "POST", body: JSON.stringify({ x, y }) }),
    { params: Promise.resolve({ campaignId: world.campaignId }) },
  );
}

await test("Undead Fortitude: damage that would drop the zombie forces a Constitution save (DC 5 + the damage); on a success it stays at 1 hit point, never against radiant damage.", async () => {
  const [zombie] = await stage(ZOMBIE);
  kit.setEnemy(zombie.id, { currentHp: 5 });
  const held = await mk.forced([20], () => world.invoke("damage_enemy", { enemyId: zombie.id, amount: 8, type: "slashing" }));
  assert.equal(held.ok, true, held.error);
  assert.equal(kit.enemy(zombie.id).currentHp, 1);
  assert.equal(kit.enemy(zombie.id).status, "alive");
  const holy = await mk.forced([20], () => world.invoke("damage_enemy", { enemyId: zombie.id, amount: 8, type: "radiant" }));
  assert.equal(holy.ok, true, holy.error);
  assert.equal(kit.enemy(zombie.id).status, "dead");
});

await test("Regeneration: the troll regains 10 hit points at the start of its turn, except the turn after it took acid or fire damage.", async () => {
  const [troll] = await stage(TROLL);
  kit.setEnemy(troll.id, { currentHp: 50 });
  nextRound();
  assert.equal(kit.enemy(troll.id).currentHp, 60);
  await world.invoke("damage_enemy", { enemyId: troll.id, amount: 10, type: "fire" });
  assert.equal(kit.enemy(troll.id).currentHp, 50);
  nextRound();
  assert.equal(kit.enemy(troll.id).currentHp, 50, "the troll regenerated through fire");
  nextRound();
  assert.equal(kit.enemy(troll.id).currentHp, 60);
});

await test("Sunlight Sensitivity: a creature with the trait attacks at disadvantage in direct sunlight.", async () => {
  const [kobold] = await stage(KOBOLD);
  const { getClock, setClock } = await import("../src/lib/db/clock.ts");
  const { breakDown } = await import("../src/lib/dm/calendar.ts");
  getDatabase().prepare("UPDATE battle_maps SET outdoors = 1, ambient = 'bright' WHERE id = ?").run(kit.map().id);
  const clock = getClock(world.campaignId);
  let instant = clock.instant;
  while (breakDown(clock.calendar, instant).hour !== 12) {
    instant += 60;
  }
  setClock(world.campaignId, { ...clock, instant, weather: null });
  kit.freshRound();
  const out = await mk.forced([15, 15, 1], () => world.invoke("enemy_attack", { enemyId: kobold.id, targetCharacterId: tank.id }));
  setClock(world.campaignId, clock);
  assert.equal(out.ok, true, out.error);
  assert.equal(d20Count(out.rolled), 2, "a kobold in the noon sun attacked on a straight roll");
});

await test("Nimble Escape: a goblin disengages as a bonus action and still has its action; a creature without it spends its action to disengage.", async () => {
  const [goblin, brute] = await stage(ROWS.goblin, 2);
  mk.stage(brute.id, ZOMBIE);
  kit.place(goblin.id, 5, 6);
  kit.place(brute.id, 6, 6);
  kit.freshRound();
  const before = rolls.listRecentRolls(world.campaignId, 100).filter((roll) => roll.kind === "attack").length;
  const away = await world.invoke("move_token", { tokenName: goblin.id, x: 5, y: 9, disengage: true });
  assert.equal(away.ok, true, away.error);
  const after = rolls.listRecentRolls(world.campaignId, 100).filter((roll) => roll.kind === "attack").length;
  assert.equal(after, before, "the disengaging goblin drew an opportunity attack");
  const shot = await mk.forced([15, 1], () => world.invoke("enemy_attack", { enemyId: goblin.id, targetCharacterId: tank.id, attack: "Shortbow" }));
  assert.equal(shot.ok, true, shot.error);
  const zombieAway = await world.invoke("move_token", { tokenName: brute.id, x: 8, y: 9, disengage: true });
  assert.equal(zombieAway.ok, true, zombieAway.error);
  const slam = await world.invoke("enemy_attack", { enemyId: brute.id, targetCharacterId: tank.id });
  assert.equal(slam.ok, false, "a zombie disengaged and still attacked");
});

await test("Magic Weapons: a creature's weapon attacks are magical, so resistance to nonmagical attacks does not blunt them.", async () => {
  const [golem] = await stage(GOLEM_FIST);
  world.patch(tank.id, { conditions: ["stoneskin"], conditionMeta: {} });
  kit.freshRound();
  const out = await mk.forced([15, 4, 4], () => world.invoke("enemy_attack", { enemyId: golem.id, targetCharacterId: tank.id }));
  assert.equal(out.ok, true, out.error);
  assert.equal(world.sheet(tank.id).currentHp, 60 - 12);
});

await test("Stoneskin still halves a creature's nonmagical blow", async () => {
  const [ogre] = await stage(ROWS.ogre);
  world.patch(tank.id, { conditions: ["stoneskin"], conditionMeta: {} });
  kit.freshRound();
  const out = await mk.forced([15, 4, 4], () => world.invoke("enemy_attack", { enemyId: ogre.id, targetCharacterId: tank.id, attack: "Greatclub" }));
  assert.equal(out.ok, true, out.error);
  assert.equal(world.sheet(tank.id).currentHp, 60 - 6);
});

await test("Exhaustion 2 halves a creature's walk; 4 halves its hit points; 6 kills it", async () => {
  const [enemy] = await stage();
  kit.place(enemy.id, 10, 6);
  kit.freshRound();
  const two = await world.invoke("set_enemy_condition", { enemyId: enemy.id, condition: "exhaustion", level: 2 });
  assert.equal(two.ok, true, two.error);
  // Speed 30 ft is 6 tiles; halved, 3.
  const walked = await world.invoke("move_token", { tokenName: enemy.id, x: 16, y: 6 });
  assert.equal(walked.ok, true, walked.error);
  assert.equal(kit.token(enemy.id).x, 13, "an exhausted creature walked its full speed");
  const four = await world.invoke("set_enemy_condition", { enemyId: enemy.id, condition: "exhaustion", level: 4 });
  assert.equal(four.ok, true, four.error);
  assert.equal(kit.enemy(enemy.id).currentHp, Math.floor(kit.enemy(enemy.id).maxHp / 2));
  assert.deepEqual(kit.enemy(enemy.id).conditions.filter((entry) => entry.startsWith("exhaustion")), ["exhaustion 4"]);
  const six = await world.invoke("set_enemy_condition", { enemyId: enemy.id, condition: "exhaustion", level: 6 });
  assert.equal(six.ok, true, six.error);
  assert.equal(kit.enemy(enemy.id).status, "dead");
});

await test("A healer's kit's last use takes the kit; stabilizing a creature out of reach spends nothing", async () => {
  await stage();
  world.patch(tank.id, { equipment: [{ name: "Healer's Kit", qty: 1, charges: 1 }] });
  world.patch(other.id, { currentHp: 0, deathSaves: { successes: 0, failures: 0, stable: false, dead: false }, conditions: ["unconscious", "prone"] });
  kit.place(other.id, 5, 12);
  const far = await world.invoke("stabilize", { characterId: other.id, healerId: tank.id, method: "kit" });
  assert.equal(far.ok, false);
  assert.equal(world.sheet(tank.id).equipment[0].charges, 1);
  kit.place(other.id, 5, 6);
  const near = await world.invoke("stabilize", { characterId: other.id, healerId: tank.id, method: "kit" });
  assert.equal(near.ok, true, near.error);
  assert.equal(world.sheet(tank.id).equipment.some((item) => /healer's kit/i.test(item.name)), false);
  world.patch(tank.id, { equipment: [{ name: "Healer's Kit", qty: 1 }, { name: "Longsword", qty: 1, equipped: true }] });
});

await test("An enemy with a reach 10 ft. weapon draws an opportunity attack from 10 feet", async () => {
  const [giant] = await stage(ROWS.hillGiant);
  mk.stage(giant.id, ROWS.hillGiant, { stats: { size: "Medium" } });
  kit.place(giant.id, 5, 7);
  kit.giveTurn(tank.id);
  const before = rolls.listRecentRolls(world.campaignId, 100).filter((roll) => roll.kind === "attack").length;
  world.dice(1);
  const moved = await walk(tank, 5, 3);
  world.clearDice();
  assert.equal(moved.status, 200);
  const after = rolls.listRecentRolls(world.campaignId, 100).filter((roll) => roll.kind === "attack").length;
  assert.equal(after, before + 1, "leaving a 10-foot reach drew nothing");
});

await test("A legendary action comes at the end of another creature's turn, never during the creature's own.", async () => {
  const [dragon] = await stage(ROWS.adultRedDragon);
  // Tank 19, the dragon 10, Other 3: the dragon's turn comes between.
  await kit.endFight();
  await kit.fight(1, { heroFaces: { [tank.id]: 19, [other.id]: 3 }, enemyFace: 10 });
  const [again] = world.enemies();
  mk.stage(again.id, ROWS.adultRedDragon);
  const turn = mk.aiTurn();
  const ended = await mk.ai(turn, "end_turn", { characterId: tank.id });
  assert.equal(ended.ok, true, ended.error);
  const during = await mk.ai(turn, "legendary_action", { enemyId: again.id, action: "Detect" });
  assert.equal(during.ok, false, "a legendary action during the dragon's own turn");
  assert.ok(dragon);
});

await test("Exhaustion on a creature counts: at level 3 its attacks roll at disadvantage.", async () => {
  const [enemy] = await stage();
  const set = await world.invoke("set_enemy_condition", { enemyId: enemy.id, condition: "exhaustion", level: 3 });
  assert.equal(set.ok, true, set.error);
  kit.freshRound();
  const out = await mk.forced([15, 15, 1], () => world.invoke("enemy_attack", { enemyId: enemy.id, targetCharacterId: tank.id }));
  assert.equal(out.ok, true, out.error);
  assert.equal(d20Count(out.rolled), 2);
});

await test("A creature that falls takes 1d6 bludgeoning per 10 feet, rolled by the server, and lands prone.", async () => {
  const [enemy] = await stage();
  const out = await mk.forced([3, 3, 3], () => world.invoke("damage_enemy", { enemyId: enemy.id, source: "hazard", fallFeet: 30 }));
  assert.equal(out.ok, true, out.error);
  assert.equal(kit.enemy(enemy.id).currentHp, 40 - 9);
  assert.ok(kit.enemy(enemy.id).conditions.includes("prone"));
});

await test("A healer's kit has ten uses, one spent per stabilization, and the healer must be within reach of the dying creature.", async () => {
  await stage();
  world.patch(other.id, { currentHp: 0, deathSaves: { successes: 0, failures: 0, stable: false, dead: false }, conditions: ["unconscious", "prone"] });
  kit.place(other.id, 5, 12);
  const far = await world.invoke("stabilize", { characterId: other.id, healerId: tank.id, method: "kit" });
  assert.equal(far.ok, false, "stabilized from 35 feet away");
  kit.place(other.id, 5, 6);
  const near = await world.invoke("stabilize", { characterId: other.id, healerId: tank.id, method: "kit" });
  assert.equal(near.ok, true, near.error);
  const kitLine = world.sheet(tank.id).equipment.find((item) => /healer's kit/i.test(item.name));
  assert.ok(kitLine, "one use took the whole kit");
  assert.equal(kitLine.charges, 9);
});

await test("Bare incapacitation takes a creature's actions and reactions, not its speed.", async () => {
  await stage();
  world.patch(tank.id, { conditions: ["incapacitated"], conditionMeta: {} });
  kit.giveTurn(tank.id);
  const moved = await walk(tank, 5, 2);
  assert.equal(moved.status, 200, "an incapacitated character could not walk");
});

await test("Land's Stride: nonmagical difficult terrain costs a druid or ranger no extra movement", async () => {
  await stage();
  // A band of rubble across the whole board, rows 0 to 4.
  const width = kit.map().width;
  const rough = [0, 1, 2, 3, 4].flatMap((y) => Array.from({ length: width }, (_, x) => [x, y, ","]));
  kit.openField(rough);
  kit.place(tank.id, 5, 5);
  kit.giveTurn(tank.id);
  // Five squares of rubble cost 50 feet of a 30-foot walk.
  const plain = await walk(tank, 5, 0);
  assert.equal(plain.status, 400, "rubble cost nothing extra without Land's Stride");
  world.patch(tank.id, { features: [{ name: "Land's Stride", source: "class" }] });
  kit.giveTurn(tank.id);
  const strider = await walk(tank, 5, 0);
  world.patch(tank.id, { features: [] });
  assert.equal(strider.status, 200, "Land's Stride paid double for the rubble");
});

// ---- what a character's features and spells do to a creature's attack ----

await test("Chill Touch: an undead the caster struck attacks the caster at disadvantage, anyone else on a straight roll", async () => {
  const [zombie] = await stage(ZOMBIE);
  kit.setEnemy(zombie.id, { conditions: ["chill touch"], conditionMeta: { "chill touch": { source: tank.id, untilTurnOf: tank.id } } });
  kit.freshRound();
  const atCaster = await mk.forced([15, 15, 1], () => world.invoke("enemy_attack", { enemyId: zombie.id, targetCharacterId: tank.id }));
  assert.equal(atCaster.ok, true, atCaster.error);
  assert.equal(d20Count(atCaster.rolled), 2, "the chilled undead swung at its caster on a straight roll");
  kit.place(other.id, 6, 6);
  kit.freshRound();
  const atOther = await mk.forced([15, 1], () => world.invoke("enemy_attack", { enemyId: zombie.id, targetCharacterId: other.id }));
  assert.equal(atOther.ok, true, atOther.error);
  assert.equal(d20Count(atOther.rolled), 1);
});

await test("Chill Touch: a creature it struck does not regenerate", async () => {
  const [troll] = await stage(TROLL);
  kit.setEnemy(troll.id, { currentHp: 50, conditions: ["chill touch"], conditionMeta: { "chill touch": { source: tank.id, untilTurnOf: tank.id } } });
  nextRound();
  assert.equal(kit.enemy(troll.id).currentHp, 50);
});

await test("Elusive: no attack roll against the rogue has advantage while they are not incapacitated", async () => {
  const [enemy] = await stage();
  world.patch(tank.id, { conditions: ["restrained"], conditionMeta: {}, features: [{ name: "Elusive", source: "class" }] });
  kit.freshRound();
  const out = await mk.forced([15, 1], () => world.invoke("enemy_attack", { enemyId: enemy.id, targetCharacterId: tank.id }));
  world.patch(tank.id, { conditions: [], features: [] });
  assert.equal(out.ok, true, out.error);
  assert.equal(d20Count(out.rolled), 1, "a restrained Elusive rogue was attacked with advantage");
});

await test("Multiattack Defense: after a creature hits, its later attacks this turn meet +4 AC", async () => {
  const [captain] = await stage(ROWS.banditCaptain);
  world.patch(tank.id, { features: [{ name: "Multiattack Defense", source: "choice" }] });
  kit.freshRound();
  // AC 10. The first scimitar hits on 5 + 5; the second rolls 5 + 5 = 10 against 14 and misses.
  const out = await mk.forced([5, 3, 5, 5, 3], () => world.invoke("enemy_attack", { enemyId: captain.id, targetCharacterId: tank.id }));
  world.patch(tank.id, { features: [] });
  assert.equal(out.ok, true, out.error);
  const swings = out.result.swings;
  assert.equal(swings[0].hit, true);
  assert.equal(swings[1].hit, false, "the second swing hit through Multiattack Defense");
});

await test("Sanctuary: a creature that failed its save cannot try the same character again this turn, and may attack someone else", async () => {
  const [enemy] = await stage();
  world.patch(tank.id, { conditions: ["sanctuary"], conditionMeta: { sanctuary: { source: other.id } } });
  kit.freshRound();
  const first = await mk.forced([1], () => world.invoke("enemy_attack", { enemyId: enemy.id, targetCharacterId: tank.id }));
  assert.equal(first.ok, false);
  const retry = await mk.forced([20], () => world.invoke("enemy_attack", { enemyId: enemy.id, targetCharacterId: tank.id }));
  assert.equal(retry.ok, false, "a second save let it attack the warded character the same turn");
  assert.equal(retry.rolled.length, 0, "the retry rolled a second save");
  const elsewhere = await mk.forced([15, 1], () => world.invoke("enemy_attack", { enemyId: enemy.id, targetCharacterId: other.id }));
  assert.equal(elsewhere.ok, true, elsewhere.error);
  world.patch(tank.id, { conditions: [], conditionMeta: {} });
});

await kit.endFight();
world.close();
finish();
