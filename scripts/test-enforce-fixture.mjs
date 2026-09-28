// The enforcement fixture itself: the dice the suites force are the dice the
// engine rolls, and the engine reached through the DM's façade writes real
// state. Every other test-enforce-*.mjs leans on both, so they are proved
// here first.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";

const { test, finish } = suite("test-enforce-fixture");
const world = await openWorld();
const { rollExpression } = await import("../src/lib/dice.ts");

await test("a forced die is the die the engine rolls", () => {
  world.dice(20, 1, 4);
  assert.equal(rollExpression("1d20+5").total, 25);
  assert.equal(rollExpression("1d20+5").total, 6);
  assert.equal(rollExpression("1d6").total, 4);
  assert.equal(world.clearDice(), 0);
});

await test("a forced face is clamped to the die", () => {
  world.dice(20);
  assert.equal(rollExpression("1d6").total, 6);
});

await test("an empty queue rolls for real, inside the die", () => {
  world.diceLog();
  for (let index = 0; index < 50; index += 1) {
    const total = rollExpression("1d8").total;
    assert.ok(total >= 1 && total <= 8);
  }
  assert.equal(world.diceLog().filter((die) => die.forced).length, 0);
});

await test("a fight begins with real enemies and the initiative the dice gave", async () => {
  const hero = world.addHero({ class: "fighter", level: 3, abilities: { dex: 14 } });
  const encounter = await world.beginFight([{ monster: "goblin", count: 2 }], {
    heroFaces: { [hero.id]: 18 },
  });
  assert.equal(world.enemies().length, 2);
  assert.equal(encounter.orderReady, true);
  assert.equal(encounter.order.length, 3);
  // 18 on the die and +2 from DEX 14, ahead of goblins that rolled a 1.
  assert.equal(encounter.order[0].characterId, hero.id);
  assert.equal(encounter.order[0].initiative, 20);
});

await test("damage through the façade lands on the stored sheet", async () => {
  const [hero] = world.sheets();
  const outcome = await world.invoke("apply_damage", {
    characterId: hero.id,
    amount: 7,
    reason: "test",
  });
  assert.equal(outcome.ok, true, outcome.error);
  assert.equal(world.sheet(hero.id).currentHp, hero.currentHp - 7);
});

await test("an unknown action is refused, not improvised", async () => {
  const outcome = await world.invoke("grant_wish", {});
  assert.equal(outcome.ok, false);
});

world.close();
finish();
