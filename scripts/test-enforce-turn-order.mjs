// Whose turn it is, and who may act on it. The initiative pointer names one
// combatant; ending a turn is theirs to do (or the DM's, for them), an attack
// made on somebody else's turn is a reaction and there is one of those a
// round, and an enemy acts once a round with as many swings as its stat block
// gives it.
//
// ODM's own rules, pinned here as it documents them:
//   - An attack does not end a turn. Only end_turn, or the player's End Turn
//     button, moves the pointer (src/lib/dm/encounter-tools.ts).
//   - A Multiattack is resolved inside ONE enemy_attack call, every swing the
//     same attack, stopping when the target drops.
//   - The per-turn caps (ENCOUNTER_CAP_PER_TURN, MUTATION_CAP_PER_TURN) are
//     rails on the model and never on a person (src/lib/dm/invoke.ts).
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";

const { test, finish } = suite("test-enforce-turn-order");
const world = await openWorld();
const kit = await combatKit(world);
const { invokeEngine } = await import("../src/lib/dm/invoke.ts");
const { createDmTurn } = await import("../src/lib/db/dm-turns.ts");
const { setMemberHoldRolls } = await import("../src/lib/db/campaigns.ts");
const { ENCOUNTER_CAP_PER_TURN } = await import("../src/lib/dm/encounter-tools.ts");
const { MUTATION_CAP_PER_TURN } = await import("../src/lib/dm/mutations.ts");

const first = world.addHero({
  class: "fighter", level: 5, abilities: { str: 16 }, proficiencies: TRAINED,
  equipment: [{ name: "Longsword", qty: 1 }],
});
const second = world.addHero({
  class: "rogue", level: 5, abilities: { dex: 16 }, proficiencies: TRAINED,
  equipment: [{ name: "Shortsword", qty: 1 }],
});
const outsider = world.addUser("stranger");

// first acts on 18, second on 10, the enemies after both.
async function stage(count = 2) {
  await kit.endFight();
  await kit.fight(count, { heroFaces: { [first.id]: 18, [second.id]: 10 } });
  const enemies = world.enemies();
  kit.place(first.id, 5, 5);
  kit.place(second.id, 5, 7);
  kit.place(enemies[0].id, 5, 6);
  return enemies;
}

const endTurnRoute = await world.route("campaigns/[campaignId]/encounter/end-turn");
async function pressEndTurn(user) {
  world.signIn(user);
  const response = await endTurnRoute.POST(
    new Request(`http://odm.test/api/campaigns/${world.campaignId}/encounter/end-turn`, { method: "POST" }),
    { params: Promise.resolve({ campaignId: world.campaignId }) },
  );
  return response.status;
}

await test("end_turn for a character whose turn it is not is refused", async () => {
  await stage();
  const before = world.encounter();
  const refused = await world.invoke("end_turn", { characterId: second.id });
  assert.equal(refused.ok, false);
  assert.equal(world.encounter().turnIndex, before.turnIndex);
  assert.equal(world.encounter().round, before.round);
});

await test("the End Turn button does nothing for a player whose turn it is not", async () => {
  const before = world.encounter();
  const secondUser = { id: second.userId };
  assert.equal(await pressEndTurn(secondUser), 409);
  assert.ok((await pressEndTurn(outsider)) >= 400);
  assert.equal(world.encounter().turnIndex, before.turnIndex);
  assert.equal(world.encounter().round, before.round);
  assert.equal(kit.current().characterId, first.id);
});

await test("a player ends their own turn and the pointer moves to the next character", async () => {
  assert.equal(kit.endTurn(second.userId), false);
  assert.equal(kit.endTurn(first.userId), true);
  assert.equal(kit.current().characterId, second.id);
  assert.equal(world.encounter().round, 1);
  // The turn that ended took its budget with it.
  assert.equal(world.encounter().turnBudget, null);
});

await test("an attack does not end the turn (ODM's rule)", async () => {
  const [enemy] = await stage();
  world.dice(10, 4);
  const swing = await kit.attack(first.id, enemy.id);
  world.clearDice();
  assert.equal(swing.ok, true, swing.error);
  assert.equal(kit.current().characterId, first.id);
});

await test("an enemy's Multiattack is as many swings as its stat block gives", async () => {
  const [enemy] = await stage();
  kit.setEnemy(enemy.id, { stats: { attacksPerTurn: 2 } });
  world.patch(first.id, { ac: 12, acOverride: true });
  world.diceLog();
  // Two swings: a hit for 1d6+2 and a miss.
  world.dice(15, 3, 2);
  const out = await world.invoke("enemy_attack", { enemyId: enemy.id, targetCharacterId: first.id });
  assert.equal(world.clearDice(), 0);
  assert.equal(out.ok, true, out.error);
  assert.equal(out.result.swings.length, 2);
  assert.deepEqual(out.result.swings.map((swing) => swing.hit), [true, false]);
  assert.equal(world.sheet(first.id).currentHp, first.currentHp - 5);
  assert.deepEqual(world.diceLog().map((die) => die.sides), [20, 6, 20]);
});

await test("a Multiattack stops when the target drops", async () => {
  const [enemy] = await stage();
  kit.setEnemy(enemy.id, { stats: { attacksPerTurn: 3 } });
  world.patch(first.id, { currentHp: 4 });
  world.diceLog();
  world.dice(15, 6, 15, 6);
  const out = await world.invoke("enemy_attack", { enemyId: enemy.id, targetCharacterId: first.id });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(out.result.swings.length, 1);
  assert.equal(world.sheet(first.id).currentHp, 0);
  assert.equal(world.diceLog().length, 2);
});

await test("the caps on the model are 12 encounter actions and 10 sheet changes a turn", () => {
  assert.equal(ENCOUNTER_CAP_PER_TURN, 12);
  assert.equal(MUTATION_CAP_PER_TURN, 10);
});

await test("a person running the table is not capped", async () => {
  const [enemy] = await stage();
  kit.setEnemy(enemy.id, { maxHp: 200 });
  for (let index = 0; index < ENCOUNTER_CAP_PER_TURN + 3; index += 1) {
    const out = await world.invoke("damage_enemy", { enemyId: enemy.id, amount: 1 });
    assert.equal(out.ok, true, out.error);
  }
  assert.equal(kit.enemy(enemy.id).currentHp, 200 - ENCOUNTER_CAP_PER_TURN - 3);
});

// Off their own turn the attack is a readied one (or an opportunity attack,
// which the server rolls itself), so second holds a readied attack here, as
// take_action ready leaves it (test-enforce-turn-actions.mjs).
const readyUp = (hero) =>
  world.patch(hero.id, {
    conditions: [...world.sheet(hero.id).conditions, "readied"],
    conditionMeta: { ...world.sheet(hero.id).conditionMeta, readied: { untilTurnOf: hero.id, source: "when it comes close" } },
  });

await test("Off their own turn a character attacks only with their reaction, and there is one reaction a round.", async () => {
  const [enemy] = await stage();
  kit.setEnemy(enemy.id, { maxHp: 200 });
  assert.equal(kit.current().characterId, first.id);
  readyUp(second);
  const results = [];
  for (let index = 0; index < 3; index += 1) {
    world.dice(15, 3, 3, 3, 3);
    results.push(await kit.attack(second.id, enemy.id));
    world.clearDice();
  }
  assert.equal(results[0].ok, true, results[0].error);
  assert.ok(
    results.slice(1).every((entry) => !entry.ok),
    `${results.filter((entry) => entry.ok).length} attacks resolved for a character on somebody else's turn`,
  );
});

await test("Sneak Attack is dealt once per turn, and an attack off the rogue's own turn is a turn of its own", async () => {
  const [enemy] = await stage();
  kit.setEnemy(enemy.id, { maxHp: 200 });
  // first stands next to the enemy, so second's finesse attack qualifies.
  // It is first's turn: second's attack is their reaction, and it carries
  // the dice, since Sneak Attack is once per TURN and this is not the
  // rogue's own. The attack off their turn is a readied one.
  readyUp(second);
  world.dice(15, 1, 1, 1, 1);
  const reaction = await kit.attack(second.id, enemy.id);
  world.clearDice();
  assert.equal(reaction.ok, true, reaction.error);
  // 1d6 + 3 with Sneak Attack 3d6, every die a 1: 7 with the dice.
  assert.equal(reaction.result.damage, 7);
  // There is no second attack in that turn for the dice to ride again.
  world.dice(15, 1, 1, 1, 1);
  const again = await kit.attack(second.id, enemy.id);
  assert.equal(world.clearDice(), 5);
  assert.equal(again.ok, false, "a second attack resolved off the rogue's own turn");
  // On the rogue's own turn the dice are theirs again, once.
  assert.equal(kit.endTurn(first.userId), true);
  assert.equal(kit.current().characterId, second.id);
  world.dice(15, 1, 1, 1, 1);
  const own = await kit.attack(second.id, enemy.id);
  world.clearDice();
  assert.equal(own.ok, true, own.error);
  assert.equal(own.result.damage, 7);
});

await test("a dead character does nothing: no attack, action, reaction, move or roll", async () => {
  const [enemy] = await stage();
  const dead = { successes: 0, failures: 3, stable: false, dead: true };
  // Dead on the death track and standing at full hit points on the sheet.
  world.patch(first.id, { deathSaves: dead, currentHp: first.maxHp });
  try {
    assert.equal(world.sheet(first.id).deathSaves.dead, true);
    const hp = kit.enemy(enemy.id).currentHp;
    world.dice(15, 4);
    const calls = [
      ["pc_attack", { characterId: first.id, targetEnemyId: enemy.id }],
      ["take_action", { characterId: first.id, action: "dodge" }],
      ["use_reaction", { characterId: first.id, feature: "Opportunity attack" }],
      ["request_roll", { characterId: first.id, kind: "ability_check", ability: "str", dc: 10 }],
    ];
    for (const [name, args] of calls) {
      const out = await world.invoke(name, args);
      assert.equal(out.ok, false, `${name} went through for a dead character`);
    }
    assert.equal(world.clearDice(), 2);
    world.signIn({ id: first.userId });
    const token = kit.token(first.id);
    const moveRoute = await world.route("campaigns/[campaignId]/battle-map/move");
    const moved = await moveRoute.POST(
      new Request("http://odm.test/move", { method: "POST", body: JSON.stringify({ x: token.x + 1, y: token.y }) }),
      { params: Promise.resolve({ campaignId: world.campaignId }) },
    );
    assert.equal(moved.status, 409);
    assert.deepEqual([kit.token(first.id).x, kit.token(first.id).y], [token.x, token.y]);
    assert.equal(kit.enemy(enemy.id).currentHp, hp);
    assert.deepEqual(world.sheet(first.id).conditions, []);
    assert.deepEqual(world.encounter().reactionsUsed, []);
    assert.equal(world.encounter().turnBudget, null);
  } finally {
    world.patch(first.id, { deathSaves: null, currentHp: first.maxHp });
  }
});

await test("A character takes an action only on their own turn (or readies one there and spends the reaction on it).", async () => {
  await stage();
  const dodge = await world.invoke("take_action", { characterId: second.id, action: "dodge" });
  const dash = await world.invoke("take_action", { characterId: second.id, action: "dash" });
  assert.ok(!dodge.ok || !dash.ok, "two actions resolved for a character on somebody else's turn");
});

await test("Nobody acts in a fight before initiative is rolled.", async () => {
  await kit.endFight();
  // A player who holds their rolls keeps the order open: the console asks
  // for initiative at once, and theirs waits on their card.
  setMemberHoldRolls(world.campaignId, first.userId, true);
  const started = await world.invoke("start_encounter", { enemies: [{ monster: "goblin", count: 1 }] });
  setMemberHoldRolls(world.campaignId, first.userId, false);
  assert.equal(started.ok, true, started.error);
  const [enemy] = world.enemies();
  kit.openField();
  kit.place(first.id, 5, 5);
  kit.place(enemy.id, 5, 6);
  assert.equal(world.encounter().orderReady, false);
  world.dice(15, 4);
  const swing = await kit.attack(first.id, enemy.id);
  world.clearDice();
  assert.equal(swing.ok, false, "an attack resolved before initiative was in");
});

await test("An enemy takes one action on its turn: one attack, or one Multiattack.", async () => {
  const [enemy] = await stage();
  world.patch(first.id, { ac: 12, acOverride: true, currentHp: 30 });
  const turn = createDmTurn(world.campaignId, [], "ai");
  const actor = { kind: "ai", turnId: turn.id };
  // Its turn comes when the pointer passes it (src/lib/dm/enemy-turn-order.ts).
  for (let guard = 0; guard < 4; guard += 1) {
    world.say("player", "That's my turn.", world.sheet(kit.current().characterId));
    const ended = await invokeEngine(world.campaign(), actor, { name: "end_turn", args: { characterId: kit.current().characterId } });
    if (JSON.stringify(ended.result?.enemiesToAct ?? []).includes(enemy.id)) {
      break;
    }
  }
  const call = { name: "enemy_attack", args: { enemyId: enemy.id, targetCharacterId: first.id } };
  world.dice(15, 3);
  const one = await invokeEngine(world.campaign(), actor, call);
  world.clearDice();
  world.dice(15, 3);
  const two = await invokeEngine(world.campaign(), actor, call);
  world.clearDice();
  assert.equal(one.ok, true, one.error);
  assert.equal(two.ok, false, "the same enemy attacked twice in one round, in one DM turn");
});

await test("A Multiattack makes as many attacks as the stat block says.", async () => {
  const [enemy] = await stage();
  kit.setEnemy(enemy.id, { stats: { attacksPerTurn: 5 } });
  world.patch(first.id, { ac: 30, acOverride: true, currentHp: 30 });
  world.dice(2, 2, 2, 2, 2);
  const out = await world.invoke("enemy_attack", { enemyId: enemy.id, targetCharacterId: first.id });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(out.result.swings.length, 5, `${out.result.swings.length} swings for a five-attack Multiattack`);
});

await test("The DM's End a turn moves the initiative pointer on (src/lib/dm/catalog-combat.ts end_turn).", async () => {
  await stage();
  assert.equal(kit.current().characterId, first.id);
  const ended = await world.invoke("end_turn", { characterId: first.id });
  assert.equal(ended.ok, true, ended.error);
  assert.equal(kit.current().characterId, second.id, "the pointer did not move");
});

await test("The DM console's Player attacks form resolves a player's attack.", async () => {
  const [enemy] = await stage();
  world.dice(15, 4);
  // The name the form used to send, which the engine still takes.
  const swing = await world.invoke("pc_attack", { characterId: first.id, enemyId: enemy.id });
  world.clearDice();
  assert.equal(swing.ok, true, swing.error);
  // And the name the form sends now, which is the handler's own.
  world.dice(15, 4);
  const named = await world.invoke("pc_attack", { characterId: first.id, targetEnemyId: enemy.id });
  world.clearDice();
  assert.equal(named.ok, true, named.error);
  assert.equal(kit.enemy(enemy.id).currentHp, 40 - 2 * (4 + 3));
});

await test("The per-turn caps apply to the AI's share of an assisted session (src/lib/dm/delegation.ts header).", async () => {
  const [enemy] = await stage();
  kit.setEnemy(enemy.id, { maxHp: 200 });
  const turn = createDmTurn(world.campaignId, [], "ai");
  let refused = 0;
  for (let index = 0; index < ENCOUNTER_CAP_PER_TURN + 1; index += 1) {
    const out = await invokeEngine(
      world.campaign(),
      { kind: "ai", turnId: turn.id },
      { name: "damage_enemy", args: { enemyId: enemy.id, amount: 1, source: "hazard" } },
    );
    refused += out.ok ? 0 : 1;
  }
  assert.equal(refused, 1, `${ENCOUNTER_CAP_PER_TURN + 1} encounter actions resolved on one AI turn`);
});

await kit.endFight();
world.close();
finish();
