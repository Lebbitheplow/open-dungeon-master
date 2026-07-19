// Grid movement: budgets, difficult terrain, wall detours, occupancy, and
// budget-clamped path walking.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { reachableTiles, findPath, walkPathWithBudget, speedToTiles } = await import(
  "../src/lib/battlemap/movement.ts"
);
const { tileIndex } = await import("../src/lib/battlemap/types.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

const open = [
  "#########",
  "#.......#",
  "#.......#",
  "#.......#",
  "#########",
].join("");
const W = 9;
const H = 5;

test("speed 30 = 6 tiles of straight movement", () => {
  const reach = reachableTiles(open, W, H, new Set(), { x: 1, y: 1 }, 6);
  assert.equal(reach.get(tileIndex(W, 7, 1)), 6);
});

test("diagonals cost 1 (Chebyshev movement)", () => {
  const reach = reachableTiles(open, W, H, new Set(), { x: 1, y: 1 }, 2);
  assert.equal(reach.get(tileIndex(W, 3, 3)), 2);
});

test("budget excludes farther tiles and the start tile", () => {
  const reach = reachableTiles(open, W, H, new Set(), { x: 1, y: 1 }, 3);
  assert.ok(!reach.has(tileIndex(W, 7, 1)));
  assert.ok(!reach.has(tileIndex(W, 1, 1)));
});

test("difficult terrain costs double", () => {
  const rough = [
    "#########",
    "#.,,....#",
    "#########",
  ].join("");
  const reach = reachableTiles(rough, 9, 3, new Set(), { x: 1, y: 1 }, 4);
  assert.equal(reach.get(tileIndex(9, 2, 1)), 2);
  assert.equal(reach.get(tileIndex(9, 3, 1)), 4);
  assert.ok(!reach.has(tileIndex(9, 4, 1)), "budget spent in the rough");
});

test("walls force a detour", () => {
  const walled = [
    "#########",
    "#...#...#",
    "#...#...#",
    "#.......#",
    "#########",
  ].join("");
  const reach = reachableTiles(walled, W, H, new Set(), { x: 1, y: 1 }, 10);
  // Straight line would be 4; the wall forces a dip through row 3.
  assert.ok((reach.get(tileIndex(W, 7, 1)) ?? 99) > 4);
  const path = findPath(walled, W, H, new Set(), { x: 1, y: 1 }, { x: 7, y: 1 });
  assert.ok(path !== null);
  assert.ok(path.some((step) => step.y >= 2), "path dips below the wall");
});

test("occupied tiles block movement and destinations", () => {
  const occupied = new Set([tileIndex(W, 2, 1)]);
  const reach = reachableTiles(open, W, H, occupied, { x: 1, y: 1 }, 2);
  assert.ok(!reach.has(tileIndex(W, 2, 1)));
  // Going around via (2,2) still reaches (3,1).
  assert.equal(reach.get(tileIndex(W, 3, 1)), 2);
});

test("fully enclosed target is unreachable", () => {
  const sealed = [
    "#########",
    "#..###..#",
    "#..#.#..#",
    "#..###..#",
    "#########",
  ].join("");
  assert.equal(findPath(sealed, W, H, new Set(), { x: 1, y: 1 }, { x: 4, y: 2 }), null);
});

test("findPath allows the goal tile to be occupied (approach)", () => {
  const occupied = new Set([tileIndex(W, 5, 1)]);
  const path = findPath(open, W, H, occupied, { x: 1, y: 1 }, { x: 5, y: 1 });
  assert.ok(path !== null);
});

test("walkPathWithBudget clamps at the last affordable tile", () => {
  const path = findPath(open, W, H, new Set(), { x: 1, y: 1 }, { x: 7, y: 1 });
  const walk = walkPathWithBudget(open, W, path, 3);
  assert.equal(walk.reachedEnd, false);
  assert.deepEqual(walk.at, { x: 4, y: 1 });
  assert.equal(walk.spent, 3);
});

test("speedToTiles parses stat-block strings", () => {
  assert.equal(speedToTiles("30 ft."), 6);
  assert.equal(speedToTiles("40 ft., fly 80 ft."), 8);
  assert.equal(speedToTiles(25), 5);
  assert.equal(speedToTiles(undefined), 6);
  assert.equal(speedToTiles("gibberish"), 6);
});

console.log(`test-battlemap-movement: ${passed} tests passed.`);
