// A fight a person runs, after the order locks (the audit behind issue 63).
//
// The rules:
//   - The pointer rests only on player characters; the enemies between two
//     of them are the DM's to play. At a person's table the pointer passing
//     enemies who can act holds the floor for them, and the DM's view names
//     who is due. The DM hands the turn on (having played them, or letting
//     the server play the rest) and the next player gets the floor. Before,
//     the next player got it at once and no enemy ever acted.
//   - At an AI table nothing is held: the AI's turn plays them.
//   - Releasing the hold from the table's banner hands the turn on too.
//   - The DM's "on a turn" is a turn ending, not a correction: a downed
//     character it passes rolls their death save, and the round turns over.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit } from "./lib/enforce-combat.mjs";

const { test, finish } = suite("test-human-dm-combat");
const { getFloor } = await import("../src/lib/db/campaigns.ts");
const { activePublicEncounter } = await import("../src/lib/db/encounter-view.ts");

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

await test("at an AI table nothing is held: the AI's turn plays the enemies", async () => {
  const { world, kit, fast, slow } = await table("ai");
  kit.endTurn(fast.userId);
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

finish();
