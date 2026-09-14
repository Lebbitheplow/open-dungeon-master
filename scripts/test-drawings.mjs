// Freehand marks on the board and label references (docs/vtt-parity-
// implementation-plan.md sections 3.5 and 3.6): strokes simplify to at
// most sixty-four points, the list is capped, DM-only marks are projected
// out, a mark with a round to live fades, and a label may point at an entry.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const {
  SCENE_LIMITS,
  drawingsFor,
  normalizeDrawing,
  normalizeDrawings,
  normalizeLabels,
  simplifyPoints,
} = await import("../src/lib/battlemap/scene.ts");
const { sceneRequestSchema } = await import("../src/lib/schemas/map-paint.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

test("Ramer-Douglas-Peucker keeps the corners and drops the jitter", () => {
  const line = Array.from({ length: 50 }, (_, i) => ({ x: i / 10, y: 1 + (i % 2) * 0.01 }));
  const simple = simplifyPoints(line, 0.05);
  assert.equal(simple.length, 2, "a nearly straight line is two points");
  const corner = [
    { x: 0, y: 0 },
    { x: 1, y: 0.01 },
    { x: 2, y: 0 },
    { x: 2, y: 1 },
    { x: 2, y: 2 },
  ];
  const kept = simplifyPoints(corner, 0.05);
  assert.deepEqual(kept, [
    { x: 0, y: 0 },
    { x: 2, y: 0 },
    { x: 2, y: 2 },
  ]);
});

test("a stroke is simplified until it fits the point cap", () => {
  const wiggle = Array.from({ length: 900 }, (_, i) => ({
    x: (i / 900) * 20,
    y: 5 + Math.sin(i / 60) * 2,
  }));
  const drawing = normalizeDrawing({ kind: "stroke", points: wiggle, tone: "ember" }, 24, 18);
  assert.ok(drawing);
  assert.ok(drawing.points.length <= SCENE_LIMITS.drawingPoints, `${drawing.points.length} points`);
  assert.ok(drawing.points.length >= 8, "but still a curve");
  assert.equal(drawing.tone, "ember");
  assert.equal(drawing.dmOnly, false);
  assert.ok(drawing.id.length > 0);
});

test("shapes keep two corners, points are clamped to the board, junk is refused", () => {
  const rect = normalizeDrawing(
    { kind: "rect", points: [{ x: -3, y: 1 }, { x: 4, y: 2 }, { x: 40, y: 9 }], tone: "sky" },
    10,
    8,
  );
  assert.deepEqual(rect.points, [
    { x: 0, y: 1 },
    { x: 10, y: 8 },
  ]);
  assert.equal(normalizeDrawing({ kind: "stroke", points: [{ x: 1, y: 1 }] }, 10, 8), null);
  assert.equal(normalizeDrawing({ kind: "scribble", points: [{ x: 1, y: 1 }, { x: 2, y: 2 }] }, 10, 8), null);
  assert.equal(normalizeDrawing({ kind: "arrow", points: [{ x: "a", y: 1 }, { x: 2, y: 2 }] }, 10, 8), null);
  const badTone = normalizeDrawing({ kind: "arrow", points: [{ x: 1, y: 1 }, { x: 2, y: 2 }], tone: "puce" }, 10, 8);
  assert.equal(badTone.tone, "gold");
});

test("the list is capped at the newest and ids stay unique", () => {
  const many = Array.from({ length: SCENE_LIMITS.drawings + 10 }, (_, i) => ({
    id: `d${i}`,
    kind: "arrow",
    points: [{ x: 1, y: 1 }, { x: 3, y: 3 }],
  }));
  const kept = normalizeDrawings(many, 10, 10);
  assert.equal(kept.length, SCENE_LIMITS.drawings);
  assert.equal(kept[0].id, "d10", "the oldest went first");
  const dup = normalizeDrawings([many[0], many[0]], 10, 10);
  assert.equal(dup.length, 1);
});

test("projection: DM-only marks stay with the DM, expired marks fade", () => {
  const drawings = normalizeDrawings(
    [
      { id: "plan", kind: "arrow", points: [{ x: 1, y: 1 }, { x: 4, y: 4 }], expiresRound: 3 },
      { id: "secret", kind: "rect", points: [{ x: 1, y: 1 }, { x: 4, y: 4 }], dmOnly: true },
      { id: "circle", kind: "ellipse", points: [{ x: 1, y: 1 }, { x: 4, y: 4 }] },
    ],
    10,
    10,
  );
  assert.deepEqual(drawingsFor(drawings, { dm: false, round: 2 }).map((d) => d.id), ["plan", "circle"]);
  assert.deepEqual(drawingsFor(drawings, { dm: true, round: 2 }).map((d) => d.id), ["plan", "secret", "circle"]);
  assert.deepEqual(drawingsFor(drawings, { dm: false, round: 4 }).map((d) => d.id), ["circle"]);
});

test("a label may point at an entry, and a bad pointer is dropped", () => {
  const labels = normalizeLabels(
    [
      { x: 1, y: 1, text: "The well", ref: { kind: "lore", id: "lore-1" } },
      { x: 2, y: 1, text: "Old Marta", ref: { kind: "npc", id: "npc-9" } },
      { x: 3, y: 1, text: "Nowhere", ref: { kind: "planet", id: "x" } },
      { x: 4, y: 1, text: "Plain" },
    ],
    10,
    10,
  );
  assert.deepEqual(labels[0].ref, { kind: "lore", id: "lore-1" });
  assert.deepEqual(labels[1].ref, { kind: "npc", id: "npc-9" });
  assert.equal(labels[2].ref, undefined);
  assert.equal(labels[3].ref, undefined);
});

test("the scene request schema accepts drawings and label references", () => {
  const parsed = sceneRequestSchema.safeParse({
    labels: [{ x: 1, y: 1, text: "Well", ref: { kind: "lore", id: "l1" } }],
    drawings: [{ kind: "stroke", points: [{ x: 0.5, y: 0.5 }, { x: 2.25, y: 3 }], tone: "moss" }],
    zones: [{ x0: 1, y0: 1, x1: 2, y1: 2, ambient: "dark", kind: "magical_darkness" }],
  });
  assert.ok(parsed.success, JSON.stringify(parsed.error?.issues));
  assert.equal(parsed.data.zones[0].kind, "magical_darkness");
  const bad = sceneRequestSchema.safeParse({ drawings: [{ kind: "stroke", points: [{ x: 1, y: 1 }] }] });
  assert.equal(bad.success, false);
});

console.log(`test-drawings: ${passed} passed`);
