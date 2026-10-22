// Where combatants stand decides what an attack may do (src/lib/dm/
// map-tools.ts checkPcAttackRange, pcAttackSpatials, approachForAttack and
// src/lib/battlemap/los.ts): a melee attack needs its target in reach, a
// ranged one needs it in range and in sight, cover raises the Armor Class to
// meet, and a wall between the two stops the shot.
//
// ODM's own rules, pinned here as it documents them:
//   - One square is 5 feet and distance is counted Chebyshev: a diagonal
//     step is one square.
//   - Cover is read from the squares next to the target on the attacker's
//     side: one blocking square is half cover (+2), two are three-quarters
//     (+5), a low wall is half cover and never more (los.ts coverBetween).
//   - An enemy out of melee reach walks up to its target along a legal path
//     as part of enemy_attack, out of its own speed (approachForAttack).
//     A player is moved only when the attack says their player closes in
//     (pc_attack's approach, pc-attack-approach.ts); otherwise their attack
//     is refused instead.
//   - An attack-roll spell reaches 120 feet whatever the spell
//     (attack-logic.ts spellAttackProfile).
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { abilityMod, proficiencyBonus, suite } from "./lib/enforce-harness.mjs";
import { combatKit, d20Faces, TRAINED } from "./lib/enforce-combat.mjs";

const { test, finish } = suite("test-enforce-range");
const world = await openWorld();
const kit = await combatKit(world);

const hero = world.addHero({
  class: "fighter", level: 5, abilities: { str: 16, dex: 14 }, proficiencies: TRAINED,
  equipment: [
    { name: "Longsword", qty: 1 }, { name: "Glaive", qty: 1 }, { name: "Dagger", qty: 1 },
    { name: "Shortbow", qty: 1 },
  ],
});
const TO_HIT_STR = abilityMod(16) + proficiencyBonus(5);
const TO_HIT_DEX = abilityMod(14) + proficiencyBonus(5);

// The hero at `from`, the dummy at `to`, on a floor painted with `paint`.
async function stage(from, to, paint = []) {
  await kit.endFight();
  await kit.fight(1, { heroFaces: { [hero.id]: 19 } });
  const [enemy] = world.enemies();
  kit.setEnemy(enemy.id, { maxHp: 400 });
  kit.openField(paint);
  kit.place(hero.id, from[0], from[1]);
  kit.place(enemy.id, to[0], to[1]);
  world.patch(hero.id, { currentHp: 30, ac: 12, acOverride: true, conditions: [] });
  return enemy;
}

const refused = async (enemy, args, label) => {
  const swing = await kit.swing(hero.id, enemy.id, [15, 4], args);
  assert.equal(swing.ok, false, label);
  assert.equal(swing.unused, 2, label);
  assert.equal(kit.enemy(enemy.id).currentHp, 400, label);
  // A refused attack is not an attack made.
  assert.equal(world.encounter().turnBudget, null, label);
};

await test("melee: in reach at 5 feet, diagonals included, refused at 10", async () => {
  for (const spot of [[5, 6], [6, 6], [4, 4], [6, 5]]) {
    const enemy = await stage([5, 5], spot);
    const swing = await kit.swing(hero.id, enemy.id, [15, 4], { weapon: "Longsword" });
    assert.equal(swing.result.hit, true, spot.join());
  }
  for (const spot of [[5, 7], [7, 7], [3, 5]]) {
    const enemy = await stage([5, 5], spot);
    await refused(enemy, { weapon: "Longsword" }, spot.join());
  }
});

await test("an attack out of reach names the nearest open square beside the target, and from there it lands", async () => {
  // Qwen3.5 9B walked a character twice the wrong way when told only to
  // "move adjacent": the refusal now says where.
  const enemy = await stage([5, 5], [9, 5]);
  const swing = await kit.swing(hero.id, enemy.id, [15, 4], { weapon: "Longsword" });
  assert.equal(swing.ok, false);
  const named = /nearest open square beside .+ is \((\d+),(\d+)\): move_token/.exec(swing.error ?? "");
  assert.ok(named, `no square named: ${swing.error}`);
  const [x, y] = [Number(named[1]), Number(named[2])];
  assert.ok(Math.max(Math.abs(x - 9), Math.abs(y - 5)) === 1, `(${x},${y}) is not beside the target`);
  assert.equal(Math.max(Math.abs(x - 5), Math.abs(y - 5)), 3, `(${x},${y}) is not the nearest such square`);
  kit.place(hero.id, x, y);
  const from = await kit.swing(hero.id, enemy.id, [15, 4], { weapon: "Longsword" });
  assert.equal(from.result?.hit, true, from.error);
});

await test("approach: a player who closes in walks to the nearest square beside the target and strikes from there", async () => {
  const enemy = await stage([5, 5], [9, 5]);
  kit.giveTurn(hero.id);
  const swing = await kit.swing(hero.id, enemy.id, [15, 4], { weapon: "Longsword", approach: true });
  assert.equal(swing.ok, true, swing.error);
  assert.equal(swing.result.hit, true);
  const token = kit.token(hero.id);
  assert.equal(Math.max(Math.abs(token.x - 9), Math.abs(token.y - 5)), 1, `(${token.x},${token.y}) is not beside the target`);
  assert.equal(swing.result.approached?.movementSpent, "15 ft", JSON.stringify(swing.result.approached));
});

await test("approach: too far to reach this turn, they close in as far as they can and nothing is attacked", async () => {
  // 50 feet off: 30 feet of movement leaves them 20 feet short.
  const enemy = await stage([5, 5], [15, 5]);
  kit.giveTurn(hero.id);
  const swing = await kit.swing(hero.id, enemy.id, [15, 4], { weapon: "Longsword", approach: true });
  assert.equal(swing.ok, false);
  assert.match(swing.error ?? "", /still out of reach, so nothing was attacked/);
  assert.equal(swing.unused, 2, "dice were rolled for an attack that never happened");
  assert.equal(kit.enemy(enemy.id).currentHp, 400);
  assert.equal(kit.token(hero.id).x, 11, "the hero did not close in by their speed");
  assert.equal(world.encounter().turnBudget, null, "a walk is no attack made");
});

await test("approach walks nobody whose turn has no attack left: the swing is refused where they stand", async () => {
  const enemy = await stage([5, 5], [6, 5]);
  kit.giveTurn(hero.id);
  // A 5th-level fighter: two swings with Extra Attack.
  for (const faces of [[15, 4], [15, 4]]) {
    const swing = await kit.swing(hero.id, enemy.id, faces, { weapon: "Longsword" });
    assert.equal(swing.result.hit, true, swing.error);
  }
  kit.place(enemy.id, 9, 5);
  const swing = await kit.swing(hero.id, enemy.id, [15, 4], { weapon: "Longsword", approach: true });
  assert.equal(swing.ok, false);
  assert.match(swing.error ?? "", /already made all 2 of their attacks/);
  assert.deepEqual([kit.token(hero.id).x, kit.token(hero.id).y], [5, 5], "the hero walked for a swing the turn could not pay for");
});

await test("approach walks nobody already in reach, and nobody a thrown weapon reaches", async () => {
  let enemy = await stage([5, 5], [6, 5]);
  kit.giveTurn(hero.id);
  let swing = await kit.swing(hero.id, enemy.id, [15, 4], { weapon: "Longsword", approach: true });
  assert.equal(swing.result.hit, true, swing.error);
  assert.equal(swing.result.approached, undefined);
  enemy = await stage([5, 5], [8, 5]);
  kit.giveTurn(hero.id);
  swing = await kit.swing(hero.id, enemy.id, [10, 3], { weapon: "Dagger", approach: true });
  assert.equal(swing.ok, true, swing.error);
  assert.deepEqual([kit.token(hero.id).x, kit.token(hero.id).y], [5, 5], "a dagger in throwing range walked its thrower");
});

await test("a token named by one letter is no enemy whose name holds that letter", async () => {
  // gpt-oss-20b sent "A" for Avery and walked Bandit 1, the first name with
  // an "a" in it. The goblin's name holds a "b".
  const enemy = await stage([5, 5], [12, 5]);
  const out = await world.invoke("move_token", { tokenName: "b", x: 10, y: 5 });
  assert.equal(out.ok, false);
  assert.match(out.error ?? "", /No combatant on the battle map is called "b"/);
  assert.equal(kit.token(enemy.id).x, 12);
});

await test("reach against a Large creature is measured to its nearest square (issue #186)", async () => {
  // The dummy at (5,5) fills (5,5) to (6,6). A hero at (7,6) stands against
  // its lower-right square: 5 feet, not the 10 the anchors are apart.
  const sized = async (size, from) => {
    const enemy = await stage(from, [5, 5]);
    kit.setEnemy(enemy.id, { maxHp: 400, stats: { size } });
    return enemy;
  };
  for (const spot of [[7, 6], [7, 7], [6, 7], [4, 4], [4, 7]]) {
    const enemy = await sized("Large", spot);
    const swing = await kit.swing(hero.id, enemy.id, [15, 4], { weapon: "Longsword" });
    assert.equal(swing.ok, true, `Large ${spot.join()}: ${swing.error}`);
    assert.equal(swing.result.hit, true, `Large ${spot.join()}`);
  }
  for (const spot of [[8, 6], [5, 8], [3, 5]]) {
    const enemy = await sized("Large", spot);
    await refused(enemy, { weapon: "Longsword" }, `Large ${spot.join()}`);
  }
  // A glaive's 10 feet, from the same edge.
  let enemy = await sized("Large", [8, 6]);
  let swing = await kit.swing(hero.id, enemy.id, [15, 4], { weapon: "Glaive" });
  assert.equal(swing.result.hit, true, "Glaive at 10 ft from the edge");
  enemy = await sized("Large", [9, 6]);
  await refused(enemy, { weapon: "Glaive" }, "Glaive at 15 ft from the edge");
  // Huge fills (5,5) to (7,7); Gargantuan (5,5) to (8,8).
  enemy = await sized("Huge", [8, 8]);
  swing = await kit.swing(hero.id, enemy.id, [15, 4], { weapon: "Longsword" });
  assert.equal(swing.result.hit, true, "Huge corner");
  enemy = await sized("Huge", [9, 8]);
  await refused(enemy, { weapon: "Longsword" }, "Huge, one square off");
  enemy = await sized("Gargantuan", [9, 9]);
  swing = await kit.swing(hero.id, enemy.id, [15, 4], { weapon: "Longsword" });
  assert.equal(swing.result.hit, true, "Gargantuan corner");
  enemy = await sized("Gargantuan", [10, 9]);
  await refused(enemy, { weapon: "Longsword" }, "Gargantuan, one square off");
  // A thrown dagger's 20 feet counts from the edge too: (10,6) is four
  // squares from it (a straight roll), (11,6) five (disadvantage), and its
  // 60-foot long range runs out past (18,6).
  enemy = await sized("Large", [10, 6]);
  swing = await kit.swing(hero.id, enemy.id, [10, 3], { weapon: "Dagger" });
  assert.equal(swing.ok, true, swing.error);
  assert.equal(swing.toHit.advantage, "none", "Dagger at 20 ft from the edge");
  enemy = await sized("Large", [11, 6]);
  swing = await kit.swing(hero.id, enemy.id, [7, 13, 4], { weapon: "Dagger" });
  assert.equal(swing.ok, true, swing.error);
  assert.equal(swing.toHit.advantage, "disadvantage", "Dagger at 25 ft from the edge");
  enemy = await sized("Large", [18, 6]);
  swing = await kit.swing(hero.id, enemy.id, [7, 13, 4], { weapon: "Dagger" });
  assert.equal(swing.ok, true, `Dagger at 60 ft from the edge: ${swing.error}`);
});


await test("a Large enemy strikes from its own edge without walking (issue #186)", async () => {
  const enemy = await stage([7, 6], [5, 5]);
  kit.setEnemy(enemy.id, { maxHp: 400, stats: { size: "Large" } });
  world.dice(15, 3);
  const out = await world.invoke("enemy_attack", { enemyId: enemy.id, targetCharacterId: hero.id });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  const token = kit.token(enemy.id);
  assert.deepEqual([token.x, token.y], [5, 5], "it did not need to move");
  assert.equal(world.sheet(hero.id).currentHp, 30 - 5);
});

await test("a reach weapon reaches 10 feet and no farther", async () => {

  let enemy = await stage([5, 5], [5, 7]);
  const swing = await kit.swing(hero.id, enemy.id, [15, 4], { weapon: "Glaive" });
  assert.equal(swing.result.hit, true);
  enemy = await stage([5, 5], [5, 8]);
  await refused(enemy, { weapon: "Glaive" }, "15 ft");
});

await test("ranged: a straight roll in normal range, disadvantage past it", async () => {
  // Shortbow: 80 feet is 16 squares.
  let enemy = await stage([1, 1], [17, 1]);
  let swing = await kit.swing(hero.id, enemy.id, [7, 13, 4], { weapon: "Shortbow" });
  assert.equal(swing.toHit.advantage, "none");
  assert.equal(swing.toHit.total, 7 + TO_HIT_DEX);
  enemy = await stage([1, 1], [18, 1]);
  swing = await kit.swing(hero.id, enemy.id, [7, 13, 4], { weapon: "Shortbow" });
  assert.equal(swing.toHit.advantage, "disadvantage");
  assert.deepEqual(d20Faces(swing.toHit), [7, 13]);
  assert.equal(swing.toHit.total, 7 + TO_HIT_DEX);
});

await test("a thrown weapon: Strength, its own range, refused past it", async () => {
  // Dagger: 20 feet is 4 squares.
  let enemy = await stage([1, 1], [5, 1]);
  const swing = await kit.swing(hero.id, enemy.id, [10, 3], { weapon: "Dagger" });
  assert.equal(swing.toHit.advantage, "none");
  assert.equal(swing.toHit.total, 10 + TO_HIT_STR);
  enemy = await stage([1, 1], [14, 1]);
  await refused(enemy, { weapon: "Dagger" }, "65 ft");
});

await test("half cover: +2 to the Armor Class to meet", async () => {
  // The dummy stands behind the corner of a wall, diagonal to the shooter.
  const paint = [[7, 8, "#"]];
  let enemy = await stage([2, 2], [8, 8], paint);
  let swing = await kit.swing(hero.id, enemy.id, [15 - TO_HIT_DEX, 4], { weapon: "Shortbow" });
  assert.equal(swing.result.vsAc, 13 + 2);
  assert.equal(swing.result.hit, true);
  enemy = await stage([2, 2], [8, 8], paint);
  swing = await kit.swing(hero.id, enemy.id, [14 - TO_HIT_DEX, 4], { weapon: "Shortbow" });
  assert.equal(swing.result.hit, false);
  assert.equal(kit.enemy(enemy.id).currentHp, 400);
});

await test("three-quarters cover: +5", async () => {
  const paint = [[7, 8, "#"], [8, 7, "#"]];
  let enemy = await stage([2, 2], [8, 8], paint);
  let swing = await kit.swing(hero.id, enemy.id, [18 - TO_HIT_DEX, 4], { weapon: "Shortbow" });
  assert.equal(swing.result.vsAc, 13 + 5);
  assert.equal(swing.result.hit, true);
  enemy = await stage([2, 2], [8, 8], paint);
  swing = await kit.swing(hero.id, enemy.id, [17 - TO_HIT_DEX, 4], { weapon: "Shortbow" });
  assert.equal(swing.result.hit, false);
});

await test("a low wall in front of the target is half cover and leaves the sight line open", async () => {
  const enemy = await stage([5, 2], [5, 8], [[5, 7, "|"]]);
  const swing = await kit.swing(hero.id, enemy.id, [15, 4], { weapon: "Shortbow" });
  assert.equal(swing.ok, true, swing.error);
  assert.equal(swing.result.vsAc, 13 + 2);
});

await test("no cover toe to toe, and none across open floor", async () => {
  let enemy = await stage([5, 5], [5, 6], [[4, 6, "#"], [6, 6, "#"]]);
  let swing = await kit.swing(hero.id, enemy.id, [15, 4], { weapon: "Longsword" });
  assert.equal(swing.result.vsAc, 13);
  enemy = await stage([2, 2], [8, 8]);
  swing = await kit.swing(hero.id, enemy.id, [15, 4], { weapon: "Shortbow" });
  assert.equal(swing.result.vsAc, 13);
});

await test("a wall on the line is total cover: the shot is refused", async () => {
  const enemy = await stage([5, 2], [5, 8], [[5, 5, "#"]]);
  await refused(enemy, { weapon: "Shortbow" }, "wall between");
  // A nat 20 is never rolled, so it cannot force the shot through.
  const swing = await kit.swing(hero.id, enemy.id, [20, 4, 4], { weapon: "Shortbow" });
  assert.equal(swing.ok, false);
});

await test("an enemy out of reach walks up to its target, out of its own speed", async () => {
  const enemy = await stage([5, 5], [5, 10]);
  world.dice(15, 3);
  const out = await world.invoke("enemy_attack", { enemyId: enemy.id, targetCharacterId: hero.id });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  const token = kit.token(enemy.id);
  assert.deepEqual([token.x, token.y], [5, 6]);
  assert.equal(token.movedThisRound, 4);
  assert.equal(world.sheet(hero.id).currentHp, 30 - 5);
});

await test("an enemy that cannot close the distance does not attack", async () => {
  // 30 feet of speed, 14 squares away.
  const enemy = await stage([2, 2], [16, 2]);
  world.dice(15, 3);
  const out = await world.invoke("enemy_attack", { enemyId: enemy.id, targetCharacterId: hero.id });
  assert.equal(world.clearDice(), 2);
  assert.equal(out.ok, false);
  assert.equal(world.sheet(hero.id).currentHp, 30);
  assert.ok(kit.token(enemy.id).movedThisRound <= 6);
});

await test("an enemy held at speed 0 cannot walk up", async () => {
  const enemy = await stage([5, 5], [5, 8]);
  for (const condition of ["grappled", "restrained"]) {
    kit.setEnemy(enemy.id, { conditions: [condition] });
    world.dice(15, 3);
    const out = await world.invoke("enemy_attack", { enemyId: enemy.id, targetCharacterId: hero.id });
    world.clearDice();
    assert.equal(out.ok, false, condition);
    assert.deepEqual([kit.token(enemy.id).x, kit.token(enemy.id).y], [5, 8], condition);
  }
});

await test("an enemy's ranged attack needs a sight line", async () => {
  // Boxed in: no square it can reach has one.
  const box = [];
  for (let x = 13; x <= 17; x += 1) {
    for (let y = 8; y <= 12; y += 1) {
      if (x === 13 || x === 17 || y === 8 || y === 12) {
        box.push([x, y, "#"]);
      }
    }
  }
  const enemy = await stage([2, 2], [15, 10], box);
  kit.setEnemy(enemy.id, { stats: { attacks: [{ name: "Shortbow", toHit: 4, damage: "1d6+2", type: "piercing" }] } });
  world.dice(15, 3);
  const out = await world.invoke("enemy_attack", { enemyId: enemy.id, targetCharacterId: hero.id });
  world.clearDice();
  assert.equal(out.ok, false);
  assert.equal(world.sheet(hero.id).currentHp, 30);
});

// Held elsewhere: long range is taken as twice the normal range for every
// weapon (test-enforce-weapons.mjs, weapons-long-range).

await test("A target behind total cover cannot be attacked.", async () => {
  const enemy = await stage([5, 5], [5, 7], [[5, 6, "#"]]);
  const swing = await kit.swing(hero.id, enemy.id, [15, 4], { weapon: "Glaive" });
  assert.equal(swing.ok, false, "a glaive struck through a wall");
});

await test("Cover protects whoever stands behind it: a character behind half cover has +2 AC against an enemy's attack.", async () => {
  const enemy = await stage([8, 8], [2, 2], [[7, 8, "#"]]);
  kit.setEnemy(enemy.id, { stats: { attacks: [{ name: "Shortbow", toHit: 4, damage: "1d6+2", type: "piercing" }] } });
  world.dice(9, 3);
  const out = await world.invoke("enemy_attack", { enemyId: enemy.id, targetCharacterId: hero.id });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(out.result.vsAc, 12 + 2, `the shot was rolled against AC ${out.result.vsAc}`);
});

await test("A ranged attack made with a hostile creature within 5 feet has disadvantage, for monsters as for characters.", async () => {
  const enemy = await stage([5, 5], [5, 6]);
  kit.setEnemy(enemy.id, { stats: { attacks: [{ name: "Shortbow", toHit: 4, damage: "1d6+2", type: "piercing" }] } });
  world.dice(7, 13, 3);
  const out = await world.invoke("enemy_attack", { enemyId: enemy.id, targetCharacterId: hero.id });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  // The newest attack roll: the list runs oldest first, and the fights
  // staged before this one left attack rolls of their own in it.
  const attack = kit.lastRolls(3).findLast((roll) => roll.kind === "attack");
  assert.equal(attack.advantage, "disadvantage", "a bow shot from 5 feet was a straight roll");
  assert.deepEqual(d20Faces(attack), [7, 13]);
});

await kit.endFight();
world.close();
finish();
