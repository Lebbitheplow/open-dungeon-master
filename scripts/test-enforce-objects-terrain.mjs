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
  // SRD 5.1 Objects, the Object Hit Points table: a Small resilient object
  // (chest, lute) has 10 hit points (3d6), so the blow that breaks it does 10.
  world.dice(15, 7);
  blow = await smash({ name: "the chest", size: "small", characterId: brute.id, weapon: "Greataxe" });
  assert.equal(world.clearDice(), 0);
  assert.equal(blow.result.damage, 7 + 3);
  assert.equal(blow.result.broken, true);
});

await test("an object takes no poison or psychic damage", async () => {
  const blow = await smash({ name: "the idol", damage: "30", damageType: "poison" });
  assert.equal(blow.result.damage, 0);
  assert.equal(blow.result.broken, false);
});

await test("An object's numbers are decided once: an iron gate described on the first blow is still iron, large and thresholded when the next blow names none of it.", async () => {
  let blow = await world.invoke("damage_object", { name: "the portcullis", material: "iron", size: "large", threshold: 10, damage: "12" });
  assert.equal(blow.ok, true, blow.error);
  assert.equal(blow.result.ac, 19);
  assert.equal(blow.result.hp, 27);
  assert.equal(blow.result.damageTaken, 12);
  // The second call says nothing of what it is: a medium wooden thing with
  // no threshold is what a bare call would have read it as.
  blow = await world.invoke("damage_object", { name: "the portcullis", damage: "8" });
  assert.equal(blow.result.ac, 19, "still iron");
  assert.equal(blow.result.hp, 27, "still large");
  assert.equal(blow.result.damage, 0, "8 is under its threshold of 10");
  assert.equal(blow.result.damageTaken, 12);
  blow = await world.invoke("damage_object", { name: "the portcullis", material: "wood", damage: "15" });
  assert.equal(blow.result.ac, 19, "a later call cannot make it another thing");
  assert.equal(blow.result.broken, true, "12 and 15 take its 27");
});

await test("A broken object stays broken: the next blow finds nothing left to break and rolls nothing.", async () => {
  const brute = world.addHero({
    class: "fighter", level: 1, abilities: { str: 16 },
    proficiencies: { saves: [], skills: [], expertise: [], languages: ["Common"], tools: [], armor: [], weapons: ["simple", "martial"] },
    equipment: [{ name: "Greataxe", qty: 1 }],
  });
  // A Small resilient crate has the SRD table's 10 hit points.
  let blow = await smash({ name: "the crate", size: "small", damage: "10" });
  assert.equal(blow.result.broken, true);
  blow = await smash({ name: "the crate", size: "small", damage: "10" });
  assert.equal(blow.ok, true, blow.error);
  assert.equal(blow.result.damage, 0);
  assert.equal(blow.result.broken, true);
  assert.match(blow.result.note, /already broken/);
  world.dice(15, 6);
  blow = await smash({ name: "the crate", characterId: brute.id, weapon: "Greataxe" });
  assert.equal(world.clearDice(), 2, "no attack is rolled at a broken object");
  assert.match(blow.result.note, /already broken/);
});

await test("An object is the one of that name where the party is: the crate of the next place is whole, and wood.", async () => {
  const moved = await world.invoke("move_party", { name: "The Old Docks" });
  assert.equal(moved.ok, true, moved.error);
  const blow = await smash({ name: "the crate", size: "small", damage: "3" });
  assert.equal(blow.ok, true, blow.error);
  assert.equal(blow.result.damage, 3);
  assert.equal(blow.result.broken, false);
  assert.doesNotMatch(blow.result.note ?? "", /already broken/);
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
