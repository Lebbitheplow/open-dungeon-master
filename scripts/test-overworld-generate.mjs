// Overworld generation: seed determinism, terrain classification sanity,
// genre reskins, and anchor placement rules.
import assert from "node:assert/strict";
import {
  OVERWORLD_HEIGHT,
  OVERWORLD_WIDTH,
  generateOverworldTerrain,
  placeAnchor,
  skinForGenre,
  tileAt,
  tileJitter,
} from "../src/lib/overworld/logic.ts";

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

test("terrain is deterministic under a seed and differs across seeds", () => {
  const a = generateOverworldTerrain(1234);
  const b = generateOverworldTerrain(1234);
  const c = generateOverworldTerrain(9999);
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.equal(a.length, OVERWORLD_WIDTH * OVERWORLD_HEIGHT);
});

test("terrain uses only known tiles and has a sane land/water mix", () => {
  for (const seed of [1, 42, 77777]) {
    const terrain = generateOverworldTerrain(seed);
    assert.ok(/^[wpfhms]+$/.test(terrain));
    const water = [...terrain].filter((tile) => tile === "w").length;
    const ratio = water / terrain.length;
    assert.ok(ratio > 0.02 && ratio < 0.85, `seed ${seed} water ratio ${ratio}`);
    // Some walkable land must exist for anchors.
    assert.ok([...terrain].some((tile) => tile === "p" || tile === "f" || tile === "h"));
  }
});

test("skinForGenre overrides labels but always covers every tile", () => {
  const base = skinForGenre("high_fantasy");
  const cyber = skinForGenre("cyberpunk");
  for (const tile of ["w", "p", "f", "h", "m", "s"]) {
    assert.ok(base[tile].label && base[tile].fill.startsWith("#"));
    assert.ok(cyber[tile].label && cyber[tile].fill.startsWith("#"));
  }
  assert.equal(cyber.m.label, "Arcologies");
  assert.equal(skinForGenre("unknown_genre").p.label, "Plains");
});

test("placeAnchor avoids water/mountain, stays in bounds, spreads out", () => {
  const terrain = generateOverworldTerrain(555);
  const existing = [];
  let connected = null;
  for (const name of ["Emberfall", "The Sunken Mill", "Karrag's Rest", "Old Docks", "Wyrm Gate"]) {
    const anchor = placeAnchor({
      terrain,
      width: OVERWORLD_WIDTH,
      height: OVERWORLD_HEIGHT,
      existing,
      connected,
      name,
    });
    assert.ok(anchor.x >= 0 && anchor.x < OVERWORLD_WIDTH);
    assert.ok(anchor.y >= 0 && anchor.y < OVERWORLD_HEIGHT);
    const tile = tileAt(terrain, OVERWORLD_WIDTH, anchor.x, anchor.y);
    assert.ok(tile !== "w" && tile !== "m", `anchor for ${name} landed on ${tile}`);
    for (const other of existing) {
      assert.ok(
        Math.abs(other.x - anchor.x) > 1 || Math.abs(other.y - anchor.y) > 1,
        `anchor for ${name} overlaps another`,
      );
    }
    existing.push(anchor);
    connected = anchor;
  }
});

test("placeAnchor is deterministic per name", () => {
  const terrain = generateOverworldTerrain(321);
  const input = {
    terrain,
    width: OVERWORLD_WIDTH,
    height: OVERWORLD_HEIGHT,
    existing: [],
    connected: null,
    name: "Emberfall",
  };
  assert.deepEqual(placeAnchor(input), placeAnchor(input));
});

test("tileJitter is bounded and deterministic", () => {
  for (let index = 0; index < 50; index += 1) {
    const jitter = tileJitter(index, index * 3);
    assert.ok(Math.abs(jitter) <= 0.06);
    assert.equal(jitter, tileJitter(index, index * 3));
  }
});

console.log(`test-overworld-generate: ${passed} tests passed`);
