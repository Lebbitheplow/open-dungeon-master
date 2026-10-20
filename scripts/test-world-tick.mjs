// World tick engine: ramp math, statistical expected intervals with an
// injected RNG, encounter suppression, spark queue behavior, quiet
// timeskips, and state (de)serialization.
import assert from "node:assert/strict";
import {
  DEFAULT_TICK_CONFIG,
  drainSparks,
  emptyTickState,
  encounterChance,
  pacedTickConfig,
  parseTickState,
  surpriseChance,
  tickWorld,
  tickWorldQuietly,
  worldArcChance,
} from "../src/lib/dm/world-tick-logic.ts";
import { normalizeWorldArcs } from "../src/lib/dm/world-arc-logic.ts";

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

// Deterministic LCG so statistical checks are reproducible.
function makeRng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

const config = DEFAULT_TICK_CONFIG;

const arcFixture = () =>
  normalizeWorldArcs([
    {
      name: "The Summoning",
      driver: "cult",
      rungs: ["whisper", "omen", "beacon", "exodus", "dark"],
    },
  ]);

test("ramps grow and cap", () => {
  assert.equal(surpriseChance(0, config), config.surprise.base);
  assert.ok(surpriseChance(10, config) > surpriseChance(1, config));
  assert.equal(surpriseChance(1000, config), config.surprise.cap);
  assert.equal(encounterChance(config.encounter.grace - 1, config), 0);
  assert.equal(encounterChance(1000, config), config.encounter.cap);
  const arc = arcFixture()[0];
  assert.equal(worldArcChance(arc, 0, config), arc.cadence);
  assert.equal(worldArcChance(arc, 1000, config), config.worldArcCap);
});

test("state round-trips and tolerates garbage", () => {
  assert.deepEqual(parseTickState(""), emptyTickState());
  assert.deepEqual(parseTickState("not json"), emptyTickState());
  const state = {
    turnCount: 7,
    sinceSurprise: 3,
    sinceEncounter: 5,
    arcWaits: { wa1: 4 },
    sparks: [{ kind: "surprise", text: "x" }],
  };
  const parsed = parseTickState(JSON.stringify(state));
  assert.deepEqual(parsed, state);
  const bad = parseTickState(
    JSON.stringify({ turnCount: -3, sparks: [{ kind: "bogus", text: "y" }, { kind: "world" }] }),
  );
  assert.equal(bad.turnCount, 0);
  assert.deepEqual(bad.sparks, []);
});

test("a tick increments counters and fires nothing when rolls are high", () => {
  const result = tickWorld(emptyTickState(), arcFixture(), { inEncounter: false }, () => 0.999);
  assert.equal(result.state.turnCount, 1);
  assert.equal(result.state.sinceSurprise, 1);
  assert.deepEqual(result.state.sparks, []);
  assert.deepEqual(result.reachedRungs, []);
});

test("a guaranteed roll fires surprise and the world arc, and resets counters", () => {
  const result = tickWorld(emptyTickState(), arcFixture(), { inEncounter: false }, () => 0);
  assert.equal(result.state.sinceSurprise, 0);
  const kinds = result.state.sparks.map((spark) => spark.kind).sort();
  // Encounter is inside its grace window on turn 1, so it cannot fire.
  assert.deepEqual(kinds, ["surprise", "world"]);
  assert.equal(result.reachedRungs.length, 1);
  assert.equal(result.reachedRungs[0].rung, "whisper");
  assert.equal(result.worldArcs[0].rung, 0);
});

test("combat suppresses the encounter engine and freezes its clock", () => {
  let state = { ...emptyTickState(), sinceEncounter: 50 };
  const result = tickWorld(state, [], { inEncounter: true }, () => 0);
  assert.equal(result.state.sinceEncounter, 50);
  assert.ok(!result.state.sparks.some((spark) => spark.kind === "encounter"));
});

test("sparks replace per kind and the queue stays bounded", () => {
  let state = emptyTickState();
  for (let index = 0; index < 5; index += 1) {
    state = tickWorld(state, arcFixture(), { inEncounter: false }, () => 0).state;
  }
  assert.ok(state.sparks.length <= 3);
  assert.equal(state.sparks.filter((spark) => spark.kind === "surprise").length, 1);
  assert.deepEqual(drainSparks(state).sparks, []);
});

test("statistical expected intervals land in sane ranges", () => {
  const rng = makeRng(42);
  const runs = 3000;
  let surpriseTotal = 0;
  for (let run = 0; run < runs; run += 1) {
    let state = emptyTickState();
    let turns = 0;
    for (;;) {
      turns += 1;
      const result = tickWorld(state, [], { inEncounter: false }, rng);
      state = result.state;
      if (state.sinceSurprise === 0) {
        break;
      }
      if (turns > 500) {
        break;
      }
      state.sparks = [];
    }
    surpriseTotal += turns;
  }
  const surpriseMean = surpriseTotal / runs;
  assert.ok(
    surpriseMean > 8 && surpriseMean < 35,
    `surprise mean interval ${surpriseMean.toFixed(1)} out of range`,
  );
});

test("world arcs advance on a believable timescale", () => {
  const rng = makeRng(7);
  const runs = 1500;
  let total = 0;
  for (let run = 0; run < runs; run += 1) {
    let state = emptyTickState();
    let arcs = arcFixture();
    let turns = 0;
    while (arcs[0].rung < 0 && turns < 500) {
      turns += 1;
      const result = tickWorld(state, arcs, { inEncounter: false }, rng);
      state = { ...result.state, sparks: [] };
      arcs = result.worldArcs;
    }
    total += turns;
  }
  const mean = total / runs;
  assert.ok(mean > 10 && mean < 60, `world arc mean interval ${mean.toFixed(1)} out of range`);
});

test("quiet timeskips advance the world but queue no surprise/encounter sparks", () => {
  const result = tickWorldQuietly(emptyTickState(), arcFixture(), 5, () => 0);
  assert.equal(result.state.turnCount, 5);
  assert.ok(result.reachedRungs.length >= 1);
  assert.ok(result.state.sparks.every((spark) => spark.kind === "world"));
});

test("tick count is clamped on timeskips", () => {
  const result = tickWorldQuietly(emptyTickState(), [], 99, () => 0.999);
  assert.equal(result.state.turnCount, 12);
});

// Issue #432: a table's combat pace moves the encounter dice and what the
// spark asks for. The mean turns to the first encounter spark, with the
// surprise and world engines left out of the count.
function meanEncounterInterval(config, seed) {
  const rng = makeRng(seed);
  const runs = 3000;
  let total = 0;
  for (let run = 0; run < runs; run += 1) {
    let state = emptyTickState();
    let turns = 0;
    for (;;) {
      turns += 1;
      const result = tickWorld(state, [], { inEncounter: false }, rng, config);
      state = { ...result.state, sparks: [] };
      if (state.sinceEncounter === 0 || turns > 1000) {
        break;
      }
    }
    total += turns;
  }
  return total / runs;
}

test("combat pace: balanced is the config as given; fewer fights waits longer and more fights comes sooner", () => {
  assert.equal(pacedTickConfig(DEFAULT_TICK_CONFIG, "balanced"), DEFAULT_TICK_CONFIG);
  assert.equal(pacedTickConfig(DEFAULT_TICK_CONFIG, undefined), DEFAULT_TICK_CONFIG);
  const rare = meanEncounterInterval(pacedTickConfig(DEFAULT_TICK_CONFIG, "rare"), 11);
  const balanced = meanEncounterInterval(DEFAULT_TICK_CONFIG, 11);
  const frequent = meanEncounterInterval(pacedTickConfig(DEFAULT_TICK_CONFIG, "frequent"), 11);
  assert.ok(balanced > 25 && balanced < 45, `balanced ${balanced.toFixed(1)}`);
  assert.ok(rare > balanced * 1.4, `rare ${rare.toFixed(1)} vs balanced ${balanced.toFixed(1)}`);
  assert.ok(frequent < balanced * 0.75, `frequent ${frequent.toFixed(1)} vs balanced ${balanced.toFixed(1)}`);
});

test("combat pace: the spark asks for a fight at a frequent table and for a way past at a rare one", () => {
  const sparkOf = (config) =>
    tickWorld({ ...emptyTickState(), sinceEncounter: 200 }, [], { inEncounter: false }, () => 0, config).state.sparks.find(
      (spark) => spark.kind === "encounter",
    ).text;
  assert.match(sparkOf(DEFAULT_TICK_CONFIG), /It need not be hostile/);
  assert.match(sparkOf(pacedTickConfig(DEFAULT_TICK_CONFIG, "frequent")), /wants a fight/);
  assert.match(sparkOf(pacedTickConfig(DEFAULT_TICK_CONFIG, "rare")), /talk, sneak or bargain past/);
  // The server's own knobs still set the middle: a paced config scales them.
  const tuned = { ...DEFAULT_TICK_CONFIG, encounter: { grace: 30, slope: 4, cap: 200 } };
  assert.deepEqual(pacedTickConfig(tuned, "frequent").encounter, { grace: 15, slope: 8, cap: 400 });
  assert.deepEqual(pacedTickConfig(tuned, "rare").encounter, { grace: 60, slope: 2, cap: 100 });
});

console.log(`${passed} world tick tests passed`);
