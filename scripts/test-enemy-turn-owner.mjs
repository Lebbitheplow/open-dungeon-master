// Whose turn the table is told it is while the enemies before a player take
// theirs (table function audit 2026-10-26, T11). The pointer already rests
// on the player up next and the floor is held for the enemies
// (enemies-due.ts); every display reads whose turn it is from
// src/lib/dm/turn-owner.ts, so the encounter's `acting`, the board's turn
// name and token, the Hand and the trackers say it is the enemy's, name that
// player only as up next, give away no hidden enemy, and move to the player
// the moment the DM hands the turn on.
//
// Found beside it and held here too: the turn note and a player's End Turn
// refusal named a hidden enemy; the composer blamed the enemies for a hold
// over a fight with none due.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit } from "./lib/enforce-combat.mjs";

const { test, finish } = suite("test-enemy-turn-owner");
const tools = await import("../src/lib/dm/encounter-tools.ts");
const { ENEMY_TURN_NAME } = await import("../src/lib/dm/turn-owner.ts");
const { turnFromEncounter } = await import("../src/lib/battlemap/hand-table.ts");
const { standingGate } = await import("../src/lib/battlemap/hand-core.ts");
const { litOrderRows } = await import("../src/lib/battlemap/initiative-rows.ts");
const { setTokenHidden } = await import("../src/lib/db/battle-maps.ts");
const { createDmTurn } = await import("../src/lib/db/dm-turns.ts");
const { getFloor, setFloor } = await import("../src/lib/db/campaigns.ts");
const { listRecentMessages } = await import("../src/lib/db/messages.ts");

const THE_ENEMY = { id: "", name: ENEMY_TURN_NAME };

async function call(world, user, suffix, method = "GET", body) {
  world.signIn(user);
  const handler = await world.route(`campaigns/[campaignId]${suffix}`);
  const response = await handler[method](
    new Request(`http://test/api/campaigns/${world.campaignId}${suffix}`, {
      method,
      ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { "content-type": "application/json" } }),
    }),
    { params: Promise.resolve({ campaignId: world.campaignId }) },
  );
  return { status: response.status, body: await response.json() };
}

// What one seat is shown: the snapshot's floor and encounter, and its board.
async function seat(world, user) {
  const snapshot = await call(world, user, "");
  const board = await call(world, user, "/battle-map");
  assert.equal(snapshot.status, 200, JSON.stringify(snapshot.body));
  assert.equal(board.status, 200, JSON.stringify(board.body));
  return { floor: snapshot.body.campaign.floor, encounter: snapshot.body.encounter, board: board.body.view };
}

const myTurn = (view, sheet) => turnFromEncounter(view.encounter, sheet, { myTurn: false, currentName: "" }).myTurn;

// Kara before the goblins and Brom after them, at a table `dmMode` runs.
async function between(dmMode, goblins = 1) {
  const world = await openWorld({ gameSettings: { dmMode } });
  const kit = await combatKit(world);
  const [first, second] = [world.addUser("first"), world.addUser("second")];
  const kara = world.addHero({ user: first, name: "Kara", class: "fighter", level: 3 });
  const brom = world.addHero({ user: second, name: "Brom", class: "fighter", level: 3 });
  await kit.fight(goblins, { heroFaces: { [kara.id]: 20, [brom.id]: 1 }, enemyFace: 8 });
  kit.place(kara.id, 5, 5);
  world.enemies().forEach((enemy, index) => kit.place(enemy.id, 4 + index, 6));
  kit.place(brom.id, 9, 9);
  return { world, kit, first, second, kara, brom };
}

await test("A fight that opens on the enemies' turns is the enemy's turn on every display, and the player's once the DM hands it on", async () => {
  const world = await openWorld({ gameSettings: { dmMode: "human" } });
  const player = world.addUser("waiting");
  const hero = world.addHero({ user: player, name: "Ilse Marr", class: "fighter", level: 3 });
  await world.beginFight([{ monster: "goblin", count: 1 }], { heroFaces: { [hero.id]: 1 }, enemyFace: 20 });
  const [goblin] = world.enemies();
  const held = await seat(world, player);
  assert.equal(held.floor.mode, "hold");
  assert.equal(held.encounter.enemyTurns, true);
  assert.deepEqual(held.encounter.acting, THE_ENEMY);
  assert.deepEqual(held.encounter.upNext, { id: hero.id, name: "Ilse Marr" });
  assert.deepEqual(held.encounter.enemiesUp, [goblin.id]);
  assert.equal(held.board.currentTurnName, ENEMY_TURN_NAME);
  assert.equal(held.board.turn, null, "the board lit, chimed and offered End turn to the player up next");
  const turn = turnFromEncounter(held.encounter, world.sheet(hero.id), { myTurn: false, currentName: "" });
  assert.equal(turn.myTurn, false);
  assert.match(standingGate(world.sheet(hero.id), turn)?.reason ?? "", /^It is the enemy's turn, not Ilse Marr's\./);
  assert.equal((await call(world, player, "/actions", "POST", { kind: "do", content: "I raise my sword." })).status, 409);

  const handed = await call(world, world.owner, "/floor", "POST", {});
  assert.equal(handed.status, 200, handed.body.error);
  const open = await seat(world, player);
  assert.deepEqual(open.encounter.acting, { id: hero.id, name: "Ilse Marr" });
  assert.equal(open.encounter.upNext, undefined);
  assert.equal(open.encounter.enemiesUp, undefined);
  assert.equal(open.encounter.enemyTurns, undefined);
  assert.equal(open.board.currentTurnName, "Ilse Marr");
  assert.equal(open.board.turn?.tokenId, open.board.myTokenId);
  assert.equal(myTurn(open, world.sheet(hero.id)), true);
  const now = await call(world, player, "/actions", "POST", { kind: "do", content: "I raise my sword." });
  assert.equal(now.status, 202, JSON.stringify(now.body));
});

await test("Between two players the second waits as up next while the DM plays the enemy, and gets the turn on the hand-on", async () => {
  const { world, kit, first, second, kara, brom } = await between("human");
  const [goblin] = world.enemies();
  assert.deepEqual((await seat(world, second)).encounter.acting, { id: kara.id, name: "Kara" });
  assert.equal(tools.endOwnTurn(world.campaignId, first.id), true);
  const held = await seat(world, second);
  assert.deepEqual(held.encounter.acting, THE_ENEMY);
  assert.deepEqual(held.encounter.upNext, { id: brom.id, name: "Brom" });
  assert.equal(held.board.turn, null);
  for (const sheet of [kara, brom]) {
    assert.equal(myTurn(held, world.sheet(sheet.id)), false, `${sheet.name}'s Hand`);
  }
  assert.equal((await call(world, second, "/encounter/end-turn", "POST", {})).status, 409);
  // Played by hand, the goblin's turn stays the DM's until it is handed on.
  world.dice(20, 4, 4);
  const swing = await world.invoke("enemy_attack", { enemyId: goblin.id, targetCharacterId: kara.id });
  world.clearDice();
  assert.equal(swing.ok, true, swing.error);
  assert.deepEqual((await seat(world, second)).encounter.acting, THE_ENEMY);
  const handed = await call(world, world.owner, "/dm/initiative", "POST", { op: "enemies", play: false });
  assert.equal(handed.status, 200, handed.body.error);
  const open = await seat(world, second);
  assert.deepEqual(open.encounter.acting, { id: brom.id, name: "Brom" });
  assert.equal(open.board.currentTurnName, "Brom");
  assert.equal(open.board.turn?.tokenId, kit.token(brom.id).id);
  assert.equal(myTurn(open, world.sheet(brom.id)), true);
  assert.equal(myTurn(open, world.sheet(kara.id)), false);
});

await test("Several enemies, one hidden: a player's view lights the ones they can see and names the hidden one nowhere", async () => {
  const { world, kit, first, second } = await between("human", 3);
  const [, , unseen] = world.enemies();
  setTokenHidden(kit.token(unseen.id).id, true);
  assert.equal(tools.endOwnTurn(world.campaignId, first.id), true);
  const dm = await seat(world, world.owner);
  const player = await seat(world, second);
  const seen = world.enemies().filter((enemy) => enemy.id !== unseen.id).map((enemy) => enemy.id);
  assert.deepEqual(new Set(dm.encounter.enemiesUp), new Set(world.enemies().map((enemy) => enemy.id)));
  assert.deepEqual(new Set(player.encounter.enemiesUp), new Set(seen));
  assert.deepEqual(player.encounter.acting, THE_ENEMY);
  assert.deepEqual(dm.encounter.acting, THE_ENEMY, "the DM's own board says the same");
  for (const shown of [player.encounter, player.board]) {
    assert.equal(JSON.stringify(shown).includes(unseen.id), false, "the hidden enemy's id");
  }
  const rows = litOrderRows(player.encounter.order, player.encounter.turnIndex, player.encounter.acting, player.encounter.enemiesUp);
  assert.deepEqual(rows.map((row) => player.encounter.order[row].id).sort(), [...seen].sort());
  // The turn note and the refusal Brom's player gets name no hidden enemy.
  const notes = listRecentMessages(world.campaignId, 30).map((message) => message.content).join("\n");
  assert.equal(notes.includes(unseen.displayName), false, `the turn note named ${unseen.displayName}`);
  assert.match(notes, /someone unseen/);
  const refusal = tools.endTurnRefusal(world.campaignId, second.id);
  assert.equal(refusal.includes(unseen.displayName), false, refusal);
  assert.match(refusal, /someone unseen/);
});

await test("At an AI table a player's End Turn is the enemy's turn until the AI's turn plays them, then the next player's", async () => {
  const { world, kit, first, second, brom } = await between("ai");
  assert.equal(tools.endOwnTurn(world.campaignId, first.id), true);
  assert.deepEqual((await seat(world, second)).encounter.acting, THE_ENEMY);
  world.dice(20, 6);
  tools.advanceAfterTurn(world.campaign(), createDmTurn(world.campaignId, [], "ai"));
  world.clearDice();
  const open = await seat(world, second);
  assert.deepEqual(open.encounter.acting, { id: brom.id, name: "Brom" });
  assert.equal(open.board.turn?.tokenId, kit.token(brom.id).id);
});

await test("A hold over a fight with no enemy due is not blamed on the enemies", async () => {
  const { world, first } = await between("human");
  const fight = getFloor(world.campaignId);
  assert.equal(fight.mode, "initiative");
  setFloor(world.campaignId, { mode: "hold", next: fight });
  const refused = await call(world, first, "/actions", "POST", { kind: "do", content: "I swing." });
  assert.equal(refused.status, 409);
  assert.doesNotMatch(refused.body.error, /enemies are taking their turns/);
  assert.match(refused.body.error, /has not opened responses yet/);
});

await test("The trackers find the seat in a player's order, which leaves a hidden enemy out, and light the enemies' seats while they play", () => {
  // The server's order: a hidden goblin, Kara, a wolf, Brom. A player's
  // leaves the goblin out, so the pointer's index 1 (Kara) reads the wolf.
  const order = [{ id: "kara", name: "Kara" }, { id: "wolf", name: "Wolf" }, { id: "brom", name: "Brom" }];
  assert.deepEqual(litOrderRows(order, 1, { name: "Kara" }), [0]);
  assert.deepEqual(litOrderRows(order, 3, { name: ENEMY_TURN_NAME }, ["wolf"]), [1]);
  assert.deepEqual(litOrderRows(order, 3, { name: ENEMY_TURN_NAME }, []), [], "only hidden enemies playing light no seat");
});

await finish();
