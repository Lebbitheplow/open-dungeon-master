// Procedural battle-map generation: determinism, borders, spawn
// connectivity, and steering by the place's scene kind.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { generateBattleMap, fnv1a, mulberry32 } = await import("../src/lib/battlemap/generate.ts");
const { TERRAIN, tileIndex } = await import("../src/lib/battlemap/types.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

const base = { seed: fnv1a("encounter-1"), pcCount: 4, enemyCount: 3 };

test("same seed generates identical maps", () => {
  const a = generateBattleMap({ ...base, scene: "crypt" });
  const b = generateBattleMap({ ...base, scene: "crypt" });
  assert.equal(a.terrain, b.terrain);
  assert.deepEqual(a.pcSpawns, b.pcSpawns);
  assert.deepEqual(a.enemySpawns, b.enemySpawns);
});

test("different seeds differ", () => {
  const a = generateBattleMap({ ...base, scene: "plains" });
  const b = generateBattleMap({ ...base, seed: fnv1a("encounter-2"), scene: "plains" });
  assert.notEqual(a.terrain, b.terrain);
});

test("borders are walls", () => {
  const map = generateBattleMap({ ...base, scene: "forest" });
  for (let x = 0; x < map.width; x += 1) {
    assert.equal(map.terrain[tileIndex(map.width, x, 0)], TERRAIN.wall);
    assert.equal(map.terrain[tileIndex(map.width, x, map.height - 1)], TERRAIN.wall);
  }
  for (let y = 0; y < map.height; y += 1) {
    assert.equal(map.terrain[tileIndex(map.width, 0, y)], TERRAIN.wall);
    assert.equal(map.terrain[tileIndex(map.width, map.width - 1, y)], TERRAIN.wall);
  }
});

test("requested spawn counts are honored", () => {
  for (const scene of ["cave", "swamp", "tavern", "river", null]) {
    const map = generateBattleMap({ ...base, scene });
    assert.equal(map.pcSpawns.length, 4, scene);
    assert.equal(map.enemySpawns.length, 3, scene);
  }
});

test("all spawns are mutually reachable", () => {
  for (const seedText of ["e1", "e2", "e3", "e4", "e5"]) {
    const map = generateBattleMap({ ...base, seed: fnv1a(seedText), scene: "cave" });
    const seen = new Set();
    const queue = [map.pcSpawns[0]];
    seen.add(tileIndex(map.width, map.pcSpawns[0].x, map.pcSpawns[0].y));
    while (queue.length) {
      const { x, y } = queue.shift();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx;
        const ny = y + dy;
        const idx = tileIndex(map.width, nx, ny);
        if (
          nx >= 0 && ny >= 0 && nx < map.width && ny < map.height &&
          !seen.has(idx) && map.terrain[idx] !== TERRAIN.wall
        ) {
          seen.add(idx);
          queue.push({ x: nx, y: ny });
        }
      }
    }
    for (const spot of [...map.pcSpawns, ...map.enemySpawns]) {
      assert.ok(seen.has(tileIndex(map.width, spot.x, spot.y)), `${seedText} spawn unreachable`);
    }
  }
});

test("the scene kind shapes terrain, light and rough ground", () => {
  const cave = generateBattleMap({ ...base, scene: "cave" });
  assert.equal(cave.theme, "cave");
  assert.equal(cave.ambient, "dark");
  const swamp = generateBattleMap({ ...base, scene: "swamp" });
  assert.ok(swamp.terrain.includes(TERRAIN.water));
  const day = generateBattleMap({ ...base, scene: "plains" });
  assert.equal(day.ambient, "bright");
  assert.equal(day.lights.length, 0);
  const tavern = generateBattleMap({ ...base, scene: "tavern" });
  assert.equal(tavern.theme, "interior");
  assert.equal(tavern.ambient, "dim");
  // A place nobody classified is an open field.
  assert.equal(generateBattleMap({ ...base, scene: null }).theme, "field");
  // Rough ground: a desert is the same field with more of it.
  const rough = (scene) => [...generateBattleMap({ ...base, scene }).terrain].filter((ch) => ch === TERRAIN.difficult).length;
  assert.ok(rough("desert") > rough("plains"));
  // A person building a map on purpose outranks the scene.
  const told = generateBattleMap({ ...base, scene: "cave", theme: "forest", ambient: "bright" });
  assert.equal(told.theme, "forest");
  assert.equal(told.ambient, "bright");
});

test("spawns never sit on walls or stack", () => {
  const map = generateBattleMap({ ...base, scene: "dungeon" });
  const taken = new Set();
  for (const spot of [...map.pcSpawns, ...map.enemySpawns]) {
    const idx = tileIndex(map.width, spot.x, spot.y);
    assert.notEqual(map.terrain[idx], TERRAIN.wall);
    assert.ok(!taken.has(idx));
    taken.add(idx);
  }
});

test("mulberry32 is deterministic", () => {
  const a = mulberry32(42);
  const b = mulberry32(42);
  for (let i = 0; i < 10; i += 1) {
    assert.equal(a(), b());
  }
});

console.log(`test-battlemap-generate: ${passed} tests passed.`);
