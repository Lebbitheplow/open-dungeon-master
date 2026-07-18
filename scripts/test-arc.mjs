// Story-arc parsing, clamped delta merges, and player-safe projections.
import assert from "node:assert/strict";
import {
  activeQuestLines,
  applyArcDelta,
  normalizeStoryArc,
  parseArcDeltaJson,
  parseArcJson,
  renderArcForPrompt,
} from "../src/lib/dm/arc-logic.ts";

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

const validArcJson = JSON.stringify({
  premise: "A dead god's heart is waking beneath the city.",
  stakes: "If it beats again, the city drowns in divine fire.",
  antagonist: "Vicar Osseth, who wants the god reborn.",
  beats: [
    "The party notices the tremors and the missing clergy",
    "They trace the disappearances to the undercroft",
    "Osseth is revealed as the abductor",
    "The heart's first beat shatters the temple district",
    "Final descent to still the heart forever",
  ],
  finale: "Still or wake the heart in the sunken sanctum.",
  subArcs: [
    {
      name: "The Missing Sexton",
      goal: "Find sexton Marl before the next tremor",
      hook: "Marl saw Osseth's face and lives, hidden",
      beats: ["Search the parish", "Follow the tunnel scratches"],
    },
    {
      name: "The Broken Seal",
      goal: "Recover the seal fragments from the reliquary",
      hook: "The seal is the only way to still the heart",
      beats: ["Reliquary heist", "Decode the fragments"],
    },
  ],
});

test("clean arc JSON parses; first beat active, sub-arcs open active", () => {
  const arc = parseArcJson(validArcJson);
  assert.ok(arc);
  assert.equal(arc.beats.length, 5);
  assert.equal(arc.beats[0].status, "active");
  assert.equal(arc.beats[1].status, "pending");
  assert.deepEqual(
    arc.subArcs.map((subArc) => subArc.id),
    ["sa1", "sa2"],
  );
  assert.ok(arc.subArcs.every((subArc) => subArc.status === "active"));
});

test("code-fenced JSON with reasoning chatter still parses", () => {
  const arc = parseArcJson(
    `<think>plotting...</think>Here you go:\n\`\`\`json\n${validArcJson}\n\`\`\``,
  );
  assert.ok(arc);
  assert.equal(arc.subArcs.length, 2);
});

test("garbage yields null, not a broken arc", () => {
  assert.equal(parseArcJson("the model rambled with no json at all"), null);
  assert.equal(parseArcJson('{"premise": "x"}'), null);
  assert.equal(normalizeStoryArc(null), null);
  assert.equal(normalizeStoryArc("nope"), null);
});

test("stored arc round-trips through normalizeStoryArc with statuses intact", () => {
  const arc = parseArcJson(validArcJson);
  arc.beats[0].status = "done";
  arc.beats[1].status = "active";
  arc.subArcs[0].status = "resolved";
  arc.subArcs[0].resolution = "Marl found alive";
  const restored = normalizeStoryArc(JSON.parse(JSON.stringify(arc)));
  assert.equal(restored.beats[0].status, "done");
  assert.equal(restored.beats[1].status, "active");
  assert.equal(restored.subArcs[0].status, "resolved");
  assert.equal(restored.subArcs[0].resolution, "Marl found alive");
});

test("delta marks beats done and advances the active marker", () => {
  const arc = parseArcJson(validArcJson);
  const delta = parseArcDeltaJson(
    '{"beatsDone": [1, 2], "activeBeat": 3, "subArcUpdates": [{"id": "sa1", "status": "resolved", "resolution": "Marl rescued"}], "newSubArcs": []}',
  );
  const next = applyArcDelta(arc, delta);
  assert.equal(next.beats[0].status, "done");
  assert.equal(next.beats[1].status, "done");
  assert.equal(next.beats[2].status, "active");
  assert.equal(next.subArcs[0].status, "resolved");
  assert.equal(next.subArcs[0].resolution, "Marl rescued");
  // Original untouched.
  assert.equal(arc.beats[0].status, "active");
});

test("delta clamps invalid indices, unknown ids, and done-beat activation", () => {
  const arc = parseArcJson(validArcJson);
  const delta = parseArcDeltaJson(
    '{"beatsDone": [1, 99, -2, 0], "activeBeat": 1, "subArcUpdates": [{"id": "sa9", "status": "resolved"}], "newSubArcs": []}',
  );
  const next = applyArcDelta(arc, delta);
  assert.equal(next.beats[0].status, "done");
  // activeBeat pointed at a done beat, so the first pending beat is chosen.
  assert.equal(next.beats[1].status, "active");
  assert.ok(next.subArcs.every((subArc) => subArc.status === "active"));
});

test("empty delta is a clean no-op on statuses", () => {
  const arc = parseArcJson(validArcJson);
  const delta = parseArcDeltaJson('{"beatsDone": [], "activeBeat": null, "subArcUpdates": [], "newSubArcs": []}');
  const next = applyArcDelta(arc, delta);
  assert.deepEqual(
    next.beats.map((beat) => beat.status),
    arc.beats.map((beat) => beat.status),
  );
});

test("new sub-arcs cap at 2 and get fresh sequential ids", () => {
  const arc = parseArcJson(validArcJson);
  const delta = parseArcDeltaJson(
    JSON.stringify({
      beatsDone: [],
      activeBeat: null,
      subArcUpdates: [],
      newSubArcs: [
        { name: "A", goal: "a", hook: "", beats: [] },
        { name: "B", goal: "b", hook: "", beats: [] },
        { name: "C", goal: "c", hook: "", beats: [] },
      ],
    }),
  );
  const next = applyArcDelta(arc, delta);
  assert.equal(next.subArcs.length, 4);
  assert.equal(next.subArcs[2].id, "sa3");
  assert.equal(next.subArcs[3].id, "sa4");
  assert.equal(next.subArcs[3].status, "active");
});

test("unparseable delta yields null", () => {
  assert.equal(parseArcDeltaJson("no json here"), null);
});

test("prompt render is bounded and marks the NOW beat", () => {
  const arc = parseArcJson(validArcJson);
  arc.beats[0].status = "done";
  arc.beats[1].status = "active";
  arc.subArcs[1].status = "resolved";
  arc.subArcs[1].resolution = "Seal restored";
  const rendered = renderArcForPrompt(arc);
  assert.ok(rendered.includes("[NOW] They trace the disappearances"));
  assert.ok(rendered.includes("[done]"));
  assert.ok(rendered.includes("Settled: The Broken Seal (Seal restored)"));
  assert.ok(rendered.length < 4000);
});

test("quest lines are player-safe: no hooks or expected beats leak", () => {
  const arc = parseArcJson(validArcJson);
  const lines = activeQuestLines(arc);
  assert.equal(lines.length, 2);
  assert.ok(lines[0].startsWith("The Missing Sexton:"));
  const joined = lines.join("\n");
  assert.ok(!joined.includes("Osseth's face"));
  assert.ok(!joined.includes("Reliquary heist"));
});

test("resolved sub-arcs drop out of the quest log", () => {
  const arc = parseArcJson(validArcJson);
  arc.subArcs[0].status = "resolved";
  const lines = activeQuestLines(arc);
  assert.equal(lines.length, 1);
  assert.ok(lines[0].startsWith("The Broken Seal:"));
});

console.log(`${passed} arc tests passed`);
