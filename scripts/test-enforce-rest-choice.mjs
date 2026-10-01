// Who spends hit dice on a short rest, and what undoing a long rest gives
// back.
//
// SRD 5.1, Short Rest: "A character can spend one or more Hit Dice at the
// end of a short rest ... the player rolls the die and adds the character's
// Constitution modifier ... The player can decide to spend an additional Hit
// Die after each roll." Decision for ODM: the player chooses; the server's
// default (spend toward half HP) applies only to a character with no player
// connected. Long Rest: one in 24 hours; a long rest the lead undoes never
// happened, so it does not hold the 24 hours shut.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";

const { test, finish } = suite("test-enforce-rest-choice");
const world = await openWorld();
const { subscribe } = await import("../src/lib/events.ts");
const { getDatabase } = await import("../src/lib/db/core.ts");

const player = world.addUser("rester");
const hero = world.addHero({ user: player, class: "fighter", level: 4, maxHp: 40, abilities: { con: 14 } });
const bench = world.addHero({ class: "fighter", level: 4, maxHp: 40, abilities: { con: 14 } });
const sheet = () => world.sheet(hero.id);

// The player is at the table: their events stream is open.
const leave = subscribe(world.campaignId, () => {}, player.id);

let hitDice = null;
async function spend(dice, user = player) {
  hitDice ??= await world.route("campaigns/[campaignId]/sheet/hit-dice").catch(() => null);
  if (!hitDice) {
    return { status: 404, body: { error: "no route" } };
  }
  world.signIn(user);
  const response = await hitDice.POST(
    new Request("http://test/", { method: "POST", body: JSON.stringify({ dice }) }),
    { params: Promise.resolve({ campaignId: world.campaignId }) },
  );
  return { status: response.status, body: await response.json() };
}

await test("After a short rest a connected player chooses their own hit dice: the rest spends none for them, and each die they ask for is rolled by the server and heals them.", async () => {
  world.patch(hero.id, { currentHp: 10, hitDice: { die: "d10", total: 4, spent: 0 } });
  world.patch(bench.id, { currentHp: 10, hitDice: { die: "d10", total: 4, spent: 0 } });
  world.dice(5, 5, 5, 5, 5, 5);
  const rested = await world.invoke("take_rest", { kind: "short" });
  world.clearDice();
  assert.equal(rested.ok, true, rested.error);
  assert.equal(sheet().hitDice.spent, 0, "the rest spent the player's hit dice for them");
  assert.ok(world.sheet(bench.id).hitDice.spent > 0, "the character with no player spent nothing");
  world.dice(6);
  let reply = await spend(1);
  assert.equal(reply.status, 200, reply.body.error);
  assert.equal(sheet().hitDice.spent, 1);
  assert.equal(sheet().currentHp, 10 + 6 + 2);
  world.dice(1);
  reply = await spend(1);
  assert.equal(reply.status, 200, reply.body.error);
  assert.equal(sheet().hitDice.spent, 2);
  assert.equal(sheet().currentHp, 18 + 1 + 2);
});

await test("Outside a short rest a player cannot spend hit dice: the choice closes when the clock moves on.", async () => {
  await world.invoke("pass_time", { amount: 10, unit: "minutes" });
  const before = sheet().hitDice.spent;
  const reply = await spend(1);
  assert.equal(reply.status, 409);
  assert.equal(sheet().hitDice.spent, before);
});

await test("the player's hit dice are rolled by the server, one roll record for each spend", () => {
  const rolls = getDatabase()
    .prepare(`SELECT requested_by FROM rolls WHERE character_id = ? AND detail LIKE 'short rest:%'`)
    .all(hero.id);
  assert.deepEqual(rolls.map((row) => row.requested_by), ["player", "player"]);
});

await test("Undoing a long rest gives back the 24 hours it started: the character may take a long rest again at once.", async () => {
  world.patch(hero.id, { currentHp: 20 });
  let rested = await world.invoke("take_rest", { kind: "long" });
  assert.deepEqual(rested.result.rested.includes(sheet().name), true);
  const entry = getDatabase()
    .prepare(`SELECT id FROM sheet_audit WHERE character_id = ? AND kind = 'rest_long' ORDER BY seq DESC LIMIT 1`)
    .get(hero.id);
  const undo = await world.route("campaigns/[campaignId]/audit/[entryId]/undo");
  world.signIn(world.owner);
  const response = await undo.POST(
    new Request("http://test/", { method: "POST", body: JSON.stringify({ confirm: true }) }),
    { params: Promise.resolve({ campaignId: world.campaignId, entryId: entry.id }) },
  );
  assert.equal(response.status, 200, JSON.stringify(await response.json()));
  world.patch(hero.id, { currentHp: 20 });
  rested = await world.invoke("take_rest", { kind: "long" });
  assert.equal(rested.result.rested.includes(sheet().name), true, `a second long rest after the undo: ${rested.result.unaffected}`);
  assert.equal(sheet().currentHp, sheet().maxHp);
});

leave();
world.close();
finish();
