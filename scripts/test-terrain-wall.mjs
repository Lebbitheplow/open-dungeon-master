// The sixth tile: a low wall, fence or ledge (docs/vtt-parity-
// implementation-plan.md section 3.1). Nothing walks through it, a flier
// crosses it, everything sees over it, and a creature directly behind it
// has half cover. Every consumer of the alphabet is touched once here.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { TERRAIN, blocksMove, blocksMoveFor, blocksSight, moveCost, tileIndex } = await import(
  "../src/lib/battlemap/types.ts"
);
const { findPath, reachableTiles } = await import("../src/lib/battlemap/movement.ts");
const { computeFov, coverBetween, hasLineOfSight } = await import("../src/lib/battlemap/los.ts");
const { BRUSHES, BRUSH_LABELS, BRUSH_EFFECTS, paintTerrain } = await import("../src/lib/battlemap/paint.ts");
const { STAMP_CHARS } = await import("../src/lib/battlemap/stamp.ts");
const { generateBattleMap } = await import("../src/lib/battlemap/generate.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

test("the tile exists and has the right rules", () => {
  assert.equal(TERRAIN.lowwall, "|");
  assert.equal(blocksMove("|"), true);
  assert.equal(blocksSight("|"), false);
  assert.equal(blocksMoveFor("|", true), false, "a flier passes over it");
  assert.equal(blocksMoveFor("|", false), true);
  assert.equal(blocksMoveFor("#", true), true, "a real wall stops a flier too");
  assert.equal(moveCost("|"), 1);
});

test("the painter, the stamps and the palette know it", () => {
  assert.ok(BRUSHES.includes("lowwall"));
  assert.equal(BRUSH_LABELS.lowwall, "Low wall");
  assert.match(BRUSH_EFFECTS.lowwall, /cover/);
  assert.ok(STAMP_CHARS.includes("|"));
});

// A 9 by 5 field with a fence down column 4, gap at row 2.
const WIDTH = 9;
const HEIGHT = 5;
const rows = ["#########", "#...|...#", "#.......#", "#...|...#", "#########"];
const FIELD = rows.join("");

test("a walker goes round the fence; a flier goes over it", () => {
  const from = { x: 2, y: 1 };
  const to = { x: 6, y: 1 };
  const walk = findPath(FIELD, WIDTH, HEIGHT, new Set(), from, to);
  assert.ok(walk, "there is a way round through the gap");
  assert.ok(walk.some((step) => step.y === 2), "the walker dips through the gap row");
  const fly = findPath(FIELD, WIDTH, HEIGHT, new Set(), from, to, 1, true);
  assert.ok(fly);
  assert.equal(fly.length, 4, "the flier goes straight across");
  const reach = reachableTiles(FIELD, WIDTH, HEIGHT, new Set(), from, 2);
  assert.equal(reach.has(tileIndex(WIDTH, 4, 1)), false, "nobody stands on the fence");
  const flyReach = reachableTiles(FIELD, WIDTH, HEIGHT, new Set(), from, 2, 1, true);
  assert.equal(flyReach.has(tileIndex(WIDTH, 4, 1)), true, "a flier may hover over it");
  assert.equal(flyReach.has(tileIndex(WIDTH, 6, 1)), false, "but its budget still counts");
});

test("sight passes over it, and it gives half cover to whoever stands behind it", () => {
  assert.equal(hasLineOfSight(FIELD, WIDTH, HEIGHT, 2, 1, 6, 1), true);
  const fov = computeFov(FIELD, WIDTH, HEIGHT, 2, 1, 10);
  assert.ok(fov.has(tileIndex(WIDTH, 6, 1)), "the far side is in view");
  // Attacker at (2,1), target at (5,1): the fence at (4,1) is between them.
  assert.equal(coverBetween(FIELD, WIDTH, HEIGHT, 2, 1, 5, 1), 2, "half cover");
  // Same target with a real wall in front would be three-quarters at most.
  assert.equal(coverBetween(FIELD, WIDTH, HEIGHT, 2, 3, 5, 3), 2);
  // Toe to toe there is nothing between them.
  assert.equal(coverBetween(FIELD, WIDTH, HEIGHT, 3, 1, 4, 2), 0);
});

test("the painter writes it and reads it back", () => {
  const painted = paintTerrain({
    terrain: FIELD,
    width: WIDTH,
    height: HEIGHT,
    strokes: [{ x: 2, y: 2, brush: "lowwall" }],
    limit: WIDTH * HEIGHT,
  });
  const terrain = "terrain" in painted ? painted.terrain : painted;
  assert.equal(typeof terrain, "string");
  assert.equal(terrain[tileIndex(WIDTH, 2, 2)], "|");
});

test("the field generator sometimes builds a fence with a gap", () => {
  let fenced = 0;
  for (let seed = 1; seed <= 40; seed += 1) {
    const map = generateBattleMap({ seed, hint: "an open field", pcCount: 2, enemyCount: 2 });
    if (map.terrain.includes("|")) {
      fenced += 1;
      // Every fence tile stands on what was floor, inside the border.
      const tiles = map.terrain.split("");
      for (let i = 0; i < tiles.length; i += 1) {
        if (tiles[i] === "|") {
          const x = i % map.width;
          const y = Math.floor(i / map.width);
          assert.ok(x > 0 && y > 0 && x < map.width - 1 && y < map.height - 1);
        }
      }
    }
  }
  assert.ok(fenced > 5 && fenced < 40, `fences in ${fenced} of 40 fields`);
});

console.log(`test-terrain-wall: ${passed} passed`);
