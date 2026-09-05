// The scene layer: labels, furniture, door states, patches of light, and
// the one thing the engine learns from any of it, which is that a locked
// or secret door is a wall until it is not. See docs/workshop-parity-audit.md
// phase 13.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const {
  SCENE_LIMITS,
  ambientAt,
  describeScene,
  doorKey,
  effectiveTerrain,
  labelsFor,
  nextDoorState,
  normalizeDoors,
  normalizeLabels,
  normalizeProps,
  normalizeZones,
  toggleDoor,
} = await import("../src/lib/battlemap/scene.ts");
const { visibleTiles } = await import("../src/lib/battlemap/los.ts");
const { reachableTiles } = await import("../src/lib/battlemap/movement.ts");
const { tileIndex } = await import("../src/lib/battlemap/types.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

// Two rooms joined by a door at (5,3), inside a walled 12x7 border.
const WIDTH = 12;
const HEIGHT = 7;
function twoRooms() {
  const tiles = [];
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const border = x === 0 || y === 0 || x === WIDTH - 1 || y === HEIGHT - 1;
      tiles.push(border || x === 5 ? "#" : ".");
    }
  }
  tiles[tileIndex(WIDTH, 5, 3)] = "+";
  return tiles.join("");
}
const at = (terrain, x, y) => terrain[tileIndex(WIDTH, x, y)];

test("labels are kept only where they say something, one per tile", () => {
  const labels = normalizeLabels(
    [
      { x: 2, y: 2, text: "Altar", dmOnly: true },
      { x: 2, y: 2, text: "Twice" },
      { x: 40, y: 2, text: "Off" },
      { x: 3, y: 3, text: "   " },
      { x: 3, y: 3, text: "Pit" },
      "nonsense",
    ],
    WIDTH,
    HEIGHT,
  );
  assert.deepEqual(labels, [
    { x: 2, y: 2, text: "Altar", dmOnly: true },
    { x: 3, y: 3, text: "Pit", dmOnly: false },
  ]);
  const many = normalizeLabels(
    Array.from({ length: 100 }, (_, i) => ({ x: 1 + (i % 10), y: 1 + Math.floor(i / 10) % 5, text: `L${i}` })),
    WIDTH,
    HEIGHT,
  );
  assert.ok(many.length <= SCENE_LIMITS.labels);
});

test("a player sees table labels only where they have been; the DM sees all", () => {
  const labels = [
    { x: 2, y: 2, text: "Altar", dmOnly: true },
    { x: 3, y: 3, text: "Pit", dmOnly: false },
    { x: 8, y: 3, text: "Well", dmOnly: false },
  ];
  const explored = new Set([tileIndex(WIDTH, 3, 3)]);
  assert.deepEqual(labelsFor(labels, WIDTH, { dm: false, explored }).map((l) => l.text), ["Pit"]);
  assert.equal(labelsFor(labels, WIDTH, { dm: true }).length, 3);
});

test("furniture cannot stand in rock", () => {
  const props = normalizeProps(
    [
      { x: 2, y: 2, name: "Barrel" },
      { x: 0, y: 0, name: "In the wall" },
      { x: 3, y: 3, name: "Shopkeeper", kind: "npc" },
      { x: 3, y: 3, name: "Doubled" },
    ],
    twoRooms(),
    WIDTH,
    HEIGHT,
  );
  assert.deepEqual(props, [
    { x: 2, y: 2, name: "Barrel", kind: "prop" },
    { x: 3, y: 3, name: "Shopkeeper", kind: "npc" },
  ]);
});

test("a door state only means something on a door tile", () => {
  const doors = normalizeDoors({ "5,3": "locked", "2,2": "secret", "5,3x": "locked", "5,4": "open" }, twoRooms(), WIDTH, HEIGHT);
  assert.deepEqual(doors, { "5,3": "locked" });
});

test("a door taps round open, locked, secret, open", () => {
  assert.equal(nextDoorState(undefined), "locked");
  assert.equal(nextDoorState("locked"), "secret");
  assert.equal(nextDoorState("secret"), undefined);
  const terrain = twoRooms();
  const first = toggleDoor({}, { x: 5, y: 3 }, terrain, WIDTH, HEIGHT);
  assert.equal(first.state, "locked");
  const second = toggleDoor(first.doors, { x: 5, y: 3 }, terrain, WIDTH, HEIGHT);
  assert.equal(second.state, "secret");
  const third = toggleDoor(second.doors, { x: 5, y: 3 }, terrain, WIDTH, HEIGHT);
  assert.equal(third.state, null);
  assert.deepEqual(third.doors, {});
  const refused = toggleDoor({}, { x: 2, y: 2 }, terrain, WIDTH, HEIGHT);
  assert.ok("error" in refused);
  assert.ok(refused.error.includes("door"));
});

test("a locked door is a wall to the engine and a door to the drawing", () => {
  const drawn = twoRooms();
  const locked = effectiveTerrain(drawn, WIDTH, { [doorKey(5, 3)]: "locked" });
  assert.equal(at(drawn, 5, 3), "+");
  assert.equal(at(locked, 5, 3), "#");
  assert.equal(effectiveTerrain(drawn, WIDTH, {}), drawn, "no states, no change");
  // Nobody can walk from the west room into the east one.
  const from = { x: 2, y: 3 };
  const open = reachableTiles(drawn, WIDTH, HEIGHT, new Set(), from, 40);
  const shut = reachableTiles(locked, WIDTH, HEIGHT, new Set(), from, 40);
  assert.ok(open.has(tileIndex(WIDTH, 8, 3)), "the doorway should let the party through");
  assert.ok(!shut.has(tileIndex(WIDTH, 8, 3)), "the locked door should not");
  // And nobody can see through it either.
  const seen = visibleTiles(
    { terrain: locked, width: WIDTH, height: HEIGHT, ambient: "bright" },
    { x: 2, y: 3, darkvisionTiles: 0 },
    [],
    [],
  );
  assert.ok(!seen.has(tileIndex(WIDTH, 8, 3)));
});

test("a patch of dark in a bright hall hides what stands in it, unless lit", () => {
  const terrain = twoRooms();
  const zones = normalizeZones([{ x0: 9, y0: 4, x1: 7, y1: 2, ambient: "dark" }, { x0: 1, y0: 1, x1: 1, y1: 1, ambient: "rainbow" }], WIDTH, HEIGHT);
  assert.equal(zones.length, 1);
  assert.deepEqual(zones[0], { x0: 7, y0: 2, x1: 9, y1: 4, ambient: "dark" });
  assert.equal(ambientAt(zones, 8, 3, "bright"), "dark");
  assert.equal(ambientAt(zones, 2, 3, "bright"), "bright");
  const viewer = { x: 7, y: 1, darkvisionTiles: 0 };
  const map = { terrain, width: WIDTH, height: HEIGHT, ambient: "bright", zones };
  const dark = visibleTiles(map, viewer, [], []);
  assert.ok(dark.has(tileIndex(WIDTH, 7, 1)), "the viewer's own bright tile");
  assert.ok(!dark.has(tileIndex(WIDTH, 8, 3)), "the dark patch is not seen");
  const lit = visibleTiles(map, viewer, [], [{ x: 8, y: 3, brightRadius: 1, dimRadius: 2 }]);
  assert.ok(lit.has(tileIndex(WIDTH, 8, 3)), "a torch in the patch shows it");
  // A lit patch in a dark crypt works the other way round.
  const shrine = visibleTiles(
    { terrain, width: WIDTH, height: HEIGHT, ambient: "dark", zones: [{ x0: 8, y0: 3, x1: 8, y1: 3, ambient: "bright" }] },
    viewer,
    [],
    [],
  );
  assert.ok(shrine.has(tileIndex(WIDTH, 8, 3)));
  assert.ok(!shrine.has(tileIndex(WIDTH, 9, 4)));
});

test("the DM's prompt is told which doors are shut and what the rooms are called", () => {
  const lines = describeScene({
    doors: { "5,3": "locked", "9,1": "secret" },
    labels: [{ x: 2, y: 2, text: "Altar", dmOnly: true }],
  });
  assert.equal(lines.length, 3);
  assert.ok(lines[0].includes("(5,3)"));
  assert.ok(lines[1].includes("Secret"));
  assert.ok(lines[2].includes("Altar [DM only]"));
  assert.deepEqual(describeScene({ doors: {}, labels: [] }), []);
});

console.log(`test-map-scene: ${passed} passed`);
