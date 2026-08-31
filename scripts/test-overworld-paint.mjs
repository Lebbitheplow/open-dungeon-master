// Painting the region map by hand. The battle-map painter refuses a picture
// the pathfinder cannot run on; this one refuses a picture no settlement can
// stand in, because placeAnchor will not put a location on water or a peak.
// See docs/workshop-plan.md phase 4.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const {
  MAX_BRUSH_RADIUS,
  MAX_STROKES,
  OVERWORLD_BRUSHES,
  OVERWORLD_BRUSH_LABELS,
  isSettleable,
  paintOverworld,
  terrainMix,
} = await import("../src/lib/overworld/paint.ts");
const { generateOverworldTerrain, tileAt } = await import("../src/lib/overworld/logic.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

// A small hand-made field so every assertion can be reasoned about by eye.
const W = 8;
const H = 4;
const flat = (tile) => tile.repeat(W * H);
const grid = (rows) => rows.join("");
const at = (terrain, x, y) => tileAt(terrain, W, x, y);
const paint = (terrain, strokes, anchors) =>
  paintOverworld({ terrain, width: W, height: H, strokes, anchors });

// ---- the palette ----

test("every brush has a label a person can read", () => {
  for (const brush of OVERWORLD_BRUSHES) {
    assert.ok(OVERWORLD_BRUSH_LABELS[brush], `${brush} has no label`);
  }
});

test("water and mountains are the two nothing can settle on", () => {
  assert.equal(isSettleable("w"), false);
  assert.equal(isSettleable("m"), false);
  assert.equal(isSettleable("p"), true);
  assert.equal(isSettleable("f"), true);
  assert.equal(isSettleable("h"), true);
  assert.equal(isSettleable("s"), true);
});

// ---- painting ----

test("a single stroke paints exactly one tile", () => {
  const result = paint(flat("p"), [{ x: 3, y: 1, brush: "forest" }]);
  assert.ok(!result.error, result.error);
  assert.equal(result.changed, 1);
  assert.equal(at(result.terrain, 3, 1), "f");
  assert.equal(at(result.terrain, 4, 1), "p", "a neighbour was repainted");
});

test("a radius paints a filled circle, not a square", () => {
  const result = paint(flat("p"), [{ x: 3, y: 1, brush: "water", radius: 1 }]);
  assert.ok(!result.error, result.error);
  // The four orthogonal neighbours and the centre, plus the diagonals that
  // fall inside the radius test.
  assert.equal(at(result.terrain, 3, 1), "w");
  assert.equal(at(result.terrain, 2, 1), "w");
  assert.equal(at(result.terrain, 4, 1), "w");
  assert.equal(at(result.terrain, 3, 0), "w");
  assert.equal(at(result.terrain, 3, 2), "w");
});

test("strokes are applied in order, so a later one wins", () => {
  const result = paint(flat("p"), [
    { x: 2, y: 2, brush: "forest" },
    { x: 2, y: 2, brush: "hills" },
  ]);
  assert.equal(at(result.terrain, 2, 2), "h");
});

test("painting off the edge is clipped, not refused", () => {
  // Otherwise a DM could not paint a coastline without staying inside it.
  const result = paint(flat("p"), [{ x: 0, y: 0, brush: "water", radius: 3 }]);
  assert.ok(!result.error, result.error);
  assert.equal(at(result.terrain, 0, 0), "w");
});

test("a stroke entirely off the map changes nothing and says so", () => {
  const result = paint(flat("p"), [{ x: 99, y: 99, brush: "water" }]);
  assert.ok(result.error, "an off-map stroke should not silently succeed");
});

test("changed counts tiles, not strokes", () => {
  const result = paint(flat("p"), [
    { x: 1, y: 1, brush: "forest" },
    { x: 1, y: 1, brush: "forest" },
  ]);
  assert.equal(result.changed, 1, "repainting the same tile counted twice");
});

// ---- refusals ----

test("painting nothing is refused", () => {
  assert.ok(paint(flat("p"), []).error);
});

test("a terrain of the wrong length is refused", () => {
  const result = paintOverworld({
    terrain: "ppp",
    width: W,
    height: H,
    strokes: [{ x: 0, y: 0, brush: "forest" }],
  });
  assert.match(result.error, /wrong size/i);
});

test("an unknown brush is refused rather than silently skipped", () => {
  const result = paint(flat("p"), [{ x: 0, y: 0, brush: "lava" }]);
  assert.ok(result.error);
});

test("a stroke with no coordinates is refused", () => {
  assert.ok(paint(flat("p"), [{ x: Number.NaN, y: 0, brush: "forest" }]).error);
});

test("too many strokes at once is refused", () => {
  const strokes = Array.from({ length: MAX_STROKES + 1 }, () => ({
    x: 0,
    y: 0,
    brush: "forest",
  }));
  assert.match(paint(flat("p"), strokes).error, /too much/i);
});

test("a radius beyond the cap still paints, clamped", () => {
  // The route validates the cap; the module clamps rather than throwing so a
  // direct caller cannot repaint the world with one enormous stroke.
  const result = paint(flat("p"), [{ x: 4, y: 2, brush: "forest", radius: 999 }]);
  assert.ok(!result.error, result.error);
  assert.ok(result.changed <= W * H);
  assert.ok(MAX_BRUSH_RADIUS < 999);
});

test("drowning the whole map is refused", () => {
  // The one promise the region map owes the engine: somewhere to stand.
  const strokes = [];
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      strokes.push({ x, y, brush: "water" });
    }
  }
  const result = paint(flat("p"), strokes);
  assert.match(result.error, /nowhere/i);
});

test("paving the whole map in mountains is refused for the same reason", () => {
  const strokes = [];
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      strokes.push({ x, y, brush: "mountains" });
    }
  }
  assert.match(paint(flat("p"), strokes).error, /nowhere/i);
});

test("leaving one settleable tile is enough", () => {
  const strokes = [];
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      if (x === 0 && y === 0) {
        continue;
      }
      strokes.push({ x, y, brush: "water" });
    }
  }
  const result = paint(flat("p"), strokes);
  assert.ok(!result.error, result.error);
  assert.equal(at(result.terrain, 0, 0), "p");
});

test("a paint that changes nothing is refused rather than written", () => {
  assert.match(paint(flat("p"), [{ x: 0, y: 0, brush: "plains" }]).error, /already/i);
});

// ---- stranded anchors ----

const anchors = [
  { id: "a", name: "Saltmarch", at: { x: 1, y: 1 } },
  { id: "b", name: "Deepfen", at: { x: 6, y: 2 } },
];

test("anchors on ground the paint did not touch are not stranded", () => {
  const result = paint(flat("p"), [{ x: 4, y: 0, brush: "forest" }], anchors);
  assert.deepEqual(result.stranded, []);
});

test("an anchor the paint flooded is reported by name", () => {
  const result = paint(flat("p"), [{ x: 1, y: 1, brush: "water" }], anchors);
  assert.equal(result.stranded.length, 1);
  assert.equal(result.stranded[0].name, "Saltmarch");
});

test("an anchor buried under a new mountain is stranded too", () => {
  const result = paint(flat("p"), [{ x: 6, y: 2, brush: "mountains" }], anchors);
  assert.equal(result.stranded.length, 1);
  assert.equal(result.stranded[0].id, "b");
});

test("stranding is a report, not a refusal", () => {
  // A DM widening a lake may well intend to move the village afterwards.
  const result = paint(flat("p"), [{ x: 1, y: 1, brush: "water", radius: 2 }], anchors);
  assert.ok(!result.error, "stranding an anchor must not fail the paint");
  assert.ok(result.terrain);
});

test("painting settleable ground back under an anchor un-strands it", () => {
  const flooded = paint(flat("p"), [{ x: 1, y: 1, brush: "water" }], anchors);
  const restored = paint(flooded.terrain, [{ x: 1, y: 1, brush: "plains" }], anchors);
  assert.deepEqual(restored.stranded, []);
});

// ---- the legend ----

test("the terrain mix counts every tile exactly once", () => {
  const terrain = grid([
    "wwppffhh",
    "wwppffhh",
    "mmsspppp",
    "mmsspppp",
  ]);
  const mix = terrainMix(terrain);
  assert.equal(mix.water, 4);
  assert.equal(mix.forest, 4);
  assert.equal(mix.hills, 4);
  assert.equal(mix.mountains, 4);
  assert.equal(mix.swamp, 4);
  assert.equal(mix.plains, 12);
  assert.equal(
    Object.values(mix).reduce((sum, count) => sum + count, 0),
    W * H,
  );
});

test("the mix works on a real generated map", () => {
  // Guards against the brush alphabet drifting from the generator's.
  const terrain = generateOverworldTerrain(12345, 24, 16);
  const mix = terrainMix(terrain);
  assert.equal(
    Object.values(mix).reduce((sum, count) => sum + count, 0),
    24 * 16,
    "the generator produced a tile the brush palette does not know",
  );
});

test("a generated map can be painted without special handling", () => {
  const terrain = generateOverworldTerrain(999, 24, 16);
  const result = paintOverworld({
    terrain,
    width: 24,
    height: 16,
    strokes: [{ x: 12, y: 8, brush: "mountains", radius: 2 }],
  });
  assert.ok(!result.error, result.error);
  assert.equal(tileAt(result.terrain, 24, 12, 8), "m");
});

console.log(`overworld paint: ${passed} assertions passed.`);
