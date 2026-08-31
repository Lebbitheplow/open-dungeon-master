// Converting a Universal VTT export into a terrain string.
//
// The whole reason this conversion is edge-based rather than tile-based is
// the corridor test below: a UVTT wall is a line between two tiles, and the
// naive reading rounds the walls on both sides of a one-tile corridor into
// the corridor itself and deletes it. Every other assertion here is a
// consequence of getting that right.
// See docs/workshop-plan.md phase 4.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { UVTT_SIZE, backdropDataUrl, nameFromFilename, parseUvtt } = await import(
  "../src/lib/battlemap/uvtt.ts"
);
const { TERRAIN, tileAt } = await import("../src/lib/battlemap/types.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

const point = (x, y) => ({ x, y });
const file = (size, walls, extra = {}) => ({
  resolution: { map_size: point(size.x, size.y), pixels_per_grid: 100 },
  line_of_sight: walls,
  ...extra,
});

// A sealed room spanning tiles (2,2) to (5,5): its walls are the lines at
// x=2, x=6, y=2 and y=6, which is how the format stores a drawn room.
const ROOM_WALLS = [[point(2, 2), point(6, 2), point(6, 6), point(2, 6), point(2, 2)]];
const room = (extra) => parseUvtt(file({ x: 10, y: 8 }, ROOM_WALLS, extra));

// ---- the room keeps the size it was drawn ----

test("a drawn room becomes exactly the tiles it enclosed", () => {
  const result = room();
  assert.ok(!result.error, result.error);
  const { terrain, width } = result.map;
  for (let y = 2; y <= 5; y += 1) {
    for (let x = 2; x <= 5; x += 1) {
      assert.equal(tileAt(terrain, width, x, y), TERRAIN.floor, `${x},${y} should be open`);
    }
  }
});

test("everything outside the room is solid rock", () => {
  const { map } = room();
  assert.equal(tileAt(map.terrain, map.width, 1, 3), TERRAIN.wall);
  assert.equal(tileAt(map.terrain, map.width, 6, 3), TERRAIN.wall);
  assert.equal(tileAt(map.terrain, map.width, 3, 1), TERRAIN.wall);
  assert.equal(tileAt(map.terrain, map.width, 3, 6), TERRAIN.wall);
});

test("the room is not shifted a tile by the conversion", () => {
  // The failure mode of reading a wall LINE as a wall TILE: the room comes
  // out one narrower and one to the side of where it was drawn.
  const { map } = room();
  const open = [...map.terrain].filter((tile) => tile !== TERRAIN.wall).length;
  assert.equal(open, 16, `a 4x4 room should be 16 tiles, got ${open}`);
});

test("the map is the size the header said", () => {
  const { map } = room();
  assert.equal(map.width, 10);
  assert.equal(map.height, 8);
  assert.equal(map.terrain.length, 80);
});

// ---- the corridor, which is why this is edge-based ----

const CORRIDOR = [
  // The room, with a gap in its east wall where the corridor leaves.
  [point(2, 2), point(6, 2)],
  [point(6, 2), point(6, 3)],
  [point(6, 4), point(6, 6)],
  [point(6, 6), point(2, 6)],
  [point(2, 6), point(2, 2)],
  // A corridor exactly one tile tall, running east from the room.
  [point(6, 3), point(9, 3)],
  [point(6, 4), point(9, 4)],
  [point(9, 3), point(9, 4)],
];

test("a corridor one tile wide survives the conversion", () => {
  const result = parseUvtt(file({ x: 12, y: 8 }, CORRIDOR));
  assert.ok(!result.error, result.error);
  const { terrain, width } = result.map;
  for (let x = 6; x <= 8; x += 1) {
    assert.equal(
      tileAt(terrain, width, x, 3),
      TERRAIN.floor,
      `the corridor closed up at ${x},3`,
    );
  }
});

test("the corridor is walled on both sides, not widened", () => {
  const { map } = parseUvtt(file({ x: 12, y: 8 }, CORRIDOR));
  assert.equal(tileAt(map.terrain, map.width, 7, 2), TERRAIN.wall);
  assert.equal(tileAt(map.terrain, map.width, 7, 4), TERRAIN.wall);
});

test("the corridor actually joins the room", () => {
  const { map } = parseUvtt(file({ x: 12, y: 8 }, CORRIDOR));
  assert.equal(tileAt(map.terrain, map.width, 5, 3), TERRAIN.floor, "the room side is sealed");
  assert.equal(tileAt(map.terrain, map.width, 6, 3), TERRAIN.floor, "the mouth is sealed");
});

// ---- doors ----

// Two rooms with a single tile of rock between them at x=5.
const TWO_ROOMS = [
  [point(2, 2), point(5, 2), point(5, 6), point(2, 6), point(2, 2)],
  [point(6, 2), point(9, 2), point(9, 6), point(6, 6), point(6, 2)],
];

test("a portal between two open tiles becomes a door", () => {
  const result = parseUvtt(
    file({ x: 11, y: 8 }, TWO_ROOMS, { portals: [{ position: point(5.5, 3.5) }] }),
  );
  assert.ok(!result.error, result.error);
  assert.equal(tileAt(result.map.terrain, result.map.width, 5, 3), TERRAIN.door);
  assert.equal(tileAt(result.map.terrain, result.map.width, 4, 3), TERRAIN.floor);
  assert.equal(tileAt(result.map.terrain, result.map.width, 6, 3), TERRAIN.floor);
});

test("a portal buried in rock is left out and reported, not drawn", () => {
  const result = parseUvtt(
    file({ x: 11, y: 8 }, TWO_ROOMS, { portals: [{ position: point(0.5, 0.5) }] }),
  );
  assert.equal(tileAt(result.map.terrain, result.map.width, 0, 0), TERRAIN.wall);
  assert.ok(
    result.map.notes.some((note) => /doors did not land/i.test(note)),
    "the import said nothing about the door it dropped",
  );
});

test("a map with no doors says nothing about doors", () => {
  const { map } = room();
  assert.ok(!map.notes.some((note) => /doors/i.test(note)));
});

// ---- what the DM is told ----

test("the import always says the walls are the ones in the file", () => {
  // The backdrop is a picture; the walls that stop a rogue are these. That
  // is the one thing a DM has to know before playing on an import.
  const { map } = room();
  assert.ok(map.notes.length);
  assert.match(map.notes[0], /walls/i);
});

// ---- lights ----

test("lights come across and the map starts dark", () => {
  const result = room({ lights: [{ position: point(3.5, 3.5), range: 4 }] });
  assert.equal(result.map.lights.length, 1);
  assert.deepEqual(result.map.lights[0], { x: 3, y: 3, brightRadius: 4, dimRadius: 8 });
  assert.equal(result.map.ambient, "dark");
});

test("a map with no lights starts lit, because nothing would ever be seen", () => {
  assert.equal(room().map.ambient, "bright");
});

test("a light outside the map is dropped rather than clamped onto it", () => {
  const result = room({ lights: [{ position: point(99, 99), range: 4 }] });
  assert.equal(result.map.lights.length, 0);
});

// ---- the origin ----

test("a map whose origin is not zero is shifted into place", () => {
  const shifted = ROOM_WALLS.map((line) => line.map((p) => point(p.x + 10, p.y + 20)));
  const result = parseUvtt({
    resolution: { map_origin: point(10, 20), map_size: point(10, 8) },
    line_of_sight: shifted,
  });
  assert.ok(!result.error, result.error);
  assert.equal(tileAt(result.map.terrain, result.map.width, 3, 3), TERRAIN.floor);
});

// ---- the border ----

test("the border is walled even when a room runs into it", () => {
  // Movement and the fog projection both assume a token cannot walk off the
  // grid, the same promise the generator makes.
  const edgeRoom = [[point(0, 0), point(6, 0), point(6, 6), point(0, 6), point(0, 0)]];
  const result = parseUvtt(file({ x: 10, y: 8 }, edgeRoom));
  assert.ok(!result.error, result.error);
  for (let x = 0; x < result.map.width; x += 1) {
    assert.equal(tileAt(result.map.terrain, result.map.width, x, 0), TERRAIN.wall);
  }
  assert.equal(tileAt(result.map.terrain, result.map.width, 0, 3), TERRAIN.wall);
});

// ---- refusals ----

test("a file with no map size is refused", () => {
  assert.match(parseUvtt({}).error, /not a Universal VTT/i);
});

test("a file with no wall geometry is refused", () => {
  assert.match(parseUvtt(file({ x: 10, y: 8 }, [])).error, /nothing to stop anyone/i);
});

test("walls that enclose nothing are refused with what to do instead", () => {
  // A drawing whose walls do not close would flood from outside to every
  // tile and hand back a solid slab, which is worse than a refusal.
  const stray = [[point(1, 1), point(3, 1)]];
  const result = parseUvtt(file({ x: 10, y: 8 }, stray));
  assert.match(result.error, /do not enclose/i);
  assert.match(result.error, /paint the walls/i);
});

test("a map larger than this engine runs is refused by size, not truncated", () => {
  const huge = parseUvtt(file({ x: UVTT_SIZE.max + 1, y: 10 }, ROOM_WALLS));
  assert.match(huge.error, /tiles a side/i);
});

test("a map too small to stand on is refused", () => {
  assert.ok(parseUvtt(file({ x: 2, y: 2 }, ROOM_WALLS)).error);
});

// ---- diagonal walls ----

test("a diagonal wall becomes a staircase rather than a crash", () => {
  const diagonal = [
    [point(2, 2), point(6, 2), point(6, 6), point(2, 6), point(2, 2)],
    [point(2, 2), point(6, 6)],
  ];
  const result = parseUvtt(file({ x: 10, y: 8 }, diagonal));
  assert.ok(!result.error, result.error);
  assert.equal(result.map.terrain.length, 80);
});

// ---- the picture ----

test("raw base64 becomes a PNG data url the upload route accepts", () => {
  const art = backdropDataUrl({ image: "A".repeat(64) });
  assert.equal(art.type, "image/png");
  assert.match(art.dataUrl, /^data:image\/png;base64,/);
});

test("a file that already carries a prefix is believed", () => {
  const art = backdropDataUrl({ image: `data:image/webp;base64,${"A".repeat(64)}` });
  assert.equal(art.type, "image/webp");
});

test("a file with no picture is not an error, it is just walls", () => {
  assert.equal(backdropDataUrl({}), null);
  assert.equal(backdropDataUrl({ image: "" }), null);
});

test("the filename is the only name a UVTT export carries", () => {
  assert.equal(nameFromFilename("the_flooded_crypt.dd2vtt"), "the flooded crypt");
  assert.equal(nameFromFilename("Keep-Level-2.uvtt"), "Keep Level 2");
  assert.equal(nameFromFilename(".dd2vtt"), "Imported map");
});

console.log(`map uvtt: ${passed} assertions passed.`);
