// The relationship graph's layout (docs/vtt-parity-implementation-plan.md
// section 5.5): the same roster lands in the same place, nobody overlaps,
// and everyone stays in frame.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { closestPair, layoutGraph } = await import("../src/lib/npcs/graph-layout.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

const roster = ["Marla", "Osric", "The Abbot", "Wren", "Tobin", "Hesse", "Old Pike", "Sable"];
const edges = [
  { from: "Marla", to: "Osric" },
  { from: "Osric", to: "The Abbot" },
  { from: "Wren", to: "Marla" },
  { from: "Tobin", to: "Hesse" },
];

test("the layout is deterministic for a roster", () => {
  const a = layoutGraph({ nodes: roster, edges, width: 600, height: 400 });
  const b = layoutGraph({ nodes: roster, edges, width: 600, height: 400 });
  assert.deepEqual(a, b);
  const other = layoutGraph({ nodes: [...roster, "Newcomer"], edges, width: 600, height: 400 });
  assert.equal(other.length, roster.length + 1);
});

test("nodes keep their distance and stay inside the frame", () => {
  const nodes = layoutGraph({ nodes: roster, edges, width: 600, height: 400, spacing: 60 });
  assert.ok(closestPair(nodes) >= 40, `closest pair ${closestPair(nodes)}`);
  for (const node of nodes) {
    assert.ok(node.x >= 30 && node.x <= 570 && node.y >= 30 && node.y <= 370, `${node.id} at ${node.x},${node.y}`);
  }
});

test("linked nodes end up nearer than unlinked ones on average", () => {
  const nodes = layoutGraph({ nodes: roster, edges, width: 800, height: 600 });
  const at = new Map(nodes.map((node) => [node.id, node]));
  const distance = (a, b) => Math.hypot(at.get(a).x - at.get(b).x, at.get(a).y - at.get(b).y);
  const linked = edges.reduce((sum, edge) => sum + distance(edge.from, edge.to), 0) / edges.length;
  let unlinked = 0;
  let count = 0;
  for (let a = 0; a < roster.length; a += 1) {
    for (let b = a + 1; b < roster.length; b += 1) {
      if (!edges.some((edge) => (edge.from === roster[a] && edge.to === roster[b]) || (edge.from === roster[b] && edge.to === roster[a]))) {
        unlinked += distance(roster[a], roster[b]);
        count += 1;
      }
    }
  }
  assert.ok(linked < unlinked / count, `linked ${linked} vs unlinked ${unlinked / count}`);
});

test("an empty roster and a lone node both lay out", () => {
  assert.deepEqual(layoutGraph({ nodes: [], edges: [], width: 100, height: 100 }), []);
  const one = layoutGraph({ nodes: ["Solo"], edges: [], width: 100, height: 100 });
  assert.equal(one.length, 1);
});

console.log(`test-graph-layout: ${passed} passed`);
