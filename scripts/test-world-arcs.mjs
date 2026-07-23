// World-arc logic: normalization bounds, rung advancement, stance updates
// with permanent consequences, render bounds, and the arc-delta integration
// (worldArcUpdates parse + apply, legacy v3 arcs defaulting worldArcs: []).
import assert from "node:assert/strict";
import {
  advanceWorldArc,
  applyWorldArcUpdates,
  normalizeWorldArcs,
  parseWorldArcsJson,
  renderWorldArcsForPrompt,
  resolveWorldArc,
  stanceCadence,
  DEFAULT_CADENCE,
} from "../src/lib/dm/world-arc-logic.ts";
import {
  applyArcDelta,
  normalizeStoryArc,
  parseArcDeltaJson,
} from "../src/lib/dm/arc-logic.ts";

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

const rungs = [
  "Rumors of missing shepherds reach the taverns.",
  "A village empties overnight.",
  "The cult's beacon is seen burning on the ridge.",
  "Roads north close; refugees stream south.",
  "The summoning completes; the valley goes dark.",
];

function makeArc(overrides = {}) {
  return normalizeWorldArcs([
    { name: "The Summoning", driver: "The Ashen Cult", rungs, ...overrides },
  ])[0];
}

test("normalization bounds and defaults", () => {
  const arc = makeArc();
  assert.equal(arc.id, "wa1");
  assert.equal(arc.rung, -1);
  assert.equal(arc.stance, "unaware");
  assert.equal(arc.cadence, DEFAULT_CADENCE);
  assert.equal(arc.status, "building");
  assert.deepEqual(arc.consequences, []);
});

test("garbage entries are dropped, caps enforced", () => {
  assert.deepEqual(normalizeWorldArcs("nope"), []);
  assert.deepEqual(normalizeWorldArcs([{ name: "x", rungs: ["only one", "two"] }]), []);
  const many = normalizeWorldArcs(
    Array.from({ length: 6 }, (_, index) => ({
      name: `Arc ${index}`,
      driver: "d",
      rungs,
    })),
  );
  assert.equal(many.length, 3);
  assert.deepEqual(
    many.map((arc) => arc.id),
    ["wa1", "wa2", "wa3"],
  );
});

test("advance climbs rungs, flags climax, stops at the top", () => {
  let arc = makeArc();
  const first = advanceWorldArc(arc);
  assert.equal(first.arc.rung, 0);
  assert.equal(first.reachedRung, rungs[0]);
  arc = first.arc;
  for (let index = 0; index < 4; index += 1) {
    arc = advanceWorldArc(arc).arc;
  }
  assert.equal(arc.rung, 4);
  assert.equal(arc.status, "climax");
  const stuck = advanceWorldArc(arc);
  assert.equal(stuck.reachedRung, null);
  assert.equal(stuck.arc.rung, 4);
});

test("resolved arcs never advance", () => {
  const arc = { ...makeArc(), status: "resolved" };
  assert.equal(advanceWorldArc(arc).reachedRung, null);
});

test("stance updates apply and consequences are permanent and deduped", () => {
  let arcs = [makeArc()];
  arcs = applyWorldArcUpdates(arcs, [
    { id: "wa1", stance: "ignoring", consequence: "The northern villages fell unaided." },
  ]);
  assert.equal(arcs[0].stance, "ignoring");
  assert.deepEqual(arcs[0].consequences, ["The northern villages fell unaided."]);
  arcs = applyWorldArcUpdates(arcs, [
    { id: "wa1", stance: "opposing", consequence: "The northern villages fell unaided." },
  ]);
  assert.equal(arcs[0].stance, "opposing");
  assert.equal(arcs[0].consequences.length, 1);
  arcs = applyWorldArcUpdates(arcs, [{ id: "waX", stance: "aiding" }]);
  assert.equal(arcs[0].stance, "opposing");
});

test("stance tugs the cadence", () => {
  const arc = makeArc();
  assert.ok(stanceCadence({ ...arc, stance: "opposing" }) < arc.cadence);
  assert.ok(stanceCadence({ ...arc, stance: "aiding" }) > arc.cadence);
  assert.equal(stanceCadence(arc), arc.cadence);
});

test("render shows current and next rung, hides resolved, stays bounded", () => {
  const advanced = advanceWorldArc(makeArc()).arc;
  const text = renderWorldArcsForPrompt([advanced]);
  assert.ok(text.includes(rungs[0]));
  assert.ok(text.includes(rungs[1]));
  assert.ok(text.includes("unaware"));
  assert.equal(renderWorldArcsForPrompt([resolveWorldArc([advanced], "wa1")[0]]), "");
  assert.equal(renderWorldArcsForPrompt([]), "");
});

test("parseWorldArcsJson tolerates fences and prose", () => {
  const arcs = parseWorldArcsJson(
    '```json\n[{"name": "March of Iron", "driver": "Warlord Hesk", "rungs": ["a scout", "a raid", "a siege", "a fall"]}]\n```',
  );
  assert.equal(arcs.length, 1);
  assert.equal(arcs[0].name, "March of Iron");
  assert.deepEqual(parseWorldArcsJson("no json"), []);
});

// ---- arc-delta integration ----

const baseArc = {
  premise: "Stop the cult",
  beats: ["Find the shrine", "Break the beacon", "Face the summoner"],
};

test("legacy v3 arcs normalize with empty worldArcs", () => {
  const arc = normalizeStoryArc(baseArc);
  assert.ok(arc);
  assert.deepEqual(arc.worldArcs, []);
});

test("stored worldArcs survive the normalize round-trip", () => {
  const arc = normalizeStoryArc({
    ...baseArc,
    worldArcs: [{ name: "The Summoning", driver: "cult", rungs, rung: 2, stance: "opposing" }],
  });
  assert.equal(arc.worldArcs.length, 1);
  assert.equal(arc.worldArcs[0].rung, 2);
  assert.equal(arc.worldArcs[0].stance, "opposing");
});

test("delta json parses worldArcUpdates and applyArcDelta applies them", () => {
  const arc = normalizeStoryArc({
    ...baseArc,
    worldArcs: [{ name: "The Summoning", driver: "cult", rungs }],
  });
  const delta = parseArcDeltaJson(
    JSON.stringify({
      worldArcUpdates: [
        { id: "wa1", stance: "ignoring", consequence: "The ridge burned." },
        { id: "wa1" },
        { stance: "aiding" },
      ],
    }),
  );
  assert.ok(delta);
  assert.equal(delta.worldArcUpdates.length, 1);
  const next = applyArcDelta(arc, delta);
  assert.equal(next.worldArcs[0].stance, "ignoring");
  assert.deepEqual(next.worldArcs[0].consequences, ["The ridge burned."]);
  // The original arc is untouched (clone semantics).
  assert.equal(arc.worldArcs[0].stance, "unaware");
});

test("old deltas without worldArcUpdates still apply", () => {
  const arc = normalizeStoryArc({
    ...baseArc,
    worldArcs: [{ name: "The Summoning", driver: "cult", rungs }],
  });
  const delta = parseArcDeltaJson(JSON.stringify({ beatsDone: [1] }));
  const next = applyArcDelta(arc, { ...delta, worldArcUpdates: undefined });
  assert.equal(next.beats[0].status, "done");
  assert.equal(next.worldArcs.length, 1);
});

console.log(`${passed} world arc tests passed`);
