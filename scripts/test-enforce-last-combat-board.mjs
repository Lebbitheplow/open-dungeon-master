// The last mile of the combat repair (wave 4, "last-combat"), board and
// senses side: dragging a grappled creature at half speed, jumping (long and
// high, from Strength, on the board), underwater combat (weapons, ranges,
// fire resistance while immersed), silvered and adamantine weapons against
// the resistances that name them, and the blinded and deafened creatures
// failing the checks that need sight or hearing. SRD 5.1 throughout.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, d20Faces, DUMMY, TRAINED } from "./lib/enforce-combat.mjs";
import { d20Count, monsterKit } from "./lib/enforce-monsters.mjs";

const { test, finish } = suite("test-enforce-last-combat-board");
const world = await openWorld();
const kit = await combatKit(world);
const mk = await monsterKit(world, kit);
const { damageAdjust } = await import("../src/lib/dm/damage-logic.ts");

const fighter = world.addHero({
  name: "Fighter", class: "fighter", level: 5, abilities: { str: 16, dex: 10 }, proficiencies: { ...TRAINED, skills: ["athletics", "perception"] },
  maxHp: 60, ac: 10, acOverride: true,
  equipment: [{ name: "Longsword", qty: 1 }, { name: "Shortsword", qty: 1 }, { name: "Silvered Longsword", qty: 1 }, { name: "Longbow", qty: 1 }, { name: "Light Crossbow", qty: 1 }, { name: "Hand Crossbow", qty: 1 }],
});
const other = world.addHero({
  name: "Other", class: "fighter", level: 5, proficiencies: TRAINED, maxHp: 60, ac: 10, acOverride: true,
});
const heroes = [fighter, other];

async function stage(onTurn) {
  await kit.endFight();
  for (const hero of heroes) {
    world.patch(hero.id, { currentHp: 60, conditions: [], conditionMeta: {}, deathSaves: null });
  }
  await kit.fight(1, { heroFaces: { [fighter.id]: 19, [other.id]: 18 } });
  const [enemy] = world.enemies();
  kit.giveTurn(onTurn.id);
  kit.place(other.id, 15, 15);
  return kit.enemy(enemy.id);
}

async function walk(hero, body) {
  const route = await world.route("campaigns/[campaignId]/battle-map/move");
  world.signIn({ id: hero.userId });
  const response = await route.POST(
    new Request("http://odm.test/move", { method: "POST", body: JSON.stringify(body) }),
    { params: Promise.resolve({ campaignId: world.campaignId }) },
  );
  return { status: response.status, body: await response.json() };
}

const lower = (list) => list.map((entry) => entry.toLowerCase());
const chebyshevOf = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

// ---- dragging a grappled creature ----

async function holding() {
  const enemy = await stage(fighter);
  kit.place(fighter.id, 5, 6);
  kit.place(enemy.id, 5, 7);
  kit.setEnemy(enemy.id, { conditions: ["grappled"], conditionMeta: { grappled: { source: fighter.id } } });
  return enemy;
}

await test("A grappler drags the creature it holds along at half speed: every square costs two, and the grappled creature comes along and stays grappled.", async () => {
  const enemy = await holding();
  const moved = await walk(fighter, { x: 5, y: 3, drag: true });
  assert.equal(moved.status, 200, JSON.stringify(moved.body));
  assert.deepEqual([kit.token(fighter.id).x, kit.token(fighter.id).y], [5, 3]);
  assert.deepEqual([kit.token(enemy.id).x, kit.token(enemy.id).y], [5, 4], "the grappled creature was left behind");
  assert.ok(lower(kit.enemy(enemy.id).conditions).includes("grappled"), "the drag ended the grapple");
  assert.equal(kit.token(fighter.id).movedThisRound, 6, "dragging cost no extra movement");
  const far = await walk(fighter, { x: 5, y: 2, drag: true });
  assert.equal(far.status, 400, "a drag past half speed was allowed");
});

await test("Dragging needs a creature the mover grapples; without one the move is refused and nothing moves.", async () => {
  const enemy = await stage(fighter);
  kit.place(fighter.id, 5, 6);
  kit.place(enemy.id, 5, 7);
  const moved = await walk(fighter, { x: 5, y: 4, drag: true });
  assert.equal(moved.status, 400, JSON.stringify(moved.body));
  assert.deepEqual([kit.token(fighter.id).x, kit.token(fighter.id).y], [5, 6]);
});

await test("An enemy drags the character it grapples at half speed (move_token drag), and the character comes along still grappled.", async () => {
  const enemy = await stage(other);
  kit.place(fighter.id, 5, 6);
  kit.place(enemy.id, 5, 7);
  world.patch(fighter.id, { conditions: ["grappled"], conditionMeta: { grappled: { source: enemy.id } } });
  const out = await world.invoke("move_token", { tokenName: enemy.id, x: 5, y: 12, drag: true });
  assert.equal(out.ok, true, out.error);
  // Speed 30 is six squares; dragging, three.
  assert.deepEqual([kit.token(enemy.id).x, kit.token(enemy.id).y], [5, 10]);
  assert.equal(kit.token(enemy.id).movedThisRound, 6);
  assert.equal(chebyshevOf(kit.token(fighter.id), kit.token(enemy.id)), 1, "the dragged character was left behind");
  assert.ok(lower(world.sheet(fighter.id).conditions).includes("grappled"));
  world.patch(fighter.id, { conditions: [], conditionMeta: {} });
  const none = await world.invoke("move_token", { tokenName: enemy.id, x: 5, y: 11, drag: true });
  assert.equal(none.ok, false, "a drag with nobody held was allowed");
});

// ---- jumping ----

await test("A long jump covers up to the Strength score in feet after a 10-foot run (half from a standstill), over a chasm edge, each foot costing a foot of movement.", async () => {
  const enemy = await stage(fighter);
  kit.place(enemy.id, 15, 1);
  const board = kit.map();
  kit.openField(Array.from({ length: board.width }, (_, x) => [x, 4, "|"]));
  // Standing still: 8 feet, not enough for 15.
  kit.place(fighter.id, 5, 6, 0);
  const standing = await walk(fighter, { x: 5, y: 3, jump: true });
  assert.equal(standing.status, 400, "a standing jump cleared 15 feet with Strength 16");
  // After a 10-foot run: 16 feet.
  kit.place(fighter.id, 5, 6, 2);
  const running = await walk(fighter, { x: 5, y: 3, jump: true });
  assert.equal(running.status, 200, JSON.stringify(running.body));
  assert.deepEqual([kit.token(fighter.id).x, kit.token(fighter.id).y], [5, 3]);
  assert.equal(kit.token(fighter.id).movedThisRound, 5);
});

await test("Landing a jump in difficult terrain takes a DC 10 Dexterity (Acrobatics) check; on a failure the jumper lands prone.", async () => {
  const enemy = await stage(fighter);
  kit.place(enemy.id, 15, 1);
  kit.openField([[5, 3, ","]]);
  kit.place(fighter.id, 5, 6, 2);
  world.dice(1);
  const out = await walk(fighter, { x: 5, y: 3, jump: true });
  world.clearDice();
  assert.equal(out.status, 200, JSON.stringify(out.body));
  assert.ok(lower(world.sheet(fighter.id).conditions).includes("prone"), "a failed landing left the jumper standing");
});

await test("The long jump is the Strength score in feet (half standing) and the high jump 3 + the Strength modifier (half standing).", async () => {
  const jump = await import("../src/lib/srd/jump.ts");
  assert.equal(jump.longJumpFeet(16, true), 16);
  assert.equal(jump.longJumpFeet(16, false), 8);
  assert.equal(jump.highJumpFeet(16, true), 6);
  assert.equal(jump.highJumpFeet(16, false), 3);
  assert.equal(jump.highJumpFeet(8, true), 2);
});

// ---- underwater combat ----

async function submerged() {
  const enemy = await stage(fighter);
  kit.openField([[5, 5, "~"], [5, 6, "~"]]);
  kit.place(fighter.id, 5, 5);
  kit.place(enemy.id, 5, 6);
  return enemy;
}

await test("Underwater, a melee weapon attack by a creature without a swimming speed is at disadvantage unless the weapon is a dagger, javelin, shortsword, spear or trident.", async () => {
  const enemy = await submerged();
  const sword = await kit.swing(fighter.id, enemy.id, [15, 15, 3], { weapon: "Longsword" });
  assert.equal(sword.ok, true, sword.error);
  assert.equal(d20Faces(sword.toHit).length, 2, "a longsword swung underwater had no disadvantage");
  kit.freshTurn();
  const short = await kit.swing(fighter.id, enemy.id, [15, 3], { weapon: "Shortsword" });
  assert.equal(short.ok, true, short.error);
  assert.equal(d20Faces(short.toHit).length, 1, "a shortsword underwater was at disadvantage");
  kit.freshRound();
  const bite = await mk.forced([15, 15, 1], () => world.invoke("enemy_attack", { enemyId: enemy.id, targetCharacterId: fighter.id }));
  assert.equal(bite.ok, true, bite.error);
  assert.equal(d20Count(bite.rolled), 2, "the enemy's club underwater had no disadvantage");
});

await test("Underwater, a ranged weapon attack past its normal range misses; within it, it is at disadvantage unless the weapon is a crossbow, a net or a thrown weapon.", async () => {
  const enemy = await submerged();
  kit.place(enemy.id, 5, 8);
  const bow = await kit.swing(fighter.id, enemy.id, [15, 15, 3], { weapon: "Longbow" });
  assert.equal(bow.ok, true, bow.error);
  assert.equal(d20Faces(bow.toHit).length, 2, "a longbow underwater had no disadvantage");
  kit.freshTurn();
  const crossbow = await kit.swing(fighter.id, enemy.id, [15, 3], { weapon: "Light Crossbow" });
  assert.equal(crossbow.ok, true, crossbow.error);
  assert.equal(d20Faces(crossbow.toHit).length, 1, "a crossbow underwater was at disadvantage");
  kit.freshTurn();
  // A hand crossbow's normal range is 30 feet; the target stands 45 feet off.
  kit.place(enemy.id, 5, 14);
  const far = await kit.swing(fighter.id, enemy.id, [15, 3], { weapon: "Hand Crossbow" });
  assert.equal(far.ok, false, "a crossbow bolt flew past its normal range underwater");
  assert.ok(!world.encounter().turnBudget?.actionUsed, "the refused shot spent the action");
});

await test("A creature fully immersed in water has resistance to fire damage.", async () => {
  const enemy = await submerged();
  const burned = await world.invoke("apply_damage", { characterId: fighter.id, amount: 10, type: "fire" });
  assert.equal(burned.ok, true, burned.error);
  assert.equal(world.sheet(fighter.id).currentHp, 55);
  const scorched = await world.invoke("damage_enemy", { enemyId: enemy.id, amount: 10, type: "fire" });
  assert.equal(scorched.ok, true, scorched.error);
  assert.equal(kit.enemy(enemy.id).currentHp, DUMMY.maxHp - 5);
});

// ---- silvered and adamantine weapons ----

await test("A silvered weapon passes resistance and immunity to nonmagical attacks that aren't silvered; an adamantine one those that aren't adamantine.", async () => {
  const werewolf = "bludgeoning, piercing, and slashing from nonmagical attacks that aren't silvered";
  assert.equal(damageAdjust(10, "slashing", "", werewolf, "", { silvered: true }).amount, 10);
  assert.equal(damageAdjust(10, "slashing", "", werewolf, "", {}).amount, 0);
  const golem = "bludgeoning, piercing, and slashing from nonmagical attacks that aren't adamantine";
  assert.equal(damageAdjust(10, "slashing", "", golem, "", { adamantine: true }).amount, 10);
  assert.equal(damageAdjust(10, "slashing", "", golem, "", { silvered: true }).amount, 0);
  const enemy = await stage(fighter);
  kit.setEnemy(enemy.id, { stats: { ...DUMMY, immune: werewolf } });
  kit.place(fighter.id, 5, 5);
  kit.place(enemy.id, 5, 6);
  const plain = await kit.swing(fighter.id, enemy.id, [15, 6], { weapon: "Longsword" });
  assert.equal(plain.ok, true, plain.error);
  assert.equal(kit.enemy(enemy.id).currentHp, DUMMY.maxHp, "a plain longsword hurt a werewolf");
  kit.freshTurn();
  const silver = await kit.swing(fighter.id, enemy.id, [15, 6], { weapon: "Silvered Longsword" });
  assert.equal(silver.ok, true, silver.error);
  assert.equal(kit.enemy(enemy.id).currentHp, DUMMY.maxHp - 9, "the silvered longsword did not pass the immunity");
});

// ---- blinded and deafened checks ----

await test("A blinded creature automatically fails any ability check that requires sight; a deafened one any that requires hearing.", async () => {
  world.patch(fighter.id, { conditions: ["blinded"], conditionMeta: {} });
  const spot = await world.invoke("request_roll", { characterId: fighter.id, kind: "skill_check", skill: "perception", reason: "spot the tracks in the mud" });
  assert.equal(spot.ok, true, spot.error);
  assert.equal(spot.result.autoFailed, true, "a blinded character rolled to spot tracks");
  const listen = await mk.forced([10], () => world.invoke("request_roll", { characterId: fighter.id, kind: "skill_check", skill: "perception", reason: "listen at the door" }));
  assert.notEqual(listen.result.autoFailed, true, "a blinded character failed a hearing check");
  world.patch(fighter.id, { conditions: ["deafened"], conditionMeta: {} });
  const hear = await world.invoke("request_roll", { characterId: fighter.id, kind: "skill_check", skill: "perception", reason: "listen at the door" });
  assert.equal(hear.result.autoFailed, true, "a deafened character rolled to listen");
  world.patch(fighter.id, { conditions: [], conditionMeta: {} });
});

await test("A deafened creature notices nothing by ear, and a blinded one nothing by sight, on a passive check.", async () => {
  await kit.endFight();
  world.patch(fighter.id, { conditions: ["deafened"], conditionMeta: {} });
  const heard = await world.invoke("check_notice", { dc: 5, by: "hearing", characterIds: [fighter.id] });
  assert.equal(heard.ok, true, heard.error);
  assert.ok(heard.result.missedBy.includes(fighter.name), "a deafened character heard it");
  world.patch(fighter.id, { conditions: ["blinded"], conditionMeta: {} });
  const seen = await world.invoke("check_notice", { dc: 5, by: "sight", characterIds: [fighter.id] });
  assert.ok(seen.result.missedBy.includes(fighter.name), "a blinded character saw it");
  world.patch(fighter.id, { conditions: [], conditionMeta: {} });
});

await kit.endFight();
world.close();
finish();
