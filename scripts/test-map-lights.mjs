// Lights placed by hand: a tile and two radii, cleaned into something the
// light model can run, and a toggle that places or removes one. See
// docs/workshop-parity-audit.md phase 10.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { LIGHT_LIMITS, LIGHT_PRESETS, describeLight, normalizeLights, toggleLight } = await import(
  "../src/lib/battlemap/lights.ts"
);

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

const WIDTH = 10;
const HEIGHT = 6;
function room() {
  const tiles = [];
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      tiles.push(x === 0 || y === 0 || x === WIDTH - 1 || y === HEIGHT - 1 ? "#" : ".");
    }
  }
  return tiles.join("");
}

test("every preset is inside the limits and dim is never smaller than bright", () => {
  for (const preset of LIGHT_PRESETS) {
    assert.ok(preset.brightRadius >= LIGHT_LIMITS.minRadius);
    assert.ok(preset.dimRadius <= LIGHT_LIMITS.maxRadius);
    assert.ok(preset.dimRadius >= preset.brightRadius);
    assert.ok(describeLight(preset).includes("ft"));
  }
});

test("normalizeLights drops what is off the map, clamps radii and dedupes tiles", () => {
  const lights = normalizeLights(
    [
      { x: 2, y: 2, brightRadius: 4, dimRadius: 8 },
      { x: 2, y: 2, brightRadius: 1, dimRadius: 2 },
      { x: 40, y: 2, brightRadius: 4, dimRadius: 8 },
      { x: 3, y: 3, brightRadius: 99, dimRadius: 1 },
      { x: 4, y: 4 },
      "not a light",
      null,
    ],
    WIDTH,
    HEIGHT,
  );
  assert.equal(lights.length, 3);
  assert.deepEqual(lights[0], { x: 2, y: 2, brightRadius: 4, dimRadius: 8 });
  assert.equal(lights[1].brightRadius, LIGHT_LIMITS.maxRadius);
  assert.ok(lights[1].dimRadius >= lights[1].brightRadius);
  assert.deepEqual(lights[2], { x: 4, y: 4, brightRadius: 4, dimRadius: 8 });
  assert.deepEqual(normalizeLights("nope", WIDTH, HEIGHT), []);
});

test("normalizeLights caps the list", () => {
  const many = [];
  for (let i = 0; i < 100; i += 1) {
    many.push({ x: 1 + (i % 8), y: 1 + Math.floor(i / 8) % 4, brightRadius: 2, dimRadius: 4 });
  }
  assert.ok(normalizeLights(many, 64, 64).length <= LIGHT_LIMITS.max);
});

test("toggling an empty floor tile places a light; toggling it again removes it", () => {
  const first = toggleLight([], { x: 3, y: 3, brightRadius: 4, dimRadius: 8 }, room(), WIDTH, HEIGHT);
  assert.ok("lights" in first);
  assert.equal(first.placed, true);
  assert.equal(first.lights.length, 1);
  const second = toggleLight(first.lights, { x: 3, y: 3, brightRadius: 1, dimRadius: 2 }, room(), WIDTH, HEIGHT);
  assert.ok("lights" in second);
  assert.equal(second.placed, false);
  assert.equal(second.lights.length, 0);
});

test("a light cannot be placed in a wall, but one already there can be removed", () => {
  const refused = toggleLight([], { x: 0, y: 0, brightRadius: 4, dimRadius: 8 }, room(), WIDTH, HEIGHT);
  assert.ok("error" in refused);
  assert.ok(refused.error.includes("wall"));
  const stale = [{ x: 0, y: 0, brightRadius: 4, dimRadius: 8 }];
  const removed = toggleLight(stale, { x: 0, y: 0, brightRadius: 4, dimRadius: 8 }, room(), WIDTH, HEIGHT);
  assert.ok("lights" in removed);
  assert.equal(removed.lights.length, 0);
});

test("off the map is refused with that reason", () => {
  const outcome = toggleLight([], { x: 50, y: 3, brightRadius: 4, dimRadius: 8 }, room(), WIDTH, HEIGHT);
  assert.ok("error" in outcome);
  assert.ok(outcome.error.includes("off the map"));
});

test("the cap is enforced on placement and says so", () => {
  const full = [];
  for (let i = 0; i < LIGHT_LIMITS.max; i += 1) {
    full.push({ x: 1 + (i % 8), y: 1 + Math.floor(i / 8), brightRadius: 2, dimRadius: 4 });
  }
  const outcome = toggleLight(full, { x: 8, y: 4, brightRadius: 2, dimRadius: 4 }, room(), WIDTH, HEIGHT);
  assert.ok("error" in outcome);
  assert.ok(outcome.error.includes(String(LIGHT_LIMITS.max)));
});

console.log(`test-map-lights: ${passed} passed`);
