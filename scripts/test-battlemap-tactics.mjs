// Ranged tactics: pairwise line of sight and firing-position selection.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { hasLineOfSight } = await import("../src/lib/battlemap/los.ts");
const { bestFiringPosition, findSpawnTiles } = await import("../src/lib/battlemap/tactics.ts");
const { tileIndex } = await import("../src/lib/battlemap/types.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

function makeMap(rows) {
  const width = rows[0].length;
  return { terrain: rows.join(""), width, height: rows.length };
}

// Open room with a wall pillar in the middle row.
const room = makeMap([
  "#########",
  "#.......#",
  "#...#...#",
  "#.......#",
  "#########",
]);

test("open line is sighted", () => {
  assert.ok(hasLineOfSight(room.terrain, room.width, room.height, 1, 1, 7, 1));
});

test("wall between blocks sight", () => {
  assert.ok(!hasLineOfSight(room.terrain, room.width, room.height, 2, 2, 6, 2));
});

test("endpoints never block themselves", () => {
  // Adjacent tiles always see each other, even next to walls.
  assert.ok(hasLineOfSight(room.terrain, room.width, room.height, 3, 2, 3, 1));
});

test("firing position routes around the pillar", () => {
  // Shooter at (2,2) cannot see (6,2) through the pillar at (4,2); a one
  // tile step up or down restores sight.
  const spot = bestFiringPosition(
    room.terrain,
    room.width,
    room.height,
    new Set(),
    { x: 2, y: 2 },
    { x: 6, y: 2 },
    6,
    12,
  );
  assert.ok(spot);
  assert.ok(
    hasLineOfSight(room.terrain, room.width, room.height, spot.at.x, spot.at.y, 6, 2),
  );
  assert.equal(spot.cost, 1);
});

test("range limit is respected", () => {
  const spot = bestFiringPosition(
    room.terrain,
    room.width,
    room.height,
    new Set(),
    { x: 1, y: 1 },
    { x: 7, y: 1 },
    1,
    3,
  );
  // Only 1 tile of budget: nothing within 3 tiles of the target is
  // reachable, so no firing position exists.
  assert.equal(spot, null);
});

test("occupied tiles are not firing positions", () => {
  const occupied = new Set([
    tileIndex(room.width, 2, 1),
    tileIndex(room.width, 2, 3),
    tileIndex(room.width, 1, 2),
    tileIndex(room.width, 3, 1),
    tileIndex(room.width, 3, 3),
    tileIndex(room.width, 1, 1),
    tileIndex(room.width, 1, 3),
  ]);
  const spot = bestFiringPosition(
    room.terrain,
    room.width,
    room.height,
    occupied,
    { x: 2, y: 2 },
    { x: 6, y: 2 },
    1,
    12,
  );
  // Every adjacent tile is occupied and the current tile has no sight.
  assert.equal(spot, null);
});

test("spawn tiles cluster near anchors and never stack", () => {
  const spots = findSpawnTiles(
    room.terrain,
    room.width,
    room.height,
    new Set([tileIndex(room.width, 6, 2)]),
    2,
    [{ x: 6, y: 2 }],
    [{ x: 1, y: 1 }],
  );
  assert.equal(spots.length, 2);
  const keys = new Set(spots.map((spot) => tileIndex(room.width, spot.x, spot.y)));
  assert.equal(keys.size, 2);
  for (const spot of spots) {
    assert.ok(Math.max(Math.abs(spot.x - 6), Math.abs(spot.y - 2)) <= 1);
    assert.ok(!keys.has(tileIndex(room.width, 6, 2)) || spot.x !== 6 || spot.y !== 2);
  }
});

test("spawn tiles without anchors enter far from the party", () => {
  const spots = findSpawnTiles(
    room.terrain,
    room.width,
    room.height,
    new Set(),
    1,
    [],
    [{ x: 1, y: 1 }],
  );
  assert.equal(spots.length, 1);
  // Farthest floor tiles from (1,1) sit along the far wall, 6 tiles out.
  const distance = Math.max(Math.abs(spots[0].x - 1), Math.abs(spots[0].y - 1));
  assert.equal(distance, 6);
});

console.log(`test-battlemap-tactics: ${passed} tests passed.`);
