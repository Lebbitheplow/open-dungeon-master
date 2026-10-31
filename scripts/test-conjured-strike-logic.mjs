// Where a strike from something a spell made is made from (issue 659,
// src/lib/dm/conjured-strike-logic.ts), and the rules lines players read
// without the GM's tool directions (src/lib/language/player-text.ts).
//
// The rules, from SRD 5.1 (Spiritual Weapon): "You create a floating,
// spectral weapon within range... you can make a melee spell attack against
// a creature within 5 feet of the weapon... As a bonus action on your turn,
// you can move the weapon up to 20 feet and repeat the attack against a
// creature within 5 feet of it." Range 60 feet; a spell's point needs a
// clear path from its caster.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { conjuredStrikeSpot } = await import("../src/lib/dm/conjured-strike-logic.ts");
const { forPlayers } = await import("../src/lib/language/player-text.ts");

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
  } catch (error) {
    console.error(`FAIL: ${name}`);
    throw error;
  }
}

// A 20 by 20 floor, with walls painted on it.
function board(walls = []) {
  const tiles = new Array(400).fill(".");
  for (const [x, y] of walls) tiles[y * 20 + x] = "#";
  return { terrain: tiles.join(""), width: 20, height: 20 };
}

const SPIRITUAL = { reachTiles: 1, moveTiles: 4, rangeTiles: 12 };
const one = (x, y) => ({ at: { x, y }, footprint: 1 });

test("A new weapon appears within 60 feet of its caster, beside the target", () => {
  const spot = conjuredStrikeSpot({ board: board(), mode: "place", ...SPIRITUAL, caster: { x: 2, y: 2 }, origin: null, target: one(2, 12), occupied: new Set() });
  assert.ok("at" in spot);
  assert.ok(Math.max(Math.abs(spot.at.x - 2), Math.abs(spot.at.y - 12)) === 1, "not beside the target");
  assert.ok(Math.max(Math.abs(spot.at.x - 2), Math.abs(spot.at.y - 2)) <= 12, "beyond 60 feet of the caster");
});

test("A target past 65 feet of the caster is out of a new weapon's reach", () => {
  const spot = conjuredStrikeSpot({ board: board(), mode: "place", ...SPIRITUAL, caster: { x: 2, y: 2 }, origin: null, target: one(2, 16), occupied: new Set() });
  assert.deepEqual(spot, { out: "range", apartTiles: 14 });
});

test("A weapon is never set down behind a wall from its caster", () => {
  // A wall across the board at row 6 but for nothing: the target beyond it
  // can only be reached from a square the caster cannot see.
  const walls = Array.from({ length: 20 }, (_, x) => [x, 6]);
  const spot = conjuredStrikeSpot({ board: board(walls), mode: "place", ...SPIRITUAL, caster: { x: 2, y: 2 }, origin: null, target: one(2, 9), occupied: new Set() });
  assert.equal(spot.out, "range");
});

test("A floating weapon flies up to 20 feet to strike, the least distance it can", () => {
  const spot = conjuredStrikeSpot({ board: board(), mode: "move", ...SPIRITUAL, caster: { x: 2, y: 2 }, origin: { x: 5, y: 10 }, target: one(9, 10), occupied: new Set() });
  assert.equal(spot.movedTiles, 3);
  assert.equal(spot.at.x, 8, "not beside the target");
  assert.ok(Math.abs(spot.at.y - 10) <= 1, "not beside the target");
});

test("A weapon already beside the target stays where it floats", () => {
  const spot = conjuredStrikeSpot({ board: board(), mode: "move", ...SPIRITUAL, caster: { x: 2, y: 2 }, origin: { x: 5, y: 10 }, target: one(6, 11), occupied: new Set() });
  assert.deepEqual(spot, { at: { x: 5, y: 10 }, movedTiles: 0 });
});

test("A target past the weapon's move and reach is out of reach, measured from the weapon", () => {
  const spot = conjuredStrikeSpot({ board: board(), mode: "move", ...SPIRITUAL, caster: { x: 5, y: 9 }, origin: { x: 5, y: 2 }, target: one(5, 10), occupied: new Set() });
  assert.deepEqual(spot, { out: "move", apartTiles: 8 });
});

test("The weapon flies around a wall, not through it", () => {
  // A wall from (7,0) to (7,12) with the gap below: the straight line is 3
  // tiles, around the wall's end it is more than 4.
  const walls = Array.from({ length: 13 }, (_, y) => [7, y]);
  const spot = conjuredStrikeSpot({ board: board(walls), mode: "move", ...SPIRITUAL, caster: { x: 2, y: 2 }, origin: { x: 5, y: 2 }, target: one(9, 2), occupied: new Set() });
  assert.equal(spot.out, "move");
});

test("A Large target is struck from beside any of its four squares", () => {
  const spot = conjuredStrikeSpot({ board: board(), mode: "move", ...SPIRITUAL, caster: { x: 2, y: 2 }, origin: { x: 5, y: 10 }, target: { at: { x: 9, y: 9 }, footprint: 2 }, occupied: new Set() });
  assert.ok("at" in spot);
  assert.equal(spot.movedTiles, 3, "it flew farther than the Large target's nearest side");
});

test("An empty square is preferred over one a creature stands on", () => {
  const occupied = new Set([10 * 20 + 8]);
  const spot = conjuredStrikeSpot({ board: board(), mode: "move", ...SPIRITUAL, caster: { x: 2, y: 2 }, origin: { x: 5, y: 10 }, target: one(9, 10), occupied });
  assert.ok("at" in spot);
  assert.ok(!(spot.at.x === 8 && spot.at.y === 10), "it chose the occupied square");
});

test("A weapon set down where the caster named strikes from there or not at all on the casting turn", () => {
  const near = conjuredStrikeSpot({ board: board(), mode: "fixed", ...SPIRITUAL, caster: { x: 2, y: 2 }, origin: { x: 5, y: 10 }, target: one(5, 11), occupied: new Set() });
  assert.deepEqual(near, { at: { x: 5, y: 10 }, movedTiles: 0 });
  const far = conjuredStrikeSpot({ board: board(), mode: "fixed", ...SPIRITUAL, caster: { x: 2, y: 2 }, origin: { x: 5, y: 10 }, target: one(9, 10), occupied: new Set() });
  assert.deepEqual(far, { out: "fixed", apartTiles: 4 });
});

test("Players read a rules line without the GM's tool directions", () => {
  assert.equal(
    forPlayers("Crown of Stars: seven motes; a bonus action hurls one (pc_attack, weapon 'Crown of Stars', 4d12 radiant). Track spent motes in the narration."),
    "Crown of Stars: seven motes; a bonus action hurls one (4d12 radiant). Track spent motes in the narration.",
  );
  assert.equal(
    forPlayers("Form of Dread: immune to being frightened, and a creature they hit must pass a WIS save or be frightened (resolve via cast_at_enemy)."),
    "Form of Dread: immune to being frightened, and a creature they hit must pass a WIS save or be frightened.",
  );
  assert.equal(forPlayers("Spiritual Weapon: strikes a creature within 5 feet. Resolve it with pc_attack, weapon 'Spiritual Weapon'."), "Spiritual Weapon: strikes a creature within 5 feet.");
  assert.equal(forPlayers("Bless: +1d4 to attack rolls and saving throws."), "Bless: +1d4 to attack rolls and saving throws.");
});

console.log(`test-conjured-strike-logic: ${passed} passed`);
