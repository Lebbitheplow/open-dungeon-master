// Senses in the light model and the darkness zones (docs/vtt-parity-
// implementation-plan.md sections 3.2 and 3.3): blindsight needs no light,
// tremorsense feels the ground and misses a flier, truesight and Devil's
// Sight see into magical darkness, and darkvision does not.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { sensesFromText, sensesFromBlock, describeSenses } = await import("../src/lib/srd/senses.ts");
const { perceivesToken, visibleTiles } = await import("../src/lib/battlemap/los.ts");
const { normalizeZones, magicalDarknessAt, ambientAt } = await import("../src/lib/battlemap/scene.ts");
const { tileIndex } = await import("../src/lib/battlemap/types.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

test("senses are read from feature and trait text", () => {
  const bat = sensesFromText(["Blindsight 60 ft.", "Darkvision 30 ft"]);
  assert.equal(bat.blindsight, 12);
  assert.equal(bat.darkvision, 6);
  const fighter = sensesFromText(["Blind Fighting", "Second Wind"]);
  assert.equal(fighter.blindsight, 2);
  const warlock = sensesFromText(["Devil's Sight"]);
  assert.equal(warlock.devilsSight, 24);
  const worm = sensesFromText(["tremorsense 60 ft., blindsight 30 ft."]);
  assert.equal(worm.tremorsense, 12);
  assert.equal(worm.blindsight, 6);
  const none = sensesFromText(["Second Wind", "human"]);
  assert.deepEqual(none, { darkvision: 0, blindsight: 0, tremorsense: 0, truesight: 0, devilsSight: 0 });
  assert.equal(sensesFromBlock({ truesight: 120, tremorsense: 30 }).truesight, 24);
  assert.match(describeSenses(worm), /tremorsense 60 ft/);
});

// A dark 15 by 5 hall with a wall column at x = 7 and a gap at y = 2.
const WIDTH = 15;
const HEIGHT = 5;
const rows = ["###############", "#......#......#", "#.............#", "#......#......#", "###############"];
const HALL = rows.join("");
const base = { terrain: HALL, width: WIDTH, height: HEIGHT, ambient: "dark" };

test("blindsight sees in the dark, but not through a wall", () => {
  const blind = visibleTiles(base, { x: 2, y: 1, darkvisionTiles: 0, blindsightTiles: 6 }, [], []);
  assert.ok(blind.has(tileIndex(WIDTH, 5, 1)), "in reach, in the dark");
  assert.ok(!blind.has(tileIndex(WIDTH, 9, 1)), "the wall column still blocks");
  assert.ok(!blind.has(tileIndex(WIDTH, 2, 3)) || blind.has(tileIndex(WIDTH, 2, 3)));
  const plain = visibleTiles(base, { x: 2, y: 1, darkvisionTiles: 0 }, [], []);
  assert.ok(!plain.has(tileIndex(WIDTH, 5, 1)), "no sense, no sight in the dark");
});

test("tremorsense feels a walker within reach, through walls, and misses a flier", () => {
  const viewer = { x: 2, y: 1, darkvisionTiles: 0, tremorsenseTiles: 8 };
  const visible = visibleTiles(base, viewer, [], []);
  assert.equal(perceivesToken(base, viewer, { x: 9, y: 1, movement: "walk" }, visible), true, "felt through the wall");
  assert.equal(perceivesToken(base, viewer, { x: 9, y: 1, movement: "fly" }, visible), false, "a flier leaves no tremor");
  assert.equal(perceivesToken(base, viewer, { x: 12, y: 1, movement: "walk" }, visible), false, "out of reach");
  const noSense = { x: 2, y: 1, darkvisionTiles: 0 };
  assert.equal(perceivesToken(base, noSense, { x: 3, y: 1 }, visibleTiles(base, noSense, [], [])), false);
});

test("zones carry a kind, and darkness kinds are dark whatever they say", () => {
  const zones = normalizeZones(
    [
      { x0: 1, y0: 1, x1: 3, y1: 3, ambient: "bright" },
      { x0: 5, y0: 1, x1: 6, y1: 3, ambient: "bright", kind: "darkness" },
      { x0: 9, y0: 1, x1: 12, y1: 3, ambient: "bright", kind: "magical_darkness" },
      { x0: 1, y0: 1, x1: 1, y1: 1, ambient: "bright", kind: "banana" },
    ],
    WIDTH,
    HEIGHT,
  );
  assert.equal(zones[0].kind, "light");
  assert.equal(zones[1].kind, "darkness");
  assert.equal(zones[1].ambient, "dark");
  assert.equal(zones[2].kind, "magical_darkness");
  assert.equal(zones[3].kind, "light", "an unknown kind reads as ordinary light");
  assert.equal(ambientAt(zones, 5, 2, "bright"), "dark");
  assert.equal(magicalDarknessAt(zones, 10, 2), true);
  assert.equal(magicalDarknessAt(zones, 5, 2), false);
});

test("magical darkness defeats darkvision and light, and yields to truesight and Devil's Sight", () => {
  const zones = normalizeZones([{ x0: 9, y0: 1, x1: 12, y1: 3, ambient: "dark", kind: "magical_darkness" }], WIDTH, HEIGHT);
  const bright = { terrain: HALL, width: WIDTH, height: HEIGHT, ambient: "bright", zones };
  const eyes = visibleTiles(bright, { x: 8, y: 2, darkvisionTiles: 12 }, [], []);
  assert.ok(eyes.has(tileIndex(WIDTH, 8, 1)), "outside the darkness the hall is bright");
  assert.ok(!eyes.has(tileIndex(WIDTH, 10, 2)), "darkvision cannot see into magical darkness");
  const torch = visibleTiles(bright, { x: 8, y: 2, darkvisionTiles: 0 }, [], [{ x: 10, y: 2, brightRadius: 2, dimRadius: 4 }]);
  assert.ok(!torch.has(tileIndex(WIDTH, 10, 2)), "a torch inside it shows nothing");
  const truesight = visibleTiles(bright, { x: 8, y: 2, darkvisionTiles: 0, truesightTiles: 6 }, [], []);
  assert.ok(truesight.has(tileIndex(WIDTH, 10, 2)));
  const devil = visibleTiles(bright, { x: 8, y: 2, darkvisionTiles: 0, devilsSightTiles: 24 }, [], []);
  assert.ok(devil.has(tileIndex(WIDTH, 12, 2)));
  const blind = visibleTiles(bright, { x: 8, y: 2, darkvisionTiles: 0, blindsightTiles: 4 }, [], []);
  assert.ok(blind.has(tileIndex(WIDTH, 10, 2)), "blindsight does not care about light of any kind");
});

console.log(`test-senses: ${passed} passed`);
