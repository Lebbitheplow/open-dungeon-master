// A fight a person runs, after the order locks (the audit behind issue 63).
//
// The rules:
//   - The pointer rests only on player characters; the enemies between two
//     of them are the DM's to play. At a person's table the pointer passing
//     enemies who can act holds the floor for them, and the DM's view names
//     who is due. The DM hands the turn on (having played them, or letting
//     the server play the rest) and the next player gets the floor. Before,
//     the next player got it at once and no enemy ever acted.
//   - At an AI table a pass outside the AI's turn (a player's End Turn) holds
//     the floor the same way, and the AI turn it wakes plays them: the model
//     may, and its end plays the rest and opens the floor.
//   - Releasing the hold from the table's banner hands the turn on too.
//   - The DM's "on a turn" is a turn ending, not a correction: a downed
//     character it passes rolls their death save, and the round turns over.
//   - An AI companion is the DM's to run at a person's table: it is asked
//     for initiative with everyone, its turn is named to the DM (no player
//     can take it), and "Play their turn" plays it and moves on. One added
//     while the order is still being collected takes its place in it.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit } from "./lib/enforce-combat.mjs";

const { test, finish } = suite("test-human-dm-combat");
const { getFloor } = await import("../src/lib/db/campaigns.ts");
const { activePublicEncounter } = await import("../src/lib/db/encounter-view.ts");
const { getFloor: floorOf, setMemberHoldRolls } = await import("../src/lib/db/campaigns.ts");
const { createDmTurn, listOpenPendingRolls } = await import("../src/lib/db/dm-turns.ts");
const { advanceAfterTurn } = await import("../src/lib/dm/encounter-tools.ts");
const { listRecentRolls } = await import("../src/lib/db/rolls.ts");

async function table(dmMode) {
  const world = await openWorld({ gameSettings: { dmMode } });
  const kit = await combatKit(world);
  const fast = world.addHero({ user: world.addUser(), class: "fighter", level: 3 });
  const slow = world.addHero({ user: world.addUser(), class: "fighter", level: 3 });
  // Fast 20, the goblin about 10, slow 1: the goblin sits between them.
  await kit.fight(1, { heroFaces: { [fast.id]: 20, [slow.id]: 1 }, enemyFace: 8 });
  const [goblin] = world.enemies();
  kit.place(fast.id, 5, 5);
  kit.place(goblin.id, 5, 6);
  kit.place(slow.id, 9, 9);
  return { world, kit, fast, slow, goblin };
}

async function post(world, user, route, params, body) {
  world.signIn(user);
  const handler = await world.route(route);
  const response = await handler.POST(
    new Request("http://test/", { method: "POST", body: JSON.stringify(body) }),
    { params: Promise.resolve({ campaignId: world.campaignId, ...params }) },
  );
  return { status: response.status, body: await response.json() };
}

await test("at a person's table the enemies between two players are held for the DM, and named to them", async () => {
  const { world, kit, fast, slow, goblin } = await table("human");
  assert.equal(kit.current().characterId, fast.id);
  assert.equal(kit.endTurn(fast.userId), true);
  const floor = getFloor(world.campaignId);
  assert.equal(floor.mode, "hold", "the next player was handed the floor before the goblin acted");
  assert.equal(floor.next.mode, "initiative");
  assert.deepEqual(floor.next.userIds, [slow.userId]);
  const dmView = activePublicEncounter(world.campaignId, { enemyNumbers: true });
  assert.deepEqual(dmView.enemiesDue.map((enemy) => enemy.id), [goblin.id]);
  // Players are not told who is due.
  assert.equal(activePublicEncounter(world.campaignId).enemiesDue, undefined);
});

await test("the DM can have the server play the rest, and the next player gets the floor", async () => {
  const { world, kit, fast, slow } = await table("human");
  kit.endTurn(fast.userId);
  world.dice(20, 4, 4);
  const out = await post(world, world.owner, "campaigns/[campaignId]/dm/initiative", {}, { op: "enemies", play: true });
  world.clearDice();
  assert.equal(out.status, 200, out.body.error);
  const floor = getFloor(world.campaignId);
  assert.equal(floor.mode, "initiative");
  assert.deepEqual(floor.userIds, [slow.userId]);
  assert.ok(world.sheet(fast.id).currentHp < world.sheet(fast.id).maxHp, "the goblin never swung");
  assert.equal(world.encounter().legendary.due, undefined);
});

await test("the DM who played the enemies by hand hands the turn on; nothing is played twice", async () => {
  const { world, kit, fast, slow, goblin } = await table("human");
  kit.endTurn(fast.userId);
  world.dice(20, 4, 4);
  const swing = await world.invoke("enemy_attack", { enemyId: goblin.id, targetCharacterId: fast.id });
  world.clearDice();
  assert.equal(swing.ok, true, swing.error);
  const hurt = world.sheet(fast.id).currentHp;
  assert.equal(
    activePublicEncounter(world.campaignId, { enemyNumbers: true }).enemiesDue[0].acted,
    true,
  );
  const out = await post(world, world.owner, "campaigns/[campaignId]/dm/initiative", {}, { op: "enemies", play: true });
  assert.equal(out.status, 200, out.body.error);
  assert.equal(world.sheet(fast.id).currentHp, hurt, "the goblin acted twice");
  assert.deepEqual(getFloor(world.campaignId).userIds, [slow.userId]);
});

await test("releasing the hold from the table's banner hands the turn on", async () => {
  const { world, kit, fast, slow } = await table("human");
  kit.endTurn(fast.userId);
  const out = await post(world, world.owner, "campaigns/[campaignId]/floor", {}, {});
  assert.equal(out.status, 200, out.body.error);
  const floor = getFloor(world.campaignId);
  assert.equal(floor.mode, "initiative");
  assert.deepEqual(floor.userIds, [slow.userId]);
  assert.equal(world.encounter().legendary.due, undefined);
});

await test("at an AI table the enemies are held for the AI's turn, whose end plays them and opens the floor", async () => {
  const { world, kit, fast, slow, goblin } = await table("ai");
  kit.endTurn(fast.userId);
  assert.equal(getFloor(world.campaignId).mode, "hold");
  assert.deepEqual(world.encounter().legendary.due, [goblin.id]);
  world.dice(20, 6);
  advanceAfterTurn(world.campaign(), createDmTurn(world.campaignId, [], "ai"));
  world.clearDice();
  assert.ok(listRecentRolls(world.campaignId, 20).some((roll) => roll.attacker?.id === goblin.id), "the goblin acted");
  const floor = getFloor(world.campaignId);
  assert.equal(floor.mode, "initiative");
  assert.deepEqual(floor.userIds, [slow.userId]);
  assert.equal(world.encounter().legendary.due, undefined);
});

await test("the DM's on-a-turn is a turn ending: a downed character passed rolls a death save and the round turns", async () => {
  const { world, kit, fast, slow } = await table("human");
  // Slow goes down; stepping on from fast passes the goblin and slow.
  world.patch(slow.id, { currentHp: 0, deathSaves: { successes: 0, failures: 0, stable: false, dead: false } });
  world.dice(15);
  const out = await post(world, world.owner, "campaigns/[campaignId]/dm/initiative", {}, { op: "step", direction: "forward" });
  world.clearDice();
  assert.equal(out.status, 200, out.body.error);
  assert.equal(world.sheet(slow.id).deathSaves.successes, 1, "the downed character rolled no death save");
  assert.equal(world.encounter().round, 2, "the round never turned over");
  assert.equal(kit.current().characterId, fast.id);
});

// ---- AI companions at a person's table ----

async function companionTable() {
  const world = await openWorld({ gameSettings: { dmMode: "human" } });
  const kit = await combatKit(world);
  const player = world.addUser();
  const hero = world.addHero({ user: player, class: "fighter", level: 3 });
  const joined = await world.invoke("add_companion", {
    gender: "Unknown",
    name: "Wren", class: "fighter", race: "human", level: 3, personality: "Quiet.", kind: "guest",
  });
  assert.equal(joined.ok, true, joined.error);
  const companion = world.sheet(joined.result.characterId);
  return { world, kit, player, hero, companion };
}

await test("a companion who joined before the fight is asked for initiative with everyone, and the order locks", async () => {
  const { world, kit, hero, companion } = await companionTable();
  await kit.fight(1, { heroFaces: { [hero.id]: 5, [companion.id]: 20 }, enemyFace: 8 });
  const encounter = world.encounter();
  assert.equal(encounter.orderReady, true, "the order waited on the companion");
  const entry = encounter.order.find((row) => row.characterId === companion.id);
  assert.ok(entry, "the companion has no place in the order");
  assert.ok(entry.initiative >= 20, `the companion's forced 20 was not its roll (${entry.initiative})`);
});

await test("the companion's turn is named to the DM, no player can take it, and Play their turn plays it and moves on", async () => {
  const { world, kit, player, hero, companion } = await companionTable();
  await kit.fight(1, { heroFaces: { [hero.id]: 2, [companion.id]: 20 }, enemyFace: 8 });
  const [goblin] = world.enemies();
  kit.place(companion.id, 5, 5);
  kit.place(goblin.id, 5, 6);
  kit.place(hero.id, 9, 9);
  assert.equal(kit.current().characterId, companion.id);
  const dmView = activePublicEncounter(world.campaignId, { enemyNumbers: true });
  assert.deepEqual(dmView.companionTurn, { id: companion.id, name: companion.name });
  assert.equal(activePublicEncounter(world.campaignId).companionTurn, undefined, "players were told the DM's business");
  // The floor belongs to the companion's own seat: the player cannot end it.
  assert.equal(kit.endTurn(player.id), false);
  const before = listRecentRolls(world.campaignId, 100).filter((roll) => roll.kind === "attack").length;
  world.dice(18, 5, 5);
  const out = await post(world, world.owner, "campaigns/[campaignId]/dm/initiative", {}, { op: "companion" });
  world.clearDice();
  assert.equal(out.status, 200, out.body.error);
  const after = listRecentRolls(world.campaignId, 100).filter((roll) => roll.kind === "attack").length;
  assert.equal(after, before + 1, "the companion never swung");
  assert.notEqual(kit.current()?.characterId, companion.id, "the turn stayed on the companion");
  // The goblin sits between the companion and the hero: it is held for the DM.
  assert.equal(floorOf(world.campaignId).mode, "hold");
  assert.deepEqual(
    activePublicEncounter(world.campaignId, { enemyNumbers: true }).enemiesDue.map((enemy) => enemy.id),
    [goblin.id],
  );
  // Play their turn is refused once it is nobody's companion turn.
  const again = await post(world, world.owner, "campaigns/[campaignId]/dm/initiative", {}, { op: "companion" });
  assert.equal(again.status, 409);
});

await test("a companion added while the order is being collected takes its place, and the last player's roll locks it", async () => {
  const world = await openWorld({ gameSettings: { dmMode: "human" } });
  const player = world.addUser();
  const hero = world.addHero({ user: player, class: "fighter", level: 3 });
  setMemberHoldRolls(world.campaignId, player.id, true);
  world.dice(8);
  const started = await world.invoke("start_encounter", { enemies: [{ monster: "goblin", count: 1 }] });
  world.clearDice();
  assert.equal(started.ok, true, started.error);
  assert.equal(world.encounter().orderReady, false);
  const joined = await world.invoke("add_companion", {
    gender: "Unknown",
    name: "Tamsin", class: "fighter", race: "human", level: 3, personality: "Bold.", kind: "guest",
  });
  assert.equal(joined.ok, true, joined.error);
  const companionId = joined.result.characterId;
  assert.ok(
    world.encounter().order.some((row) => row.characterId === companionId),
    "the companion was not staged with the order",
  );
  const [pending] = listOpenPendingRolls(world.campaignId).filter((row) => row.characterId === hero.id);
  assert.ok(pending, "the player was never asked");
  const out = await post(world, player, "campaigns/[campaignId]/pending-rolls/[pendingRollId]", { pendingRollId: pending.id }, { dice: ["digital"] });
  assert.equal(out.status, 200, out.body.error);
  const encounter = world.encounter();
  assert.equal(encounter.orderReady, true, "the order waited on a companion nobody dealt a card");
  assert.deepEqual(
    new Set(encounter.order.filter((row) => row.kind === "pc").map((row) => row.characterId)),
    new Set([hero.id, companionId]),
  );
});

await test("a companion out of reach walks to its target before it swings, as the enemies the server plays do", async () => {
  const { world, kit, hero, companion } = await companionTable();
  await kit.fight(1, { heroFaces: { [hero.id]: 2, [companion.id]: 20 }, enemyFace: 8 });
  const [goblin] = world.enemies();
  kit.openField();
  kit.place(companion.id, 5, 5);
  kit.place(goblin.id, 5, 9);
  kit.place(hero.id, 12, 12);
  assert.equal(kit.current().characterId, companion.id);
  const before = listRecentRolls(world.campaignId, 100).filter((roll) => roll.kind === "attack").length;
  world.dice(18, 5, 5);
  const out = await post(world, world.owner, "campaigns/[campaignId]/dm/initiative", {}, { op: "companion" });
  world.clearDice();
  assert.equal(out.status, 200, out.body.error);
  const token = kit.token(companion.id);
  assert.ok(Math.max(Math.abs(token.x - 5), Math.abs(token.y - 9)) <= 1, `the companion stayed at (${token.x},${token.y})`);
  const after = listRecentRolls(world.campaignId, 100).filter((roll) => roll.kind === "attack").length;
  assert.equal(after, before + 1, "the companion walked up and never swung");
});

finish();
