// Painting battle-map terrain by hand: the brush itself is a string edit,
// so everything worth testing is what the module refuses.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { paintTerrain, nearestOpenTile, BRUSHES, BRUSH_LABELS, MAX_STROKES } = await import(
  "../src/lib/battlemap/paint.ts"
);

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

// A 10x6 room: walled border, open floor inside.
const WIDTH = 10;
const HEIGHT = 6;
function room() {
  const tiles = [];
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      tiles.push(x === 0 || y === 0 || x === WIDTH - 1 || y === HEIGHT - 1 ? "#" : ".");
    }
  }
  return tiles.join("");
}
const at = (terrain, x, y) => terrain[y * WIDTH + x];

test("every brush has a label", () => {
  assert.ok(BRUSHES.length >= 5);
  for (const brush of BRUSHES) {
    assert.ok(BRUSH_LABELS[brush], `${brush} has no label`);
  }
});

test("a stroke paints its tile and leaves the rest alone", () => {
  const painted = paintTerrain({
    terrain: room(),
    width: WIDTH,
    height: HEIGHT,
    strokes: [{ x: 3, y: 2, brush: "difficult" }],
  });
  assert.ok(!("error" in painted), painted.error);
  assert.equal(at(painted.terrain, 3, 2), ",");
  assert.equal(at(painted.terrain, 4, 2), ".");
  assert.equal(painted.terrain.length, WIDTH * HEIGHT);
});

test("a radius paints a square around the point", () => {
  const painted = paintTerrain({
    terrain: room(),
    width: WIDTH,
    height: HEIGHT,
    strokes: [{ x: 4, y: 3, brush: "water", radius: 1 }],
  });
  assert.ok(!("error" in painted));
  for (const [x, y] of [[3, 2], [4, 2], [5, 2], [3, 3], [5, 4]]) {
    assert.equal(at(painted.terrain, x, y), "~", `(${x},${y})`);
  }
  assert.equal(at(painted.terrain, 6, 3), ".");
});

test("the border is never repainted", () => {
  const painted = paintTerrain({
    terrain: room(),
    width: WIDTH,
    height: HEIGHT,
    // A wide brush right on the edge: the inside changes, the rim does not.
    strokes: [{ x: 1, y: 1, brush: "floor", radius: 2 }],
  });
  assert.ok(!("error" in painted));
  assert.equal(at(painted.terrain, 0, 0), "#");
  assert.equal(at(painted.terrain, 0, 3), "#");
  assert.equal(at(painted.terrain, 5, 0), "#");
});

test("a wall cannot be painted over someone standing there", () => {
  const painted = paintTerrain({
    terrain: room(),
    width: WIDTH,
    height: HEIGHT,
    strokes: [{ x: 4, y: 3, brush: "wall" }],
    occupied: [{ x: 4, y: 3 }],
  });
  assert.ok("error" in painted);
  assert.match(painted.error, /standing there/i);
});

test("rough ground may be painted under someone", () => {
  const painted = paintTerrain({
    terrain: room(),
    width: WIDTH,
    height: HEIGHT,
    strokes: [{ x: 4, y: 3, brush: "difficult" }],
    occupied: [{ x: 4, y: 3 }],
  });
  assert.ok(!("error" in painted));
  assert.equal(at(painted.terrain, 4, 3), ",");
});

test("a wall across the room that separates two combatants is refused", () => {
  const strokes = [];
  for (let y = 1; y < HEIGHT - 1; y += 1) {
    strokes.push({ x: 5, y, brush: "wall" });
  }
  const painted = paintTerrain({
    terrain: room(),
    width: WIDTH,
    height: HEIGHT,
    strokes,
    occupied: [{ x: 2, y: 2 }, { x: 7, y: 3 }],
  });
  assert.ok("error" in painted);
  assert.match(painted.error, /wall a combatant off/i);
});

test("the same wall is allowed when it separates nobody", () => {
  const strokes = [];
  for (let y = 1; y < HEIGHT - 1; y += 1) {
    strokes.push({ x: 5, y, brush: "wall" });
  }
  const painted = paintTerrain({
    terrain: room(),
    width: WIDTH,
    height: HEIGHT,
    strokes,
    occupied: [{ x: 2, y: 2 }],
  });
  assert.ok(!("error" in painted), painted.error);
});

test("a door in that wall keeps the room connected", () => {
  const strokes = [];
  for (let y = 1; y < HEIGHT - 1; y += 1) {
    strokes.push({ x: 5, y, brush: "wall" });
  }
  strokes.push({ x: 5, y: 3, brush: "door" });
  const painted = paintTerrain({
    terrain: room(),
    width: WIDTH,
    height: HEIGHT,
    strokes,
    occupied: [{ x: 2, y: 2 }, { x: 7, y: 3 }],
  });
  assert.ok(!("error" in painted), painted.error);
  assert.equal(at(painted.terrain, 5, 3), "+");
});

test("sealing a combatant in on every side is refused", () => {
  const painted = paintTerrain({
    terrain: room(),
    width: WIDTH,
    height: HEIGHT,
    strokes: [
      { x: 3, y: 2, brush: "wall" },
      { x: 5, y: 2, brush: "wall" },
      { x: 4, y: 1, brush: "wall" },
      { x: 4, y: 3, brush: "wall" },
    ],
    occupied: [{ x: 4, y: 2 }],
  });
  assert.ok("error" in painted);
  assert.match(painted.error, /seal a combatant in/i);
});

test("an empty or oversized pass is refused before anything is painted", () => {
  const empty = paintTerrain({ terrain: room(), width: WIDTH, height: HEIGHT, strokes: [] });
  assert.ok("error" in empty);
  const flood = paintTerrain({
    terrain: room(),
    width: WIDTH,
    height: HEIGHT,
    strokes: new Array(MAX_STROKES + 1).fill({ x: 2, y: 2, brush: "floor" }),
  });
  assert.ok("error" in flood);
  assert.match(flood.error, /passes/i);
});

test("terrain that does not match its size is refused", () => {
  const painted = paintTerrain({
    terrain: "....",
    width: WIDTH,
    height: HEIGHT,
    strokes: [{ x: 1, y: 1, brush: "floor" }],
  });
  assert.ok("error" in painted);
});

test("an unknown brush is refused", () => {
  const painted = paintTerrain({
    terrain: room(),
    width: WIDTH,
    height: HEIGHT,
    strokes: [{ x: 2, y: 2, brush: "lava" }],
  });
  assert.ok("error" in painted);
  assert.match(painted.error, /not a brush/);
});

test("nearestOpenTile keeps a token where it stands when it still can", () => {
  const terrain = room();
  assert.deepEqual(nearestOpenTile(terrain, WIDTH, HEIGHT, { x: 3, y: 2 }, new Set()), {
    x: 3,
    y: 2,
  });
});

test("nearestOpenTile walks a token off a wall and off a taken tile", () => {
  const terrain = room();
  const offWall = nearestOpenTile(terrain, WIDTH, HEIGHT, { x: 0, y: 0 }, new Set());
  assert.equal(at(terrain, offWall.x, offWall.y), ".");
  // (3,2) is open but taken, so it must land somewhere adjacent instead.
  const taken = new Set([2 * WIDTH + 3]);
  const beside = nearestOpenTile(terrain, WIDTH, HEIGHT, { x: 3, y: 2 }, taken);
  assert.notDeepEqual(beside, { x: 3, y: 2 });
  assert.equal(at(terrain, beside.x, beside.y), ".");
});

console.log(`map-paint: ${passed} tests passed`);
