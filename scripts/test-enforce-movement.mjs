// Movement on the battle map: the player's own move (the route a client
// calls, src/app/api/campaigns/[campaignId]/battle-map/move) and the DM's
// move_token and teleport_token. Speed is spent square by square, difficult
// ground costs double, nobody moves on a turn that is not theirs or while
// their speed is 0, and walking out of an enemy's reach draws one
// opportunity attack from it (src/lib/dm/opportunity.ts).
//
// ODM's own rules, pinned here as it documents them:
//   - One square is 5 feet and a diagonal is one square
//     (src/lib/battlemap/movement.ts STEPS). SRD 5.1 plays it the same way;
//     the 5-10-5 diagonal is a DMG variant.
//   - Nobody moves onto another token, or through a hostile one within a
//     size of their own; an ally's space is walked through at double cost
//     (SRD 5.1, src/lib/battlemap/passage.ts).
//   - Water costs double, like difficult ground (types.ts moveCost).
//   - A killing blow from a character's opportunity attack does not end the
//     fight; the next DM turn does (docs/rules-coverage.md, Deliberate
//     omissions).
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, d20Faces, TRAINED } from "./lib/enforce-combat.mjs";

const { test, finish } = suite("test-enforce-movement");
const world = await openWorld();
const kit = await combatKit(world);

const runner = world.addHero({
  class: "fighter", level: 5, abilities: { str: 16 }, proficiencies: TRAINED,
  equipment: [{ name: "Longsword", qty: 1 }], speed: 30,
});
const friend = world.addHero({
  class: "fighter", level: 5, abilities: { str: 16 }, proficiencies: TRAINED,
  equipment: [{ name: "Longsword", qty: 1 }], speed: 30,
});
const runnerUser = { id: runner.userId };
const friendUser = { id: friend.userId };

const moveRoute = await world.route("campaigns/[campaignId]/battle-map/move");
async function walk(user, x, y) {
  world.signIn(user);
  const response = await moveRoute.POST(
    new Request(`http://odm.test/api/campaigns/${world.campaignId}/battle-map/move`, {
      method: "POST",
      body: JSON.stringify({ x, y }),
    }),
    { params: Promise.resolve({ campaignId: world.campaignId }) },
  );
  return { status: response.status, body: await response.json().catch(() => ({})) };
}

// runner at the pointer on 2,2; friend far off; `count` dummies parked.
async function stage({ count = 1, paint = [] } = {}) {
  await kit.endFight();
  await kit.fight(count, { heroFaces: { [runner.id]: 19, [friend.id]: 10 } });
  kit.openField(paint);
  kit.place(runner.id, 2, 2);
  kit.place(friend.id, 18, 2);
  const enemies = world.enemies();
  enemies.forEach((enemy, index) => {
    kit.setEnemy(enemy.id, { maxHp: 400 });
    kit.place(enemy.id, 18, 12 - index * 3);
  });
  world.patch(runner.id, { currentHp: 30, ac: 12, acOverride: true, conditions: [], exhaustion: 0 });
  world.patch(friend.id, { currentHp: 30, ac: 12, acOverride: true, conditions: [] });
  return enemies;
}

const at = (id) => [kit.token(id).x, kit.token(id).y];

await test("speed is spent square by square and the rest is refused", async () => {
  await stage();
  assert.equal((await walk(runnerUser, 5, 2)).status, 200);
  assert.deepEqual(at(runner.id), [5, 2]);
  assert.equal(kit.token(runner.id).movedThisRound, 3);
  // Three squares left: four is one too many.
  const tooFar = await walk(runnerUser, 9, 2);
  assert.ok(tooFar.status >= 400);
  assert.deepEqual(at(runner.id), [5, 2]);
  assert.equal(kit.token(runner.id).movedThisRound, 3);
  assert.equal((await walk(runnerUser, 8, 2)).status, 200);
  assert.equal(kit.token(runner.id).movedThisRound, 6);
  assert.ok((await walk(runnerUser, 9, 2)).status >= 400);
  assert.deepEqual(at(runner.id), [8, 2]);
});

await test("a diagonal is one square (ODM's rule)", async () => {
  await stage();
  assert.equal((await walk(runnerUser, 8, 8)).status, 200);
  assert.equal(kit.token(runner.id).movedThisRound, 6);
});

await test("difficult ground and water cost double", async () => {
  for (const ground of [",", "~"]) {
    const paint = [];
    for (let x = 0; x < 20; x += 1) {
      for (let y = 0; y < 15; y += 1) {
        if (x !== 2 || y !== 2) {
          paint.push([x, y, ground]);
        }
      }
    }
    await stage({ paint });
    assert.ok((await walk(runnerUser, 6, 2)).status >= 400, ground);
    assert.equal((await walk(runnerUser, 5, 2)).status, 200, ground);
    assert.equal(kit.token(runner.id).movedThisRound, 6, ground);
  }
});

await test("walls stop a move and a move goes around them", async () => {
  const wall = [];
  for (let y = 0; y < 15; y += 1) {
    wall.push([4, y, "#"]);
  }
  await stage({ paint: wall });
  assert.ok((await walk(runnerUser, 5, 2)).status >= 400);
  assert.ok((await walk(runnerUser, 4, 2)).status >= 400);
  assert.deepEqual(at(runner.id), [2, 2]);
});

await test("nobody moves onto another token or through a hostile one of their size; an ally's space is walked through", async () => {
  const [enemy] = await stage();
  // A corridor one square wide with the enemy standing in it.
  const paint = [];
  for (let x = 0; x < 20; x += 1) {
    paint.push([x, 1, "#"], [x, 3, "#"]);
  }
  kit.openField(paint);
  kit.place(enemy.id, 4, 2);
  assert.ok((await walk(runnerUser, 4, 2)).status >= 400);
  assert.ok((await walk(runnerUser, 5, 2)).status >= 400);
  kit.place(enemy.id, 18, 12);
  kit.place(friend.id, 4, 2);
  // SRD 5.1, Moving Around Other Creatures: through a nonhostile creature's
  // space (difficult terrain), never ending in it.
  assert.ok((await walk(runnerUser, 4, 2)).status >= 400);
  assert.equal((await walk(runnerUser, 5, 2)).status, 200);
  assert.deepEqual(at(runner.id), [5, 2]);
});

await test("nobody moves on a turn that is not theirs", async () => {
  await stage();
  assert.equal(kit.current().characterId, runner.id);
  const before = at(friend.id);
  assert.equal((await walk(friendUser, before[0] - 1, before[1])).status, 409);
  assert.deepEqual(at(friend.id), before);
  world.signIn(world.addUser("stranger"));
  assert.ok((await walk(world.addUser("stranger"), 3, 3)).status >= 400);
});

await test("nobody moves at speed 0 or at 0 hit points", async () => {
  for (const condition of ["grappled", "restrained", "paralyzed", "stunned", "unconscious"]) {
    await stage();
    world.patch(runner.id, { conditions: [condition] });
    assert.equal((await walk(runnerUser, 3, 2)).status, 409, condition);
    assert.deepEqual(at(runner.id), [2, 2], condition);
  }
  await stage();
  world.patch(runner.id, { exhaustion: 5 });
  assert.equal((await walk(runnerUser, 3, 2)).status, 409);
  await stage();
  world.patch(runner.id, { currentHp: 0 });
  assert.equal((await walk(runnerUser, 3, 2)).status, 409);
  assert.deepEqual(at(runner.id), [2, 2]);
});

await test("exhaustion level 2 halves the speed", async () => {
  await stage();
  world.patch(runner.id, { exhaustion: 2 });
  assert.ok((await walk(runnerUser, 6, 2)).status >= 400);
  assert.equal((await walk(runnerUser, 5, 2)).status, 200);
});

await test("Dash doubles the movement for the turn, and only that turn", async () => {
  await stage();
  assert.equal((await world.invoke("take_action", { characterId: runner.id, action: "dash" })).ok, true);
  assert.equal((await walk(runnerUser, 8, 2)).status, 200);
  assert.equal((await walk(runnerUser, 14, 2)).status, 200);
  assert.equal(kit.token(runner.id).movedThisRound, 12);
  assert.ok((await walk(runnerUser, 15, 2)).status >= 400);
  // Round the order: the next turn is 30 feet again.
  assert.equal(kit.endTurn(runner.userId), true);
  assert.equal(kit.endTurn(friend.userId), true);
  assert.equal(kit.current().characterId, runner.id);
  assert.equal(kit.token(runner.id).movedThisRound, 0);
  assert.ok((await walk(runnerUser, 7, 2)).status >= 400);
  assert.equal((await walk(runnerUser, 8, 2)).status, 200);
});

await test("movement can be split around an attack", async () => {
  const [enemy] = await stage();
  kit.place(enemy.id, 5, 3);
  assert.equal((await walk(runnerUser, 4, 2)).status, 200);
  const swing = await kit.swing(runner.id, enemy.id, [15, 4]);
  assert.equal(swing.result.hit, true);
  // Still next to the enemy at 5,2, so nothing is provoked.
  assert.equal((await walk(runnerUser, 5, 2)).status, 200);
  assert.equal(kit.token(runner.id).movedThisRound, 3);
  assert.equal(world.sheet(runner.id).currentHp, 30);
});

await test("leaving an enemy's reach draws its opportunity attack, and spends its reaction", async () => {
  const [enemy] = await stage();
  kit.place(enemy.id, 2, 3);
  world.dice(15, 4);
  const moved = await walk(runnerUser, 2, 0);
  assert.equal(world.clearDice(), 0);
  assert.equal(moved.status, 200);
  assert.deepEqual(at(runner.id), [2, 0]);
  // +4 for 1d6+2.
  assert.equal(world.sheet(runner.id).currentHp, 30 - 6);
  assert.deepEqual(world.encounter().reactionsUsed, [enemy.id]);
});

await test("one reaction: the same enemy does not strike a second character that round", async () => {
  const [enemy] = await stage();
  kit.place(enemy.id, 2, 3);
  kit.place(friend.id, 3, 3);
  world.dice(15, 4);
  assert.equal((await walk(runnerUser, 2, 0)).status, 200);
  world.clearDice();
  assert.equal(kit.endTurn(runner.userId), true);
  world.dice(15, 4);
  assert.equal((await walk(friendUser, 5, 3)).status, 200);
  assert.equal(world.clearDice(), 2);
  assert.equal(world.sheet(friend.id).currentHp, 30);
});

await test("moving inside an enemy's reach provokes nothing", async () => {
  const [enemy] = await stage();
  kit.place(enemy.id, 2, 3);
  world.dice(15, 4);
  assert.equal((await walk(runnerUser, 3, 2)).status, 200);
  assert.equal(world.clearDice(), 2);
  assert.equal(world.sheet(runner.id).currentHp, 30);
  assert.deepEqual(world.encounter().reactionsUsed, []);
});

await test("Disengage: no opportunity attack", async () => {
  const [enemy] = await stage();
  kit.place(enemy.id, 2, 3);
  assert.equal((await world.invoke("take_action", { characterId: runner.id, action: "disengage" })).ok, true);
  world.dice(15, 4);
  assert.equal((await walk(runnerUser, 2, 0)).status, 200);
  assert.equal(world.clearDice(), 2);
  assert.equal(world.sheet(runner.id).currentHp, 30);
  assert.deepEqual(world.encounter().reactionsUsed, []);
});

await test("a teleport and a forced move provoke nothing and spend no movement", async () => {
  const [enemy] = await stage();
  kit.place(enemy.id, 2, 3);
  world.dice(15, 4);
  const jump = await world.invoke("teleport_token", { tokenName: runner.id, x: 8, y: 8, rangeFeet: 30 });
  assert.equal(jump.ok, true, jump.error);
  assert.equal(world.clearDice(), 2);
  assert.deepEqual(at(runner.id), [8, 8]);
  assert.equal(kit.token(runner.id).movedThisRound, 0);
  assert.equal(world.sheet(runner.id).currentHp, 30);
  // Past the spell's range: refused.
  const far = await world.invoke("teleport_token", { tokenName: runner.id, x: 16, y: 8, rangeFeet: 30 });
  assert.equal(far.ok, false);
  assert.deepEqual(at(runner.id), [8, 8]);
  // A push on somebody else's turn.
  kit.place(friend.id, 5, 5);
  kit.place(enemy.id, 5, 6);
  world.dice(15, 4);
  const push = await world.invoke("move_token", { tokenName: friend.id, x: 5, y: 3, forced: true });
  assert.equal(push.ok, true, push.error);
  assert.equal(world.clearDice(), 2);
  assert.equal(world.sheet(friend.id).currentHp, 30);
});

await test("the DM cannot walk a player's token for them", async () => {
  await stage();
  const plain = await world.invoke("move_token", { tokenName: runner.id, x: 3, y: 2 });
  assert.equal(plain.ok, false);
  const forced = await world.invoke("move_token", { tokenName: runner.id, x: 3, y: 2, forced: true });
  assert.equal(forced.ok, false);
  assert.deepEqual(at(runner.id), [2, 2]);
});

await test("an enemy's move stops where its speed runs out", async () => {
  const [enemy] = await stage();
  kit.place(enemy.id, 2, 10);
  const moved = await world.invoke("move_token", { tokenName: enemy.id, x: 12, y: 10 });
  assert.equal(moved.ok, true, moved.error);
  assert.deepEqual(at(enemy.id), [8, 10]);
  assert.equal(kit.token(enemy.id).movedThisRound, 6);
  const again = await world.invoke("move_token", { tokenName: enemy.id, x: 12, y: 10 });
  assert.equal(again.ok, false);
  assert.deepEqual(at(enemy.id), [8, 10]);
});

await test("an enemy leaving a character's reach draws their opportunity attack", async () => {
  const [enemy] = await stage();
  kit.place(enemy.id, 2, 3);
  world.dice(15, 4);
  const moved = await world.invoke("move_token", { tokenName: enemy.id, x: 2, y: 6 });
  assert.equal(world.clearDice(), 0);
  assert.equal(moved.ok, true, moved.error);
  // 1d8+3 from the longsword.
  assert.equal(kit.enemy(enemy.id).currentHp, 400 - 7);
  assert.deepEqual(world.encounter().reactionsUsed, [runner.id]);
  // The reaction is spent: a second enemy walks away untouched.
});

await test("a character's reaction is one: the second enemy walks away untouched", async () => {
  const [one, two] = await stage({ count: 2 });
  kit.place(one.id, 2, 3);
  kit.place(two.id, 3, 2);
  world.dice(15, 4);
  assert.equal((await world.invoke("move_token", { tokenName: one.id, x: 2, y: 6 })).ok, true);
  world.clearDice();
  world.dice(15, 4);
  assert.equal((await world.invoke("move_token", { tokenName: two.id, x: 6, y: 2 })).ok, true);
  assert.equal(world.clearDice(), 2);
  assert.equal(kit.enemy(two.id).currentHp, 400);
});

await test("a kill by opportunity attack leaves the fight open (ODM's rule)", async () => {
  const [enemy] = await stage();
  kit.place(enemy.id, 2, 3);
  kit.setEnemy(enemy.id, { currentHp: 2 });
  world.dice(15, 4);
  assert.equal((await world.invoke("move_token", { tokenName: enemy.id, x: 2, y: 6 })).ok, true);
  world.clearDice();
  assert.equal(kit.enemy(enemy.id).status, "dead");
  assert.notEqual(world.encounter(), null);
});

// Held elsewhere: a prone character walks at full speed
// (test-enforce-conditions-actions.mjs, conditions-prone-moves-at-full-speed).

await test("A creature provokes an opportunity attack when it moves out of an enemy's reach, wherever the move began and ended.", async () => {
  const [enemy] = await stage();
  // A corridor one square wide, the enemy in an alcove off its middle.
  const paint = [];
  for (let x = 0; x < 20; x += 1) {
    paint.push([x, 1, "#"]);
    if (x !== 5) {
      paint.push([x, 3, "#"]);
    }
  }
  kit.openField(paint);
  kit.place(enemy.id, 5, 3);
  world.dice(15, 4);
  assert.equal((await walk(runnerUser, 8, 2)).status, 200);
  world.clearDice();
  assert.deepEqual(world.encounter().reactionsUsed, [enemy.id], "the runner passed the enemy unanswered");
});

await test("An enemy that leaves a character's reach provokes that character's opportunity attack, however it came to move.", async () => {
  const [enemy] = await stage();
  kit.place(enemy.id, 2, 3);
  kit.place(friend.id, 2, 8);
  world.dice(15, 4, 15, 4);
  const out = await world.invoke("enemy_attack", { enemyId: enemy.id, targetCharacterId: friend.id });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.deepEqual(world.encounter().reactionsUsed, [runner.id], "the enemy walked out of reach unanswered");
});

await test("An opportunity attack is an attack roll like any other: a poisoned, blinded, prone or restrained attacker rolls it at disadvantage.", async () => {
  const [enemy] = await stage();
  kit.place(enemy.id, 2, 3);
  kit.setEnemy(enemy.id, { conditions: ["poisoned"] });
  world.dice(7, 13, 4);
  assert.equal((await walk(runnerUser, 2, 0)).status, 200);
  world.clearDice();
  const attack = kit.lastRolls(3).find((roll) => roll.kind === "attack");
  assert.equal(d20Faces(attack).length, 2, "a poisoned enemy's opportunity attack was a straight roll");
});

await test("An opportunity attack is made against a creature the attacker can see.", async () => {
  const [enemy] = await stage();
  kit.place(enemy.id, 2, 3);
  kit.setEnemy(enemy.id, { conditions: ["blinded"] });
  world.dice(15, 4);
  assert.equal((await walk(runnerUser, 2, 0)).status, 200);
  world.clearDice();
  assert.equal(world.sheet(runner.id).currentHp, 30, "a blinded enemy made an opportunity attack");
});

await test("A critical hit rolls the attack's damage dice twice, on an opportunity attack as on any other.", async () => {
  const [enemy] = await stage();
  kit.place(enemy.id, 2, 3);
  world.dice(20, 4, 5);
  assert.equal((await world.invoke("move_token", { tokenName: enemy.id, x: 2, y: 6 })).ok, true);
  world.clearDice();
  assert.equal(kit.enemy(enemy.id).currentHp, 400 - (4 + 5 + 3), `a critical opportunity attack dealt ${400 - kit.enemy(enemy.id).currentHp}`);
});

// Added last: a third hero would change the turn order the tests above read.
await test("a raging barbarian's opportunity attack is an attack that keeps the rage going, and carries the rage's damage", async () => {
  const { skipCurrentTurn } = await import("../src/lib/dm/encounter-tools.ts");
  const brute = world.addHero({
    class: "barbarian", level: 5, abilities: { str: 16 }, proficiencies: TRAINED,
    equipment: [{ name: "Greataxe", qty: 1 }], speed: 30,
  });
  const [enemy] = await stage();
  // Order: the runner (19), the barbarian (15), the friend (10), the enemy.
  kit.place(runner.id, 18, 6);
  kit.place(brute.id, 10, 10);
  kit.place(enemy.id, 10, 11);
  world.patch(brute.id, { currentHp: 40, conditions: ["raging"], conditionMeta: { raging: { rounds: 10 } } });
  world.dice(15, 4);
  assert.equal((await world.invoke("move_token", { tokenName: enemy.id, x: 10, y: 14 })).ok, true);
  assert.equal(world.clearDice(), 0);
  // 1d12 + STR 3 + rage 2 at 5th level.
  assert.equal(kit.enemy(enemy.id).currentHp, 400 - (4 + 3 + 2));
  assert.deepEqual(world.encounter().reactionsUsed, [brute.id]);
  assert.deepEqual(world.sheet(brute.id).conditionMeta.raging, { rounds: 10, stoked: true });
  // The barbarian's own turn passes with no attack and no damage: the swing
  // since their last turn keeps the rage.
  assert.equal(world.encounter().order[world.encounter().turnIndex].characterId, runner.id);
  skipCurrentTurn(world.campaignId);
  assert.equal(world.encounter().order[world.encounter().turnIndex].characterId, brute.id);
  skipCurrentTurn(world.campaignId);
  assert.ok(world.sheet(brute.id).conditions.includes("raging"), "the rage ended though the barbarian attacked since their last turn");
  assert.equal(world.sheet(brute.id).conditionMeta.raging.stoked, undefined, "the mark is spent with the turn");
  // A whole round of nothing after that, and it ends.
  for (let turn = 0; turn < 8 && world.encounter().order[world.encounter().turnIndex].characterId !== brute.id; turn += 1) {
    skipCurrentTurn(world.campaignId);
  }
  skipCurrentTurn(world.campaignId);
  assert.equal(world.sheet(brute.id).conditions.includes("raging"), false);
  world.patch(brute.id, { currentHp: 0, deathSaves: { successes: 0, failures: 3, stable: false, dead: true } });
});

await kit.endFight();
world.close();
finish();
