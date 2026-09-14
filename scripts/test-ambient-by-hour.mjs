// The hour lights the map (docs/vtt-parity-implementation-plan.md section
// 2.2): an outdoor board takes its light from the clock and the sky, an
// indoor one keeps what the author set, and rain and fog shorten how far
// anyone sees through the vision engine.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { effectiveAmbient, outdoorsForTheme, resolveOutdoors, skyLight } = await import(
  "../src/lib/battlemap/daylight.ts"
);
const { visibleTiles } = await import("../src/lib/battlemap/los.ts");
const { tileIndex } = await import("../src/lib/battlemap/types.ts");
const { normalizeClock } = await import("../src/lib/dm/calendar.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

const clear = { sky: "clear", temperature: "mild", wind: "calm", precipitation: 0 };
const storm = { sky: "storm", temperature: "cold", wind: "gale", precipitation: 3 };
const overcast = { sky: "overcast", temperature: "mild", wind: "calm", precipitation: 0 };

test("themes decide the roof unless the author did", () => {
  assert.equal(outdoorsForTheme("cave"), false);
  assert.equal(outdoorsForTheme("interior"), false);
  assert.equal(outdoorsForTheme("forest"), true);
  assert.equal(outdoorsForTheme("field"), true);
  assert.equal(resolveOutdoors(null, "cave"), false);
  assert.equal(resolveOutdoors(1, "cave"), true, "an author can open a cave to the sky");
  assert.equal(resolveOutdoors(0, "forest"), false, "or roof a forest");
  assert.equal(resolveOutdoors(undefined, "swamp"), true);
});

test("the sky lights the hour: night dark, dawn and dusk dim, day bright", () => {
  assert.equal(skyLight(2, null), "dark");
  assert.equal(skyLight(6, null), "dim");
  assert.equal(skyLight(9, null), "bright");
  assert.equal(skyLight(14, null), "bright");
  assert.equal(skyLight(18, null), "dim");
  assert.equal(skyLight(20, null), "dim");
  assert.equal(skyLight(23, null), "dark");
});

test("an overcast or a storm caps daylight at dim and never brightens the night", () => {
  assert.equal(skyLight(12, overcast), "dim");
  assert.equal(skyLight(12, storm), "dim");
  assert.equal(skyLight(12, clear), "bright");
  assert.equal(skyLight(1, storm), "dark");
  assert.equal(skyLight(6, storm), "dim");
});

test("indoor maps keep their authored light; outdoor maps take the sky's", () => {
  assert.equal(effectiveAmbient("bright", false, 2, null), "bright");
  assert.equal(effectiveAmbient("dark", false, 12, clear), "dark");
  assert.equal(effectiveAmbient("bright", true, 2, null), "dark");
  assert.equal(effectiveAmbient("dark", true, 12, clear), "bright", "the author's dark is overruled at noon outdoors");
});

// An open 20 by 5 field with the viewer at the left end.
const WIDTH = 20;
const HEIGHT = 5;
const FIELD = ".".repeat(WIDTH * HEIGHT);
const viewer = { x: 1, y: 2, darkvisionTiles: 0 };

test("rain and fog shorten sight through the vision engine", () => {
  const base = { terrain: FIELD, width: WIDTH, height: HEIGHT, ambient: "bright" };
  const clearDay = visibleTiles(base, viewer, [], []);
  assert.ok(clearDay.has(tileIndex(WIDTH, 18, 2)), "a clear day shows the far end");
  const rain = visibleTiles({ ...base, obscureBeyond: 12 }, viewer, [], []);
  assert.ok(rain.has(tileIndex(WIDTH, 12, 2)), "60 ft is still in view");
  assert.ok(!rain.has(tileIndex(WIDTH, 18, 2)), "past 60 ft the rain hides it");
  const fog = visibleTiles({ ...base, obscureBeyond: 6 }, viewer, [], []);
  assert.ok(fog.has(tileIndex(WIDTH, 7, 2)));
  assert.ok(!fog.has(tileIndex(WIDTH, 9, 2)), "past 30 ft the fog hides it");
  // A torch out there is still seen: lit tiles show through dim air.
  const lantern = visibleTiles({ ...base, obscureBeyond: 6 }, viewer, [], [
    { x: 15, y: 2, brightRadius: 1, dimRadius: 2 },
  ]);
  assert.ok(lantern.has(tileIndex(WIDTH, 15, 2)), "a lit tile shows through the fog");
  // Darkvision reaches through it as through any dim light.
  const owl = visibleTiles({ ...base, obscureBeyond: 6 }, { ...viewer, darkvisionTiles: 12 }, [], []);
  assert.ok(owl.has(tileIndex(WIDTH, 12, 2)));
});

test("the clock stores weather and old clocks read as none", () => {
  const old = normalizeClock({ instant: 1000 });
  assert.equal(old.weather, null);
  const stored = normalizeClock({ instant: 1000, weather: storm });
  assert.deepEqual(stored.weather, storm);
});

console.log(`test-ambient-by-hour: ${passed} passed`);
