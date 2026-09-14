// The selection model's pure half (docs/vtt-parity-implementation-plan.md
// sections 10.1 and 10.8): what stands on a tile, every placed thing as a
// list, and remove, move, duplicate and DM-only as whole-list edits.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const {
  duplicateObject,
  emptyObjects,
  listObjects,
  moveObject,
  objectAt,
  refBounds,
  refKey,
  removeObjects,
  sameRef,
  setDmOnly,
} = await import("../src/lib/battlemap/objects.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

const objects = {
  ...emptyObjects(),
  labels: [
    { x: 2, y: 2, text: "The well", dmOnly: false },
    { x: 5, y: 5, text: "Trap", dmOnly: true, ref: { kind: "lore", id: "l1" } },
  ],
  props: [{ x: 3, y: 2, name: "Barrel", kind: "prop" }],
  lights: [{ x: 4, y: 4, brightRadius: 2, dimRadius: 4 }],
  doors: { "6,1": "locked" },
  zones: [{ x0: 0, y0: 0, x1: 9, y1: 9, ambient: "dark", kind: "light" }, { x0: 4, y0: 4, x1: 6, y1: 6, ambient: "bright", kind: "light" }],
  drawings: [{ id: "d1", kind: "arrow", points: [{ x: 1, y: 1 }, { x: 3, y: 2 }], tone: "gold", dmOnly: false }],
};

test("the smallest thing on a tile wins, and the last zone drawn wins", () => {
  assert.deepEqual(objectAt(objects, 2, 2), { kind: "labels", x: 2, y: 2 });
  assert.deepEqual(objectAt(objects, 3, 2), { kind: "props", x: 3, y: 2 });
  assert.deepEqual(objectAt(objects, 4, 4), { kind: "lights", x: 4, y: 4 });
  assert.deepEqual(objectAt(objects, 6, 1), { kind: "doors", x: 6, y: 1 });
  assert.deepEqual(objectAt(objects, 5, 6), { kind: "zones", index: 1 });
  assert.deepEqual(objectAt(objects, 8, 8), { kind: "zones", index: 0 });
  assert.equal(objectAt({ ...objects, zones: [] }, 8, 8), null);
});

test("the objects list names everything once, in reading order", () => {
  const rows = listObjects(objects);
  assert.equal(rows.length, 2 + 1 + 1 + 1 + 2 + 1);
  assert.equal(rows[0].name, "The well");
  assert.equal(rows[1].dmOnly, true);
  assert.match(rows[1].detail, /opens lore/);
  assert.equal(new Set(rows.map((row) => refKey(row.ref))).size, rows.length);
  assert.ok(sameRef(rows[3].ref, { kind: "lights", x: 4, y: 4 }));
});

test("removing takes only the named things, and doors stay", () => {
  const next = removeObjects(objects, [
    { kind: "labels", x: 2, y: 2 },
    { kind: "zones", index: 0 },
    { kind: "drawings", id: "d1" },
    { kind: "doors", x: 6, y: 1 },
  ]);
  assert.equal(next.labels.length, 1);
  assert.equal(next.labels[0].text, "Trap");
  assert.equal(next.zones.length, 1);
  assert.equal(next.zones[0].x0, 4, "the survivor is the second zone");
  assert.equal(next.drawings.length, 0);
  assert.equal(Object.keys(next.doors).length, 0, "a door ref removes its state");
  assert.equal(next.props.length, 1);
});

test("moving keeps the thing and evicts whatever stood at the destination", () => {
  const moved = moveObject(objects, { kind: "labels", x: 2, y: 2 }, { x: 5, y: 5 });
  assert.equal(moved.labels.length, 1, "the label that stood at 5,5 is replaced");
  assert.equal(moved.labels[0].text, "The well");
  assert.equal(moved.labels[0].x, 5);
  const zone = moveObject(objects, { kind: "zones", index: 1 }, { x: 0, y: 0 });
  assert.deepEqual([zone.zones[1].x0, zone.zones[1].y0, zone.zones[1].x1, zone.zones[1].y1], [0, 0, 2, 2]);
  assert.equal(moveObject(objects, { kind: "doors", x: 6, y: 1 }, { x: 1, y: 1 }), objects, "doors do not move");
});

test("duplicating lands beside the original, inside the board", () => {
  const twice = duplicateObject(objects, { kind: "props", x: 3, y: 2 }, 10, 10);
  assert.equal(twice.props.length, 2);
  assert.deepEqual([twice.props[1].x, twice.props[1].y], [4, 2]);
  const edge = duplicateObject({ ...objects, props: [{ x: 9, y: 9, name: "Crate", kind: "prop" }] }, { kind: "props", x: 9, y: 9 }, 10, 10);
  assert.equal(edge.props.length, 2);
  assert.ok(edge.props[1].x < 10 && edge.props[1].y < 10);
  const zone = duplicateObject(objects, { kind: "zones", index: 1 }, 10, 10);
  assert.equal(zone.zones.length, 3);
  assert.equal(zone.zones[2].x0, 7);
});

test("the DM-only flag flips on labels and drawings only", () => {
  const hidden = setDmOnly(objects, [{ kind: "labels", x: 2, y: 2 }, { kind: "drawings", id: "d1" }, { kind: "props", x: 3, y: 2 }], true);
  assert.equal(hidden.labels[0].dmOnly, true);
  assert.equal(hidden.drawings[0].dmOnly, true);
  assert.deepEqual(hidden.props, objects.props);
});

test("bounds cover a tile, a zone, or a drawing's extent", () => {
  assert.deepEqual(refBounds(objects, { kind: "labels", x: 2, y: 2 }), { x0: 2, y0: 2, x1: 2, y1: 2 });
  assert.deepEqual(refBounds(objects, { kind: "zones", index: 1 }), { x0: 4, y0: 4, x1: 6, y1: 6 });
  assert.deepEqual(refBounds(objects, { kind: "drawings", id: "d1" }), { x0: 1, y0: 1, x1: 3, y1: 2 });
  assert.equal(refBounds(objects, { kind: "zones", index: 9 }), null);
});

console.log(`test-map-objects: ${passed} passed`);
