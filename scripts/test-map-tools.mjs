// The shape tools and the undo compiler: a line, an outline, a box and a
// fill each become brush strokes, and a whole terrain to return to becomes
// the strokes that differ. paintTerrain owns every rule about a legal map,
// so these tests run the compiled strokes through it to prove nothing here
// is a second painter. See docs/workshop-parity-audit.md phase 10.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const {
  SHAPE_TOOLS,
  SHAPE_LABELS,
  SHAPE_EFFECTS,
  compilePaint,
  describeShape,
  diffStrokes,
  emptyPaintIsFine,
  normalizeShape,
  shapeStrokes,
} = await import("../src/lib/battlemap/tools.ts");
const { paintTerrain } = await import("../src/lib/battlemap/paint.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

const WIDTH = 12;
const HEIGHT = 8;
function room(inner = ".") {
  const tiles = [];
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      tiles.push(x === 0 || y === 0 || x === WIDTH - 1 || y === HEIGHT - 1 ? "#" : inner);
    }
  }
  return tiles.join("");
}
const at = (terrain, x, y) => terrain[y * WIDTH + x];
const apply = (terrain, strokes) =>
  paintTerrain({ terrain, width: WIDTH, height: HEIGHT, strokes, limit: WIDTH * HEIGHT });

test("every tool has a label and a sentence", () => {
  for (const tool of SHAPE_TOOLS) {
    assert.ok(SHAPE_LABELS[tool]);
    assert.ok(SHAPE_EFFECTS[tool].endsWith("."));
    assert.ok(describeShape({ tool, brush: "wall" }).includes(SHAPE_LABELS[tool]));
  }
});

test("a line runs straight between its two ends", () => {
  const strokes = shapeStrokes(
    { tool: "line", brush: "wall", from: { x: 2, y: 2 }, to: { x: 9, y: 2 } },
    room(),
    WIDTH,
    HEIGHT,
  );
  assert.equal(strokes.length, 8);
  const painted = apply(room(), strokes);
  assert.ok("terrain" in painted);
  for (let x = 2; x <= 9; x += 1) {
    assert.equal(at(painted.terrain, x, 2), "#");
  }
  assert.equal(at(painted.terrain, 5, 3), ".");
});

test("a diagonal line touches both ends and never skips a row", () => {
  const strokes = shapeStrokes(
    { tool: "line", brush: "water", from: { x: 9, y: 6 }, to: { x: 2, y: 1 } },
    room(),
    WIDTH,
    HEIGHT,
  );
  assert.ok(strokes.some((s) => s.x === 9 && s.y === 6));
  assert.ok(strokes.some((s) => s.x === 2 && s.y === 1));
  const rows = new Set(strokes.map((s) => s.y));
  for (let y = 1; y <= 6; y += 1) {
    assert.ok(rows.has(y), `row ${y} should be touched`);
  }
});

test("an outline draws the edge and leaves the middle alone", () => {
  const strokes = shapeStrokes(
    { tool: "rect", brush: "wall", from: { x: 2, y: 2 }, to: { x: 6, y: 5 } },
    room(),
    WIDTH,
    HEIGHT,
  );
  // 5 wide by 4 tall: perimeter is 2*5 + 2*4 - 4 corners counted twice.
  assert.equal(strokes.length, 14);
  const painted = apply(room(), strokes);
  assert.ok("terrain" in painted);
  assert.equal(at(painted.terrain, 2, 2), "#");
  assert.equal(at(painted.terrain, 6, 5), "#");
  assert.equal(at(painted.terrain, 4, 3), ".");
});

test("a box fills the whole rectangle whichever corner came first", () => {
  const strokes = shapeStrokes(
    { tool: "box", brush: "difficult", from: { x: 6, y: 5 }, to: { x: 2, y: 2 } },
    room(),
    WIDTH,
    HEIGHT,
  );
  assert.equal(strokes.length, 20);
  const painted = apply(room(), strokes);
  assert.ok("terrain" in painted);
  assert.equal(at(painted.terrain, 4, 3), ",");
});

test("shapes skip the border rather than ask the painter to refuse it", () => {
  const strokes = shapeStrokes(
    { tool: "box", brush: "floor", from: { x: 0, y: 0 }, to: { x: WIDTH - 1, y: HEIGHT - 1 } },
    room("#"),
    WIDTH,
    HEIGHT,
  );
  assert.equal(strokes.length, (WIDTH - 2) * (HEIGHT - 2));
  assert.ok(strokes.every((s) => s.x > 0 && s.y > 0 && s.x < WIDTH - 1 && s.y < HEIGHT - 1));
  const painted = apply(room("#"), strokes);
  assert.ok("terrain" in painted);
  assert.equal(at(painted.terrain, 0, 0), "#");
  assert.equal(at(painted.terrain, 1, 1), ".");
});

test("a fill takes every connected tile of the same kind and stops at a wall", () => {
  // Two rooms divided by a wall down column 6.
  let terrain = room();
  const divided = terrain.split("");
  for (let y = 1; y < HEIGHT - 1; y += 1) {
    divided[y * WIDTH + 6] = "#";
  }
  terrain = divided.join("");
  const strokes = shapeStrokes(
    { tool: "fill", brush: "water", from: { x: 2, y: 2 }, to: { x: 2, y: 2 } },
    terrain,
    WIDTH,
    HEIGHT,
  );
  // Left room: columns 1..5, rows 1..6.
  assert.equal(strokes.length, 5 * 6);
  const painted = apply(terrain, strokes);
  assert.ok("terrain" in painted);
  assert.equal(at(painted.terrain, 3, 3), "~");
  assert.equal(at(painted.terrain, 8, 3), ".");
});

test("a fill of a tile that already wears the brush is nothing", () => {
  const strokes = shapeStrokes(
    { tool: "fill", brush: "floor", from: { x: 2, y: 2 }, to: { x: 2, y: 2 } },
    room(),
    WIDTH,
    HEIGHT,
  );
  assert.equal(strokes.length, 0);
  assert.ok(emptyPaintIsFine({ shape: { tool: "fill", brush: "floor", from: { x: 2, y: 2 }, to: { x: 2, y: 2 } } }));
  assert.ok(!emptyPaintIsFine({ strokes: [] }));
});

test("a fill started on the border does nothing", () => {
  const strokes = shapeStrokes(
    { tool: "fill", brush: "floor", from: { x: 0, y: 3 }, to: { x: 0, y: 3 } },
    room(),
    WIDTH,
    HEIGHT,
  );
  assert.equal(strokes.length, 0);
});

test("normalizeShape clamps a drag that ended off the map and refuses nonsense", () => {
  const shape = normalizeShape(
    { tool: "line", brush: "wall", from: { x: -4, y: 2.4 }, to: { x: 99, y: 99 } },
    WIDTH,
    HEIGHT,
  );
  assert.deepEqual(shape, { tool: "line", brush: "wall", from: { x: 0, y: 2 }, to: { x: WIDTH - 1, y: HEIGHT - 1 } });
  assert.equal(normalizeShape({ tool: "stairs", brush: "wall", from: { x: 1, y: 1 } }, WIDTH, HEIGHT), null);
  assert.equal(normalizeShape({ tool: "line", brush: "lava", from: { x: 1, y: 1 } }, WIDTH, HEIGHT), null);
  assert.equal(normalizeShape({ tool: "line", brush: "wall" }, WIDTH, HEIGHT), null);
  // A missing `to` is a tap: the shape starts and ends on the same tile.
  const tap = normalizeShape({ tool: "fill", brush: "wall", from: { x: 3, y: 3 } }, WIDTH, HEIGHT);
  assert.deepEqual(tap?.to, { x: 3, y: 3 });
});

test("an undo is the strokes that differ, and nothing else", () => {
  const before = room();
  const painted = apply(
    before,
    shapeStrokes({ tool: "box", brush: "wall", from: { x: 2, y: 2 }, to: { x: 4, y: 4 } }, before, WIDTH, HEIGHT),
  );
  assert.ok("terrain" in painted);
  const back = diffStrokes(painted.terrain, before, WIDTH, HEIGHT);
  assert.ok("strokes" in back);
  assert.equal(back.strokes.length, 9);
  assert.ok(back.strokes.every((s) => s.brush === "floor"));
  const restored = apply(painted.terrain, back.strokes);
  assert.ok("terrain" in restored);
  assert.equal(restored.terrain, before);
});

test("an undo to a different size or an unknown tile is refused", () => {
  assert.ok("error" in diffStrokes(room(), room().slice(1), WIDTH, HEIGHT));
  const alien = room().split("");
  alien[2 * WIDTH + 2] = "X";
  const outcome = diffStrokes(room(), alien.join(""), WIDTH, HEIGHT);
  assert.ok("error" in outcome);
  assert.ok(outcome.error.includes('"X"'));
});

test("an undo ignores the border, which the painter protects anyway", () => {
  const opened = room().split("");
  opened[0] = ".";
  const outcome = diffStrokes(room(), opened.join(""), WIDTH, HEIGHT);
  assert.ok("strokes" in outcome);
  assert.equal(outcome.strokes.length, 0);
});

test("compilePaint bounds compiled strokes by the map and hand strokes by nothing here", () => {
  const filled = compilePaint(
    { shape: { tool: "box", brush: "wall", from: { x: 1, y: 1 }, to: { x: 10, y: 6 } } },
    room(),
    WIDTH,
    HEIGHT,
  );
  assert.ok("strokes" in filled);
  assert.equal(filled.limit, WIDTH * HEIGHT);
  assert.equal(filled.strokes.length, 60);
  const hand = compilePaint({ strokes: [{ x: 1, y: 1, brush: "wall" }] }, room(), WIDTH, HEIGHT);
  assert.ok("strokes" in hand);
  assert.equal(hand.limit, Number.POSITIVE_INFINITY);
  const undo = compilePaint({ replaceTerrain: room() }, room(), WIDTH, HEIGHT);
  assert.ok("strokes" in undo);
  assert.equal(undo.strokes.length, 0);
  const stamped = compilePaint(
    { stamp: { kind: "room", x: 5, y: 4, width: 4, height: 3 } },
    room("#"),
    WIDTH,
    HEIGHT,
  );
  assert.ok("strokes" in stamped);
  assert.ok(stamped.strokes.length > 0);
});

test("a compiled shape larger than the wire cap still paints in one pass", () => {
  // The wire cap is 600; a 62x62 fill is 3,844 tiles and must be one edit.
  const big = 64;
  const rock = new Array(big * big).fill("#").join("");
  const strokes = shapeStrokes(
    { tool: "box", brush: "floor", from: { x: 1, y: 1 }, to: { x: big - 2, y: big - 2 } },
    rock,
    big,
    big,
  );
  assert.equal(strokes.length, (big - 2) * (big - 2));
  const painted = paintTerrain({ terrain: rock, width: big, height: big, strokes, limit: big * big });
  assert.ok("terrain" in painted);
  const capped = paintTerrain({ terrain: rock, width: big, height: big, strokes });
  assert.ok("error" in capped);
});

console.log(`test-map-tools: ${passed} passed`);
