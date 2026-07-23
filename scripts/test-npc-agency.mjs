// NPC agency logic: parsing tolerance, personality derivation and drift,
// bond/relation shifts, goal advancement with injected dice, collisions,
// pressure counters, and roster fragment bounds.
import assert from "node:assert/strict";
import {
  advanceSessionGoal,
  agencyFragment,
  clampAxis,
  derivePersonality,
  detectGoalCollisions,
  driftPersonality,
  parseBonds,
  parseGoals,
  parsePersonality,
  parsePressure,
  parseRelations,
  pressureState,
  shiftBond,
  shiftRelation,
  tickPressure,
} from "../src/lib/dm/npc-logic.ts";

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

test("clampAxis bounds and rounds", () => {
  assert.equal(clampAxis(5), 3);
  assert.equal(clampAxis(-9), -3);
  assert.equal(clampAxis(1.6), 2);
  assert.equal(clampAxis(Number.NaN), 0);
});

test("parsers tolerate empty and garbage", () => {
  assert.equal(parsePersonality(""), null);
  assert.equal(parsePersonality("not json"), null);
  assert.deepEqual(parseGoals(""), {});
  assert.deepEqual(parseGoals("garbage"), {});
  assert.deepEqual(parseRelations("wat"), []);
  assert.deepEqual(parseBonds(""), []);
  assert.deepEqual(parsePressure(""), { ignored: 0, engaged: 0 });
});

test("parsers clamp and bound real payloads", () => {
  const personality = parsePersonality(
    JSON.stringify({ drive: 9, warmth: -9, boldness: 1 }),
  );
  assert.equal(personality.drive, 3);
  assert.equal(personality.warmth, -3);
  assert.equal(personality.empathy, 0);
  const goals = parseGoals(
    JSON.stringify({ session: { text: "seize the mill", progress: -2, target: 99 } }),
  );
  assert.equal(goals.session.progress, 0);
  assert.equal(goals.session.target, 6);
});

test("derived personality is deterministic and attitude-leaning", () => {
  const a = derivePersonality("Marla", "friendly", "fence");
  const b = derivePersonality("Marla", "friendly", "fence");
  assert.deepEqual(a, b);
  const hostile = derivePersonality("Marla", "hostile", "fence");
  assert.ok(a.warmth > hostile.warmth);
});

test("drift moves the right axes and clamps", () => {
  const base = { drive: 0, diligence: 0, boldness: 0, warmth: 3, empathy: 0, composure: -3 };
  const warmed = driftPersonality(base, "persuade", "up");
  assert.equal(warmed.warmth, 3);
  assert.equal(warmed.empathy, 1);
  const cowed = driftPersonality(base, "intimidate", "down");
  assert.equal(cowed.composure, -3);
  assert.equal(cowed.warmth, 2);
});

test("bond shift creates then moves and clamps", () => {
  let bonds = shiftBond([], "c1", "up");
  assert.deepEqual(bonds, [{ characterId: "c1", score: 1 }]);
  for (let index = 0; index < 5; index += 1) {
    bonds = shiftBond(bonds, "c1", "up");
  }
  assert.equal(bonds[0].score, 3);
  bonds = shiftBond(bonds, "c2", "down");
  assert.deepEqual(bonds[1], { characterId: "c2", score: -1 });
});

test("relation shift is directed and noted", () => {
  let relations = shiftRelation([], "Brekk", -1, "rival");
  assert.deepEqual(relations, [{ npcName: "Brekk", score: -1, note: "rival" }]);
  relations = shiftRelation(relations, "brekk", -1);
  assert.equal(relations[0].score, -2);
});

test("goal advancement respects the DC and personality modifier", () => {
  const goal = { text: "seize the mill", progress: 0, target: 2 };
  const stall = advanceSessionGoal(goal, null, 11);
  assert.equal(stall.advanced, false);
  assert.equal(stall.goal.progress, 0);
  const driven = { drive: 3, diligence: 0, boldness: 2, warmth: 0, empathy: 0, composure: 0 };
  const push = advanceSessionGoal(goal, driven, 8);
  assert.equal(push.advanced, true);
  assert.equal(push.completed, false);
  const done = advanceSessionGoal(push.goal, driven, 20);
  assert.equal(done.completed, true);
});

test("collisions need a shared significant token", () => {
  const collisions = detectGoalCollisions([
    { name: "Marla", goalText: "seize the Dunfall mill" },
    { name: "Brekk", goalText: "buy the mill at Dunfall" },
    { name: "Aldous", goalText: "translate the codex" },
  ]);
  assert.equal(collisions.length, 1);
  assert.equal(collisions[0].a, "Marla");
  assert.equal(collisions[0].b, "Brekk");
  assert.deepEqual(
    detectGoalCollisions([
      { name: "A", goalText: "win the tourney" },
      { name: "B", goalText: "rob the vault" },
    ]),
    [],
  );
});

test("pressure ticks, resets on engagement, and caps", () => {
  let pressure = { ignored: 0, engaged: 0 };
  pressure = tickPressure(pressure, false);
  assert.equal(pressureState(pressure), null);
  pressure = tickPressure(pressure, false);
  assert.equal(pressureState(pressure), "ignored");
  pressure = tickPressure(pressure, true);
  assert.equal(pressure.ignored, 0);
  for (let index = 0; index < 12; index += 1) {
    pressure = tickPressure(pressure, true);
  }
  assert.equal(pressure.engaged, 9);
  assert.equal(pressureState(pressure), "engaged");
});

test("roster fragment is informative and bounded", () => {
  const fragment = agencyFragment(
    {
      personality: { drive: 3, diligence: 0, boldness: -2, warmth: 2, empathy: 0, composure: 0 },
      goals: { session: { text: "seize the mill", progress: 1, target: 3 } },
      relations: [{ npcName: "Brekk", score: -2 }],
      bonds: [
        { characterId: "c1", score: 2 },
        { characterId: "cx", score: 3 },
      ],
      pressure: { ignored: 3, engaged: 0 },
    },
    new Map([["c1", "Avery"]]),
  );
  assert.ok(fragment.includes("driven"));
  assert.ok(fragment.includes("not bold"));
  assert.ok(fragment.includes("Avery +2"));
  assert.ok(!fragment.includes("cx"));
  assert.ok(fragment.includes("seize the mill (1/3)"));
  assert.ok(fragment.includes("Brekk -2"));
  assert.ok(fragment.includes("ignored"));
  assert.ok(fragment.length <= 400);
});

test("empty agency renders an empty fragment", () => {
  const fragment = agencyFragment(
    { personality: null, goals: {}, relations: [], bonds: [], pressure: { ignored: 0, engaged: 0 } },
    new Map(),
  );
  assert.equal(fragment, "");
});

console.log(`${passed} npc agency tests passed`);
