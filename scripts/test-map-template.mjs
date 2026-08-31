// Measured templates: the cone, sphere, line and cube a DM drops on the
// board, and the wall that stops each of them.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const {
  MAX_TEMPLATE_FEET,
  SHAPE_LABELS,
  TEMPLATE_SHAPES,
  describeTemplate,
  templateTiles,
  tokensInTemplate,
} = await import("../src/lib/battlemap/template.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

// A 9x7 room: solid border, open floor inside.
const WIDTH = 9;
const HEIGHT = 7;
function room(interior = []) {
  const rows = [];
  for (let y = 0; y < HEIGHT; y += 1) {
    let row = "";
    for (let x = 0; x < WIDTH; x += 1) {
      const edge = x === 0 || y === 0 || x === WIDTH - 1 || y === HEIGHT - 1;
      row += edge ? "#" : ".";
    }
    rows.push(row);
  }
  const terrain = rows.join("").split("");
  for (const [x, y] of interior) {
    terrain[y * WIDTH + x] = "#";
  }
  return { terrain: terrain.join(""), width: WIDTH, height: HEIGHT };
}

const map = room();
const at = (idx) => ({ x: idx % WIDTH, y: Math.floor(idx / WIDTH) });

test("every shape has a label", () => {
  for (const shape of TEMPLATE_SHAPES) {
    assert.ok(SHAPE_LABELS[shape], `${shape} has no label`);
  }
});

test("a sphere covers everything within its radius, walls excluded", () => {
  const tiles = templateTiles(map, {
    shape: "sphere",
    origin: { x: 4, y: 3 },
    target: { x: 4, y: 3 },
    sizeFeet: 10,
  });
  // Two tiles in every direction from the middle of a 9x7 room, and the
  // border is wall, so the whole 5x5 lands on floor.
  assert.equal(tiles.length, 25);
  for (const idx of tiles) {
    const { x, y } = at(idx);
    assert.ok(Math.max(Math.abs(x - 4), Math.abs(y - 3)) <= 2);
    assert.equal(map.terrain[idx], ".");
  }
});

test("a sphere never counts the wall tiles it touches", () => {
  const tiles = templateTiles(map, {
    shape: "sphere",
    origin: { x: 1, y: 1 },
    target: { x: 1, y: 1 },
    sizeFeet: 10,
  });
  for (const idx of tiles) {
    assert.equal(map.terrain[idx], ".");
  }
});

test("a cone opens out from the caster and does not include their own tile", () => {
  const tiles = templateTiles(map, {
    shape: "cone",
    origin: { x: 4, y: 3 },
    target: { x: 8, y: 3 },
    sizeFeet: 15,
  });
  const spots = tiles.map(at);
  assert.ok(!spots.some((spot) => spot.x === 4 && spot.y === 3), "the caster is in their own cone");
  // One tile wide at range 1, three wide at 2 and 3.
  assert.deepEqual(
    spots.filter((spot) => spot.x === 5).map((spot) => spot.y),
    [3],
  );
  assert.equal(spots.filter((spot) => spot.x === 6).length, 3);
  assert.equal(spots.filter((spot) => spot.x === 7).length, 3);
});

test("a cone aimed diagonally points diagonally", () => {
  const tiles = templateTiles(map, {
    shape: "cone",
    origin: { x: 2, y: 2 },
    target: { x: 5, y: 5 },
    sizeFeet: 15,
  }).map(at);
  assert.ok(tiles.some((spot) => spot.x === 3 && spot.y === 3));
  // Straight ahead on the axis only, at range 1.
  assert.ok(!tiles.some((spot) => spot.x === 3 && spot.y === 2));
  assert.ok(tiles.every((spot) => spot.x >= 2 && spot.y >= 2));
});

test("a line runs the way it was aimed and stops at the wall", () => {
  const tiles = templateTiles(map, {
    shape: "line",
    origin: { x: 4, y: 3 },
    target: { x: 8, y: 3 },
    sizeFeet: 30,
  }).map(at);
  assert.deepEqual(tiles, [
    { x: 5, y: 3 },
    { x: 6, y: 3 },
    { x: 7, y: 3 },
  ]);
});

test("a cube grows away from the face the origin sits on", () => {
  const tiles = templateTiles(map, {
    shape: "cube",
    origin: { x: 3, y: 2 },
    target: { x: 6, y: 5 },
    sizeFeet: 10,
  }).map(at);
  assert.equal(tiles.length, 4);
  assert.ok(tiles.every((spot) => spot.x >= 3 && spot.y >= 2 && spot.x <= 4 && spot.y <= 3));
});

test("nothing is caught through a wall", () => {
  const walled = room([
    [5, 1],
    [5, 2],
    [5, 3],
    [5, 4],
    [5, 5],
  ]);
  const tiles = templateTiles(walled, {
    shape: "sphere",
    origin: { x: 3, y: 3 },
    target: { x: 3, y: 3 },
    sizeFeet: 20,
  }).map(at);
  assert.ok(tiles.length > 0);
  assert.ok(!tiles.some((spot) => spot.x > 5), "the burst reached past a solid partition");
  assert.ok(!tiles.some((spot) => spot.x === 5), "a wall tile was counted as covered");
});

test("an origin off the map covers nothing", () => {
  assert.deepEqual(
    templateTiles(map, {
      shape: "sphere",
      origin: { x: 40, y: 40 },
      target: { x: 4, y: 3 },
      sizeFeet: 20,
    }),
    [],
  );
});

test("an absurd size is clamped rather than refused", () => {
  const tiles = templateTiles(map, {
    shape: "sphere",
    origin: { x: 4, y: 3 },
    target: { x: 4, y: 3 },
    sizeFeet: MAX_TEMPLATE_FEET * 10,
  });
  // The whole floor of the room, and not one tile more.
  assert.equal(tiles.length, (WIDTH - 2) * (HEIGHT - 2));
});

test("a template with no direction still resolves", () => {
  const tiles = templateTiles(map, {
    shape: "cone",
    origin: { x: 4, y: 3 },
    target: { x: 4, y: 3 },
    sizeFeet: 10,
  });
  assert.ok(tiles.length > 0);
});

test("only the tokens standing in it are caught", () => {
  const tiles = templateTiles(map, {
    shape: "sphere",
    origin: { x: 4, y: 3 },
    target: { x: 4, y: 3 },
    sizeFeet: 5,
  });
  const caught = tokensInTemplate(WIDTH, tiles, [
    { name: "in", x: 4, y: 3 },
    { name: "edge", x: 5, y: 4 },
    { name: "out", x: 1, y: 1 },
  ]);
  assert.deepEqual(
    caught.map((token) => token.name),
    ["in", "edge"],
  );
});

test("a template describes itself in one line", () => {
  assert.equal(
    describeTemplate({ shape: "cone", origin: { x: 0, y: 0 }, target: { x: 1, y: 0 }, sizeFeet: 15 }, 6),
    "Cone, 15 ft length, 6 tiles",
  );
  assert.match(
    describeTemplate({ shape: "line", origin: { x: 0, y: 0 }, target: { x: 1, y: 0 }, sizeFeet: 5 }, 1),
    /1 tile$/,
  );
});

console.log(`map-template: ${passed} tests passed`);
