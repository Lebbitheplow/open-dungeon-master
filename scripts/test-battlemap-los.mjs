// Field of view and lighting: wall occlusion, ambient light levels,
// carried lights, and darkvision.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { computeFov, visibleTiles, darkvisionTilesFromText } = await import(
  "../src/lib/battlemap/los.ts"
);
const { tileIndex } = await import("../src/lib/battlemap/types.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

// 9x5 room: open except a wall segment splitting the middle column.
// ####..... etc. Build from rows for readability.
function makeMap(rows, ambient = "bright") {
  const width = rows[0].length;
  return { terrain: rows.join(""), width, height: rows.length, ambient };
}

const room = makeMap([
  "#########",
  "#.......#",
  "#...#...#",
  "#.......#",
  "#########",
]);

test("open line of sight reaches across the room", () => {
  const fov = computeFov(room.terrain, room.width, room.height, 1, 1, 20);
  assert.ok(fov.has(tileIndex(room.width, 7, 1)));
});

test("walls block sight and are themselves visible", () => {
  const fov = computeFov(room.terrain, room.width, room.height, 1, 2, 20);
  assert.ok(fov.has(tileIndex(room.width, 4, 2)), "the blocking wall is visible");
  assert.ok(!fov.has(tileIndex(room.width, 7, 2)), "tile behind the wall is hidden");
});

test("bright ambient means vision = line of sight", () => {
  const visible = visibleTiles(room, { x: 1, y: 1, darkvisionTiles: 0 }, [], []);
  assert.ok(visible.has(tileIndex(room.width, 7, 1)));
});

const darkRoom = makeMap(
  [
    "#########",
    "#.......#",
    "#.......#",
    "#.......#",
    "#########",
  ],
  "dark",
);

test("dark with no light and no darkvision sees only own tile", () => {
  const visible = visibleTiles(darkRoom, { x: 1, y: 1, darkvisionTiles: 0 }, [], []);
  assert.deepEqual([...visible], [tileIndex(darkRoom.width, 1, 1)]);
});

test("darkvision carves a radius in darkness", () => {
  const visible = visibleTiles(darkRoom, { x: 1, y: 1, darkvisionTiles: 3 }, [], []);
  assert.ok(visible.has(tileIndex(darkRoom.width, 4, 1)));
  assert.ok(!visible.has(tileIndex(darkRoom.width, 7, 1)));
});

test("a carried torch lights tiles for everyone with line of sight", () => {
  const torchbearer = {
    id: "t1", kind: "pc", refId: "c1", name: "Kara",
    x: 6, y: 2, movedThisRound: 0, lightRadius: 2,
  };
  const visible = visibleTiles(
    darkRoom,
    { x: 1, y: 2, darkvisionTiles: 0 },
    [torchbearer],
    [],
  );
  assert.ok(visible.has(tileIndex(darkRoom.width, 6, 2)), "lit tile visible from afar");
  assert.ok(!visible.has(tileIndex(darkRoom.width, 1, 1)), "unlit near tile still dark");
});

test("static lights do not glow through walls", () => {
  const walled = makeMap(
    [
      "#########",
      "#...#...#",
      "#...#...#",
      "#...#...#",
      "#########",
    ],
    "dark",
  );
  const light = { x: 6, y: 2, brightRadius: 4, dimRadius: 8 };
  const visible = visibleTiles(walled, { x: 6, y: 1, darkvisionTiles: 0 }, [], [light]);
  assert.ok(visible.has(tileIndex(walled.width, 7, 1)), "same side lit");
  assert.ok(!visible.has(tileIndex(walled.width, 2, 1)), "far side of wall unlit and unseen");
});

test("dim ambient allows short unlit perception", () => {
  const dim = makeMap(
    [
      "#########",
      "#.......#",
      "#.......#",
      "#.......#",
      "#########",
    ],
    "dim",
  );
  const visible = visibleTiles(dim, { x: 1, y: 1, darkvisionTiles: 0 }, [], []);
  assert.ok(visible.has(tileIndex(dim.width, 4, 1)), "within dim self radius");
});

test("darkvision text parsing", () => {
  assert.equal(darkvisionTilesFromText(["Darkvision 60 ft"]), 12);
  assert.equal(darkvisionTilesFromText(["Keen Senses", "darkvision 120 feet"]), 24);
  assert.equal(darkvisionTilesFromText(["Brave", "Lucky"]), 0);
  assert.equal(darkvisionTilesFromText(["Darkvision"]), 12, "bare feature name defaults to 60 ft");
});

console.log(`test-battlemap-los: ${passed} tests passed.`);
