// The per-map lit set cache behind buildPlayerMapView: the cached answer is
// the uncached one, a second member's projection reuses it, and any change
// to what light depends on (terrain, fixed lights, carried lights) misses.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { litTiles } = await import("../src/lib/battlemap/los.ts");
const { cachedLitTiles, clearLitTilesCache, litTilesCacheSize, litTilesKey } = await import(
  "../src/lib/battlemap/lit-cache.ts"
);

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`ok: ${name}`);
}

function makeMap(id, rows, ambient = "dark") {
  const width = rows[0].length;
  return { id, terrain: rows.join(""), width, height: rows.length, ambient, zones: [] };
}

function token(id, x, y, lightRadius, extra = {}) {
  return {
    id,
    kind: "pc",
    refId: `sheet-${id}`,
    name: id,
    x,
    y,
    movedThisRound: 0,
    lightRadius,
    burnsUntil: 0,
    lightMinutes: 0,
    hidden: false,
    movement: "walk",
    ...extra,
  };
}

const crypt = makeMap("crypt", [
  "############",
  "#..........#",
  "#....#.....#",
  "#....#.....#",
  "#..........#",
  "############",
]);
const lights = [{ x: 9, y: 1, brightRadius: 1, dimRadius: 2 }];
const tokens = [token("torch", 2, 2, 2), token("dark", 8, 4, 0)];

const same = (a, b) => {
  assert.equal(a.size, b.size);
  for (const idx of a) {
    assert.ok(b.has(idx));
  }
};

test("the cached lit set equals the one computed directly", () => {
  clearLitTilesCache();
  const direct = litTiles(crypt, tokens, lights);
  const cached = cachedLitTiles(crypt, tokens, lights);
  same(direct, cached);
  assert.ok(cached.size > 0);
});

test("a second projection of the same board reuses the set", () => {
  clearLitTilesCache();
  const first = cachedLitTiles(crypt, tokens, lights);
  // A different member: same map, fresh token objects with the same facts.
  const again = cachedLitTiles(
    { ...crypt },
    tokens.map((entry) => ({ ...entry })),
    lights.map((light) => ({ ...light })),
  );
  assert.equal(first, again);
  assert.equal(litTilesCacheSize(), 1);
});

test("a token without a light moving does not miss; a torch moving does", () => {
  clearLitTilesCache();
  const first = cachedLitTiles(crypt, tokens, lights);
  const unlitMoved = [tokens[0], token("dark", 3, 4, 0)];
  assert.equal(cachedLitTiles(crypt, unlitMoved, lights), first);
  const torchMoved = [token("torch", 7, 1, 2), tokens[1]];
  const next = cachedLitTiles(crypt, torchMoved, lights);
  assert.notEqual(next, first);
  same(next, litTiles(crypt, torchMoved, lights));
});

test("terrain, size, fixed lights and the map id all take part in the key", () => {
  const base = litTilesKey(crypt, tokens, lights);
  const opened = makeMap("crypt", [
    "############",
    "#..........#",
    "#..........#",
    "#....#.....#",
    "#..........#",
    "############",
  ]);
  assert.notEqual(litTilesKey(opened, tokens, lights), base);
  assert.notEqual(litTilesKey({ ...crypt, id: "other" }, tokens, lights), base);
  assert.notEqual(
    litTilesKey(crypt, tokens, [{ x: 9, y: 1, brightRadius: 2, dimRadius: 4 }]),
    base,
  );
  assert.notEqual(litTilesKey(crypt, tokens, []), base);
  // Order of carried lights does not matter.
  assert.equal(litTilesKey(crypt, [...tokens].reverse(), lights), base);
});

test("a cached set is still right after the terrain changes", () => {
  clearLitTilesCache();
  cachedLitTiles(crypt, tokens, lights);
  const walled = makeMap("crypt", [
    "############",
    "#..........#",
    "#...##.....#",
    "#....#.....#",
    "#..........#",
    "############",
  ]);
  same(cachedLitTiles(walled, tokens, lights), litTiles(walled, tokens, lights));
  assert.equal(litTilesCacheSize(), 2);
});

test("the cache is bounded", () => {
  clearLitTilesCache();
  for (let i = 0; i < 100; i += 1) {
    cachedLitTiles(makeMap(`map-${i}`, ["...", "...", "..."]), [token("t", 1, 1, 1)], []);
  }
  assert.ok(litTilesCacheSize() <= 32);
});

clearLitTilesCache();
console.log(`\n${passed} lit cache tests passed.`);
