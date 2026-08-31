// Stamping rooms onto the battle map. A stamp is a shape that compiles into
// ordinary brush strokes, so the only thing worth asserting here is the
// geometry: paintTerrain already owns every rule about what a legal map is,
// and these tests run the compiled strokes through it to prove that is true.
// See docs/workshop-plan.md phase 4.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const {
  STAMPS,
  STAMP_CHARS,
  STAMP_EFFECTS,
  STAMP_LABELS,
  STAMP_SIZE,
  STAMP_WALLS,
  describeStamp,
  normalizeStamp,
  stampFootprint,
  stampStrokes,
} = await import("../src/lib/battlemap/stamp.ts");
const { MAX_STROKES, paintTerrain } = await import("../src/lib/battlemap/paint.ts");
const { TERRAIN, tileAt } = await import("../src/lib/battlemap/types.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

// A board big enough to stamp inside without every shape hitting the border
// paintTerrain refuses to touch.
const W = 20;
const H = 16;
const solid = TERRAIN.wall.repeat(W * H);
const at = (terrain, x, y) => tileAt(terrain, W, x, y);
const apply = (terrain, stamp) =>
  paintTerrain({ terrain, width: W, height: H, strokes: stampStrokes(stamp) });

// ---- the palette ----

test("every stamp has a label and an effect a person can read", () => {
  for (const kind of STAMPS) {
    assert.ok(STAMP_LABELS[kind], `${kind} has no label`);
    assert.ok(STAMP_EFFECTS[kind], `${kind} does not say what it does`);
    assert.equal(typeof STAMP_WALLS[kind], "boolean", `${kind} does not say if it walls itself`);
  }
});

test("no stamp can write a character the engine does not read", () => {
  const known = new Set(Object.values(TERRAIN));
  for (const char of STAMP_CHARS) {
    assert.ok(known.has(char), `${char} is not in the terrain alphabet`);
  }
  // The door is deliberately absent: it is a single tile, which is what the
  // brush is for, and a stamp that scattered doors would be guessing.
  assert.ok(!STAMP_CHARS.includes(TERRAIN.door));
});

test("there is no stairs stamp, because there is no stairs tile", () => {
  assert.ok(!STAMPS.includes("stairs"));
});

// ---- footprints ----

test("a stamp is centred on the tile that was clicked", () => {
  const box = stampFootprint({ kind: "room", x: 10, y: 8, width: 3, height: 3 });
  assert.deepEqual(box, { x0: 9, y0: 7, x1: 11, y1: 9 });
});

test("an even-sided stamp leans one tile up and left of the click", () => {
  // Deterministic rather than rounded either way, so the same click always
  // lands the same room.
  const box = stampFootprint({ kind: "room", x: 10, y: 8, width: 4, height: 2 });
  assert.deepEqual(box, { x0: 9, y0: 8, x1: 12, y1: 9 });
});

test("a size beyond the cap is clamped, not refused", () => {
  const box = stampFootprint({ kind: "hall", x: 10, y: 8, width: 999, height: 1 });
  assert.equal(box.x1 - box.x0 + 1, STAMP_SIZE.max);
});

test("the description is in feet, the unit the DM speaks in", () => {
  assert.match(describeStamp({ kind: "room", x: 5, y: 5, width: 4, height: 2 }), /20 by 10 feet/);
});

// ---- what each stamp draws ----

test("a room is floor with a wall all the way around it", () => {
  const result = apply(solid, { kind: "room", x: 10, y: 8, width: 3, height: 3 });
  assert.ok(!result.error, result.error);
  for (let y = 7; y <= 9; y += 1) {
    for (let x = 9; x <= 11; x += 1) {
      assert.equal(at(result.terrain, x, y), TERRAIN.floor, `${x},${y} is not floor`);
    }
  }
  assert.equal(at(result.terrain, 8, 8), TERRAIN.wall, "the west wall is missing");
  assert.equal(at(result.terrain, 12, 8), TERRAIN.wall, "the east wall is missing");
  assert.equal(at(result.terrain, 8, 6), TERRAIN.wall, "the corner is missing");
});

test("a corridor draws no walls, so it opens into what it meets", () => {
  const room = apply(solid, { kind: "room", x: 6, y: 8, width: 3, height: 3 });
  const joined = apply(room.terrain, { kind: "hall", x: 11, y: 8, width: 9, height: 1 });
  assert.ok(!joined.error, joined.error);
  // The corridor runs from inside the room out to the east.
  for (let x = 7; x <= 15; x += 1) {
    assert.equal(at(joined.terrain, x, 8), TERRAIN.floor, `${x},8 was not carved`);
  }
});

test("a cavern is rounded, so its corners stay rock", () => {
  const result = apply(solid, { kind: "cavern", x: 10, y: 8, width: 7, height: 7 });
  assert.ok(!result.error, result.error);
  assert.equal(at(result.terrain, 10, 8), TERRAIN.floor, "the middle is not open");
  assert.equal(at(result.terrain, 7, 5), TERRAIN.wall, "a cavern should not have square corners");
});

test("a pillared hall is floor with blocks standing in it", () => {
  const result = apply(solid, { kind: "pillars", x: 10, y: 8, width: 7, height: 5 });
  assert.ok(!result.error, result.error);
  assert.equal(at(result.terrain, 8, 7), TERRAIN.wall, "no pillar at the first post");
  assert.equal(at(result.terrain, 9, 7), TERRAIN.floor, "the gap between pillars is blocked");
  assert.equal(at(result.terrain, 10, 7), TERRAIN.wall, "no pillar at the second post");
});

test("a pillared hall too small for pillars is just a room", () => {
  const result = apply(solid, { kind: "pillars", x: 10, y: 8, width: 2, height: 2 });
  assert.ok(!result.error, result.error);
  assert.equal(at(result.terrain, 10, 8), TERRAIN.floor);
});

test("a pool is water and a rubble field is rough ground", () => {
  const floor = TERRAIN.floor.repeat(W * H);
  const pool = apply(floor, { kind: "pool", x: 10, y: 8, width: 5, height: 5 });
  assert.equal(at(pool.terrain, 10, 8), TERRAIN.water);
  const rubble = apply(floor, { kind: "rubble", x: 10, y: 8, width: 5, height: 5 });
  assert.equal(at(rubble.terrain, 10, 8), TERRAIN.difficult);
});

test("neither a pool nor rubble walls itself in", () => {
  const floor = TERRAIN.floor.repeat(W * H);
  const pool = apply(floor, { kind: "pool", x: 10, y: 8, width: 3, height: 3 });
  assert.equal(at(pool.terrain, 8, 8), TERRAIN.floor, "a pool grew a shoreline wall");
});

// ---- ordering and overlap ----

test("the wall is drawn before the floor, so a room is never swallowed", () => {
  const strokes = stampStrokes({ kind: "room", x: 10, y: 8, width: 3, height: 3 });
  const firstFloor = strokes.findIndex((stroke) => stroke.brush === "floor");
  const lastWall = strokes.map((stroke) => stroke.brush).lastIndexOf("wall");
  assert.ok(firstFloor > 0, "the room has no floor");
  assert.ok(lastWall < firstFloor, "a wall stroke lands after the floor and would seal the room");
});

test("a second room cuts into the first rather than being swallowed", () => {
  const first = apply(solid, { kind: "room", x: 8, y: 8, width: 5, height: 5 });
  const second = apply(first.terrain, { kind: "room", x: 12, y: 8, width: 5, height: 5 });
  assert.ok(!second.error, second.error);
  assert.equal(at(second.terrain, 12, 8), TERRAIN.floor, "the second room did not carve");
  // Where they meet, the newer room's wall stands: the DM stamped it last.
  assert.equal(at(second.terrain, 9, 8), TERRAIN.wall, "the newer room drew no dividing wall");
});

test("pillars are drawn after the floor, or they would be paved over", () => {
  const strokes = stampStrokes({ kind: "pillars", x: 10, y: 8, width: 5, height: 5 });
  const lastFloor = strokes.map((stroke) => stroke.brush).lastIndexOf("floor");
  const lastWall = strokes.map((stroke) => stroke.brush).lastIndexOf("wall");
  assert.ok(lastWall > lastFloor, "the pillars would be paved over by the floor");
});

// ---- the stroke budget ----

test("the largest stamp still fits inside one paint request", () => {
  const strokes = stampStrokes({
    kind: "room",
    x: 10,
    y: 8,
    width: STAMP_SIZE.max,
    height: STAMP_SIZE.max,
  });
  assert.ok(
    strokes.length <= MAX_STROKES,
    `the biggest room is ${strokes.length} strokes, over the ${MAX_STROKES} cap`,
  );
});

test("every stamp at its largest fits too", () => {
  for (const kind of STAMPS) {
    const strokes = stampStrokes({
      kind,
      x: 10,
      y: 8,
      width: STAMP_SIZE.max,
      height: STAMP_SIZE.max,
    });
    assert.ok(strokes.length <= MAX_STROKES, `${kind} overflows the stroke cap`);
  }
});

// ---- the rules paintTerrain owns, not this module ----

test("a stamp over the border is clipped by the painter, not by the stamp", () => {
  // stampStrokes happily emits tiles outside the board; paintTerrain is the
  // one that refuses to open the edge, and that division is deliberate.
  const strokes = stampStrokes({ kind: "hall", x: 0, y: 0, width: 5, height: 5 });
  assert.ok(strokes.some((stroke) => stroke.x < 0), "the stamp clipped itself");
  const result = paintTerrain({ terrain: solid, width: W, height: H, strokes });
  assert.ok(!result.error, result.error);
  assert.equal(at(result.terrain, 0, 0), TERRAIN.wall, "the border was opened");
});

test("a stamp cannot wall a combatant in, because paintTerrain checks", () => {
  const floor = TERRAIN.floor.repeat(W * H);
  const result = paintTerrain({
    terrain: floor,
    width: W,
    height: H,
    strokes: stampStrokes({ kind: "room", x: 10, y: 8, width: 3, height: 3 }),
    // Standing on the ring the room is about to draw.
    occupied: [{ x: 12, y: 8 }],
  });
  assert.ok(result.error, "a wall was painted over somebody");
});

// ---- taking a stamp off the wire ----

test("an unknown kind is refused", () => {
  assert.equal(normalizeStamp({ kind: "spiral-staircase", x: 1, y: 1 }), null);
});

test("a stamp with no coordinates is refused", () => {
  assert.equal(normalizeStamp({ kind: "room", x: Number.NaN, y: 1 }), null);
});

test("a missing size becomes a small room rather than nothing", () => {
  const stamp = normalizeStamp({ kind: "room", x: 4, y: 4 });
  assert.ok(stamp);
  assert.ok(stamp.width >= STAMP_SIZE.min && stamp.width <= STAMP_SIZE.max);
});

test("an absurd size is clamped on the way in", () => {
  const stamp = normalizeStamp({ kind: "room", x: 4, y: 4, width: 5000, height: -20 });
  assert.equal(stamp.width, STAMP_SIZE.max);
  assert.equal(stamp.height, STAMP_SIZE.min);
});

console.log(`map stamp: ${passed} assertions passed.`);
