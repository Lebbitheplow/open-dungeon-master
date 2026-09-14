// Large creatures on the grid: a two-by-two ogre cannot squeeze down a
// one-tile corridor, cannot stop where its second row would overlap a wall
// or another token, and the occupancy set covers its whole footprint. See
// docs/vtt-parity-implementation-plan.md section 1.2.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { footprintForSize, footprintTiles, footprintIndexes, footprintFits, footprintCentre } =
  await import("../src/lib/battlemap/footprint.ts");
const { findPath, reachableTiles } = await import("../src/lib/battlemap/movement.ts");
const { tileIndex } = await import("../src/lib/battlemap/types.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

test("size words map to squares per side", () => {
  assert.equal(footprintForSize("Tiny"), 1);
  assert.equal(footprintForSize("Small"), 1);
  assert.equal(footprintForSize("Medium"), 1);
  assert.equal(footprintForSize("Large"), 2);
  assert.equal(footprintForSize("huge"), 3);
  assert.equal(footprintForSize("GARGANTUAN"), 4);
  assert.equal(footprintForSize(undefined), 1);
  assert.equal(footprintForSize(""), 1);
});

test("a footprint covers the square anchored at its top-left", () => {
  assert.deepEqual(footprintTiles({ x: 3, y: 4 }, 1), [{ x: 3, y: 4 }]);
  assert.deepEqual(footprintTiles({ x: 3, y: 4 }, 2), [
    { x: 3, y: 4 },
    { x: 4, y: 4 },
    { x: 3, y: 5 },
    { x: 4, y: 5 },
  ]);
  assert.deepEqual(footprintIndexes(10, { x: 3, y: 4 }, 2), [43, 44, 53, 54]);
  assert.deepEqual(footprintCentre({ x: 3, y: 4 }, 2), { x: 3.5, y: 4.5 });
  assert.equal(footprintFits(10, 8, { x: 8, y: 6 }, 2), true);
  assert.equal(footprintFits(10, 8, { x: 9, y: 6 }, 2), false);
  assert.equal(footprintFits(10, 8, { x: 8, y: 7 }, 2), false);
});

// A hall with a one-tile corridor on the right leading to a second room.
//   0123456789
// 0 ##########
// 1 #....#...#
// 2 #....#...#
// 3 #....+...#   <- a one-tile gap at (5,3)
// 4 #....#...#
// 5 #....#...#
// 6 ##########
const WIDTH = 10;
const HEIGHT = 7;
const rows = [
  "##########",
  "#....#...#",
  "#....#...#",
  "#........#",
  "#....#...#",
  "#....#...#",
  "##########",
];
const TERRAIN = rows.join("");

test("a medium creature walks through the gap; a large one cannot", () => {
  const from = { x: 2, y: 2 };
  const to = { x: 7, y: 2 };
  const medium = findPath(TERRAIN, WIDTH, HEIGHT, new Set(), from, to, 1);
  assert.ok(medium, "medium finds a path through the gap");
  const large = findPath(TERRAIN, WIDTH, HEIGHT, new Set(), from, to, 2);
  assert.equal(large, null, "large cannot squeeze through a one-tile gap");
});

test("a large creature may not stop where its footprint overlaps a wall", () => {
  // Anchor at (4,1): covers (5,1) which is wall.
  const reach = reachableTiles(TERRAIN, WIDTH, HEIGHT, new Set(), { x: 1, y: 1 }, 12, 2);
  assert.equal(reach.has(tileIndex(WIDTH, 4, 1)), false);
  assert.equal(reach.has(tileIndex(WIDTH, 3, 1)), true, "anchor (3,1) covers (3..4, 1..2): all floor");
  // Anchor at (3,4) covers (3..4, 4..5): all floor, so reachable.
  assert.equal(reach.has(tileIndex(WIDTH, 3, 4)), true);
  // Anchor at (4,4) covers (5,4) wall: no.
  assert.equal(reach.has(tileIndex(WIDTH, 4, 4)), false);
});

test("another token under any square of the footprint blocks the stop", () => {
  const occupied = new Set([tileIndex(WIDTH, 4, 2)]);
  const reach = reachableTiles(TERRAIN, WIDTH, HEIGHT, occupied, { x: 1, y: 1 }, 12, 2);
  // Anchor (3,1) covers (4,2): blocked. Anchor (3,3) covers (3..4, 3..4): free.
  assert.equal(reach.has(tileIndex(WIDTH, 3, 1)), false);
  assert.equal(reach.has(tileIndex(WIDTH, 3, 3)), true);
  const medium = reachableTiles(TERRAIN, WIDTH, HEIGHT, occupied, { x: 1, y: 1 }, 12, 1);
  assert.equal(medium.has(tileIndex(WIDTH, 3, 1)), true, "the medium creature is unaffected");
});

test("the default footprint keeps every old caller's answer", () => {
  const a = findPath(TERRAIN, WIDTH, HEIGHT, new Set(), { x: 1, y: 1 }, { x: 8, y: 5 });
  const b = findPath(TERRAIN, WIDTH, HEIGHT, new Set(), { x: 1, y: 1 }, { x: 8, y: 5 }, 1);
  assert.deepEqual(a, b);
});

console.log(`test-footprint-move: ${passed} passed`);
