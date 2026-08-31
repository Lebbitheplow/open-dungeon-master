// The overworld's parameter layer: the five dials a description turns into,
// and the promise that leaving them alone changes nothing.
import assert from "node:assert/strict";

const {
  DEFAULT_OVERWORLD_PARAMS,
  OVERWORLD_HEIGHT,
  OVERWORLD_WIDTH,
  OVERWORLD_PARAM_LABELS,
  fnv1a,
  generateOverworldTerrain,
  normalizeOverworldParams,
  parseOverworldPlan,
} = await import("../src/lib/overworld/logic.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

const share = (terrain, tile) =>
  [...terrain].filter((entry) => entry === tile).length / terrain.length;

test("every dial has a label and defaults to the middle", () => {
  for (const key of Object.keys(DEFAULT_OVERWORLD_PARAMS)) {
    assert.equal(DEFAULT_OVERWORLD_PARAMS[key], 0.5, key);
    assert.ok(OVERWORLD_PARAM_LABELS[key], `${key} has no label`);
  }
});

// The load-bearing one. Every campaign that already has a map rerolls under
// the defaults, so the defaults have to produce the world the classifier
// produced before the dials existed. These hashes are of the terrain the
// pre-parameter generator returned for these seeds.
test("the default dials reproduce the terrain the generator made before them", () => {
  assert.equal(fnv1a(generateOverworldTerrain(1234)), 3601703561);
  assert.equal(fnv1a(generateOverworldTerrain(99999)), 4019726223);
});

test("passing the defaults explicitly is the same as passing nothing", () => {
  assert.equal(
    generateOverworldTerrain(77, OVERWORLD_WIDTH, OVERWORLD_HEIGHT, DEFAULT_OVERWORLD_PARAMS),
    generateOverworldTerrain(77),
  );
});

test("terrain stays deterministic under a seed and a set of dials", () => {
  const dials = { ...DEFAULT_OVERWORLD_PARAMS, seaLevel: 0.7 };
  assert.equal(
    generateOverworldTerrain(5, OVERWORLD_WIDTH, OVERWORLD_HEIGHT, dials),
    generateOverworldTerrain(5, OVERWORLD_WIDTH, OVERWORLD_HEIGHT, dials),
  );
});

test("raising the sea drowns the map and lowering it drains it", () => {
  const dry = generateOverworldTerrain(11, OVERWORLD_WIDTH, OVERWORLD_HEIGHT, {
    ...DEFAULT_OVERWORLD_PARAMS,
    seaLevel: 0.1,
  });
  const wet = generateOverworldTerrain(11, OVERWORLD_WIDTH, OVERWORLD_HEIGHT, {
    ...DEFAULT_OVERWORLD_PARAMS,
    seaLevel: 0.9,
  });
  assert.ok(share(wet, "w") > share(dry, "w"), `${share(wet, "w")} vs ${share(dry, "w")}`);
});

test("the mountain dial raises peaks", () => {
  const flat = generateOverworldTerrain(11, OVERWORLD_WIDTH, OVERWORLD_HEIGHT, {
    ...DEFAULT_OVERWORLD_PARAMS,
    mountains: 0.1,
  });
  const alpine = generateOverworldTerrain(11, OVERWORLD_WIDTH, OVERWORLD_HEIGHT, {
    ...DEFAULT_OVERWORLD_PARAMS,
    mountains: 0.9,
  });
  assert.ok(share(alpine, "m") > share(flat, "m"));
});

test("the forest dial spreads woodland and aridity thins it", () => {
  const bare = generateOverworldTerrain(11, OVERWORLD_WIDTH, OVERWORLD_HEIGHT, {
    ...DEFAULT_OVERWORLD_PARAMS,
    forests: 0.1,
  });
  const wooded = generateOverworldTerrain(11, OVERWORLD_WIDTH, OVERWORLD_HEIGHT, {
    ...DEFAULT_OVERWORLD_PARAMS,
    forests: 0.9,
  });
  assert.ok(share(wooded, "f") > share(bare, "f"));

  const dry = generateOverworldTerrain(11, OVERWORLD_WIDTH, OVERWORLD_HEIGHT, {
    ...DEFAULT_OVERWORLD_PARAMS,
    aridity: 0.9,
  });
  assert.ok(share(dry, "f") < share(generateOverworldTerrain(11), "f"));
  assert.ok(share(dry, "s") <= share(generateOverworldTerrain(11), "s"));
});

test("every dialled world still uses only the known tiles", () => {
  for (const dials of [
    { seaLevel: 0, mountains: 0, forests: 0, aridity: 0, coastline: 0 },
    { seaLevel: 1, mountains: 1, forests: 1, aridity: 1, coastline: 1 },
  ]) {
    const terrain = generateOverworldTerrain(3, OVERWORLD_WIDTH, OVERWORLD_HEIGHT, dials);
    assert.ok(/^[wpfhms]+$/.test(terrain));
    assert.equal(terrain.length, OVERWORLD_WIDTH * OVERWORLD_HEIGHT);
  }
});

test("dials are clamped and missing ones fall back to the middle", () => {
  assert.deepEqual(normalizeOverworldParams({ seaLevel: 5, mountains: -2 }), {
    ...DEFAULT_OVERWORLD_PARAMS,
    seaLevel: 1,
    mountains: 0,
  });
  assert.deepEqual(normalizeOverworldParams(null), DEFAULT_OVERWORLD_PARAMS);
  assert.deepEqual(normalizeOverworldParams({ seaLevel: "wet" }), DEFAULT_OVERWORLD_PARAMS);
});

test("a described region reads out of the model's JSON, fences and all", () => {
  const plan = parseOverworldPlan(
    '```json\n{"params": {"seaLevel": 0.8, "forests": 0.2}, "places": [{"name": "Kestrel Reach", "blurb": "a whaling town"}, "Gale Rock"], "note": "storm coast"}\n```',
  );
  assert.equal(plan.params.seaLevel, 0.8);
  assert.equal(plan.params.forests, 0.2);
  // Untouched dials keep the middle rather than becoming zero.
  assert.equal(plan.params.mountains, 0.5);
  assert.deepEqual(plan.places, [
    { name: "Kestrel Reach", blurb: "a whaling town" },
    { name: "Gale Rock", blurb: "" },
  ]);
  assert.equal(plan.note, "storm coast");
});

test("prose either side of the object is tolerated, junk is not", () => {
  const plan = parseOverworldPlan('Here you go: {"params": {"aridity": 0.9}} Hope that helps.');
  assert.equal(plan.params.aridity, 0.9);
  assert.equal(parseOverworldPlan("no json here"), null);
  assert.equal(parseOverworldPlan("{not json}"), null);
  assert.equal(parseOverworldPlan(""), null);
});

test("a bare parameter object with no wrapper still reads", () => {
  const plan = parseOverworldPlan('{"seaLevel": 0.2, "mountains": 0.9}');
  assert.equal(plan.params.seaLevel, 0.2);
  assert.equal(plan.params.mountains, 0.9);
  assert.deepEqual(plan.places, []);
});

test("a described region cannot flood the map with places", () => {
  const places = new Array(20).fill(0).map((_, index) => ({ name: `Place ${index}` }));
  const plan = parseOverworldPlan(JSON.stringify({ params: {}, places }));
  assert.equal(plan.places.length, 8);
});

console.log(`overworld-params: ${passed} tests passed`);
