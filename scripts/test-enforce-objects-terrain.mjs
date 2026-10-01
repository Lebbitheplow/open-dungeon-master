// Breaking objects and crossing water, as the engine holds them.
//
// SRD 5.1 (Gamemastering, Objects): an object has an AC by its material and
// hit points by its size; an attack has to hit that AC, and damage adds up
// until the hit points are gone; objects are immune to poison and psychic
// damage. Climbing, Swimming, and Crawling: each foot of swimming costs an
// extra foot unless the creature has a swimming speed.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";

const { test, finish } = suite("test-enforce-objects-terrain");
const world = await openWorld();
const { reachableTiles } = await import("../src/lib/battlemap/movement.ts");

const smash = (args) => world.invoke("damage_object", { material: "wood", size: "medium", ...args });

await test("A named object keeps the damage it has taken: two 10-point blows break an 18 hit point door without the second call carrying the first.", async () => {
  let blow = await smash({ name: "the oak door", damage: "10" });
  assert.equal(blow.ok, true, blow.error);
  assert.equal(blow.result.broken, false);
  blow = await smash({ name: "the oak door", damage: "10" });
  assert.equal(blow.result.broken, true);
});

await test("A character's blow at an object rolls their attack against its AC: a miss does nothing, a hit rolls their weapon's damage.", async () => {
  const brute = world.addHero({
    class: "fighter", level: 1, abilities: { str: 16 },
    proficiencies: { saves: [], skills: [], expertise: [], languages: ["Common"], tools: [], armor: [], weapons: ["simple", "martial"] },
    equipment: [{ name: "Greataxe", qty: 1 }],
  });
  world.dice(2);
  let blow = await smash({ name: "the chest", size: "small", characterId: brute.id, weapon: "Greataxe" });
  assert.equal(world.clearDice(), 0);
  assert.equal(blow.result.hit, false);
  world.dice(15, 6);
  blow = await smash({ name: "the chest", size: "small", characterId: brute.id, weapon: "Greataxe" });
  assert.equal(world.clearDice(), 0);
  assert.equal(blow.result.damage, 6 + 3);
  assert.equal(blow.result.broken, true);
});

await test("an object takes no poison or psychic damage", async () => {
  const blow = await smash({ name: "the idol", damage: "30", damageType: "poison" });
  assert.equal(blow.result.damage, 0);
  assert.equal(blow.result.broken, false);
});

await test("A creature with a swimming speed crosses water at its normal cost; one without pays double.", () => {
  const terrain = "~".repeat(8);
  const walk = reachableTiles(terrain, 8, 1, new Set(), { x: 0, y: 0 }, 6, 1, false);
  const swim = reachableTiles(terrain, 8, 1, new Set(), { x: 0, y: 0 }, 6, 1, false, true);
  assert.equal(walk.size, 3);
  assert.equal(swim.size, 6);
});

world.close();
finish();
