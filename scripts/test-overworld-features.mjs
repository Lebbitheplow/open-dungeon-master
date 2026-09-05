// Roads, rivers, borders and labels over the region map, and the sizes it
// may be rolled at. See docs/workshop-parity-audit.md phase 15.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const {
  FEATURE_LIMITS,
  OVERWORLD_SIZES,
  OVERWORLD_SIZE_LIMITS,
  decimate,
  describeFeatures,
  featureAt,
  normalizeLabels,
  normalizePaths,
  normalizeSize,
  pathLength,
  sizeLabel,
} = await import("../src/lib/overworld/features.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

test("a size is clamped to the limits and falls back when nonsense", () => {
  const fallback = { width: 96, height: 72 };
  assert.deepEqual(normalizeSize({ width: 48, height: 36 }, fallback), { width: 48, height: 36 });
  assert.deepEqual(normalizeSize({ width: 9999, height: -4 }, fallback), {
    width: OVERWORLD_SIZE_LIMITS.maxWidth,
    height: OVERWORLD_SIZE_LIMITS.minHeight,
  });
  assert.deepEqual(normalizeSize({ width: "wide" }, fallback), fallback);
  assert.deepEqual(normalizeSize(undefined, fallback), fallback);
  // Every preset is inside the limits and has a readable name.
  for (const preset of OVERWORLD_SIZES) {
    assert.deepEqual(normalizeSize(preset, fallback), { width: preset.width, height: preset.height });
    assert.ok(sizeLabel(preset).startsWith(preset.label));
  }
  assert.equal(sizeLabel({ width: 50, height: 40 }), "50 by 40");
});

test("a path keeps its in-bounds points, drops repeats, and needs two to exist", () => {
  const paths = normalizePaths(
    [
      {
        kind: "road",
        label: "The King's Way",
        points: [
          { x: 1, y: 1 },
          { x: 1, y: 1 },
          { x: 5, y: 1 },
          { x: 99, y: 1 },
          { x: 5, y: 4.4 },
        ],
      },
      { kind: "river", points: [{ x: 2, y: 2 }] },
      { kind: "wall", points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] },
      "not a path",
    ],
    10,
    10,
  );
  assert.equal(paths.length, 1);
  assert.equal(paths[0].kind, "road");
  assert.equal(paths[0].label, "The King's Way");
  assert.deepEqual(paths[0].points, [
    { x: 1, y: 1 },
    { x: 5, y: 1 },
    { x: 5, y: 4 },
  ]);
  assert.ok(paths[0].id.length > 0);
  assert.equal(pathLength(paths[0]), 7);
});

test("a resize is the same normalizer against the new size", () => {
  const before = normalizePaths(
    [{ kind: "river", points: [{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 20 }] }],
    30,
    30,
  );
  assert.equal(before[0].points.length, 3);
  const after = normalizePaths(before, 15, 15);
  // The tail past the new edge is gone, not piled on the edge.
  assert.deepEqual(after[0].points, [
    { x: 0, y: 0 },
    { x: 10, y: 10 },
  ]);
  assert.equal(after[0].id, before[0].id);
  // Shrunk to a single point, the river is no longer a river.
  assert.equal(normalizePaths(before, 5, 5).length, 0);
});

test("limits: too many points are thinned with both ends kept, too many paths are cut", () => {
  const points = Array.from({ length: 1000 }, (_, index) => ({ x: index % 200, y: Math.floor(index / 200) }));
  const [path] = normalizePaths([{ kind: "road", points }], 200, 200);
  assert.equal(path.points.length, FEATURE_LIMITS.pointsPerPath);
  assert.deepEqual(path.points[0], points[0]);
  assert.deepEqual(path.points[path.points.length - 1], points[999]);
  assert.deepEqual(decimate([1, 2, 3, 4, 5, 6, 7, 8, 9], 3), [1, 5, 9]);
  const many = Array.from({ length: 100 }, () => ({ kind: "border", points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }));
  assert.equal(normalizePaths(many, 5, 5).length, FEATURE_LIMITS.paths);
});

test("a label needs words and a spot on the map", () => {
  const labels = normalizeLabels(
    [
      { x: 3, y: 4, text: "  The Weald  ", size: "large" },
      { x: 3, y: 4, text: "   " },
      { x: 30, y: 4, text: "Off the edge" },
      { x: 1, y: 1, text: "x".repeat(100), size: "huge" },
    ],
    10,
    10,
  );
  assert.equal(labels.length, 2);
  assert.equal(labels[0].text, "The Weald");
  assert.equal(labels[0].size, "large");
  assert.equal(labels[1].text.length, FEATURE_LIMITS.labelLength);
  assert.equal(labels[1].size, "small");
});

test("what is under a tap: the label first, then the line that passes nearby", () => {
  const paths = normalizePaths(
    [{ kind: "road", points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] }],
    20,
    20,
  );
  const labels = normalizeLabels([{ x: 5, y: 1, text: "Mill" }], 20, 20);
  assert.deepEqual(featureAt(paths, labels, { x: 5, y: 1 }), { label: labels[0] });
  assert.deepEqual(featureAt(paths, labels, { x: 8, y: 1 }), { path: paths[0] });
  assert.equal(featureAt(paths, labels, { x: 8, y: 5 }), null);
});

test("the map's lines and words, described", () => {
  const paths = normalizePaths(
    [
      { kind: "road", label: "Coast Road", points: [{ x: 0, y: 0 }, { x: 4, y: 0 }] },
      { kind: "border", points: [{ x: 0, y: 0 }, { x: 0, y: 1 }] },
    ],
    10,
    10,
  );
  const labels = normalizeLabels([{ x: 2, y: 2, text: "Ashmoor", size: "large" }], 10, 10);
  assert.deepEqual(describeFeatures(paths, labels), [
    "Road: Coast Road, 4 tiles long.",
    "Border: an unnamed border, 1 tile long.",
    "Region label: Ashmoor.",
  ]);
});

console.log(`test-overworld-features: ${passed} passed`);
