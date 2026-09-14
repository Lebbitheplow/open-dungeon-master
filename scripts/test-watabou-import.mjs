// Watabou imports (docs/vtt-parity-implementation-plan.md 12.2): a One
// Page Dungeon export becomes walls, floors, doors and DM-only labels; a
// City Generator GeoJSON becomes roads, a river and district labels fitted
// around a place on the region map.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const here = path.dirname(fileURLToPath(import.meta.url));
const dungeonFile = JSON.parse(readFileSync(path.join(here, "fixtures", "watabou-dungeon.json"), "utf8"));
const cityFile = JSON.parse(readFileSync(path.join(here, "fixtures", "watabou-city.geojson"), "utf8"));

const { isOnePageDungeon, isWatabouCity, parseOnePageDungeon, parseWatabouCity, WATABOU_LIMITS } = await import("../src/lib/battlemap/watabou.ts");
const { TERRAIN } = await import("../src/lib/battlemap/types.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

test("the two exports are told apart, and from anything else", () => {
  assert.ok(isOnePageDungeon(dungeonFile));
  assert.ok(!isOnePageDungeon(cityFile));
  assert.ok(isWatabouCity(cityFile));
  assert.ok(!isWatabouCity(dungeonFile));
  assert.ok(!isWatabouCity({ type: "FeatureCollection", features: [{ type: "Feature", properties: { id: 1, height: 20 } }] }));
});

test("rooms become floor inside a wall, doors sit between, notes land as DM labels", () => {
  const parsed = parseOnePageDungeon(dungeonFile);
  assert.ok(!("error" in parsed), parsed.error);
  const { map } = parsed;
  // The rects span 0..15 by 0..12, plus a tile of wall each side.
  assert.equal(map.width, 17);
  assert.equal(map.height, 14);
  const at = (x, y) => map.terrain[y * map.width + x];
  assert.equal(at(0, 0), TERRAIN.wall);
  assert.equal(at(1, 1), TERRAIN.floor);
  assert.equal(at(7, 3), TERRAIN.door);
  assert.equal(at(3, 6), TERRAIN.door);
  assert.equal(at(12, 3), TERRAIN.floor);
  assert.equal(map.title, "The Sunken Vault");
  assert.equal(map.ambient, "dark");
  assert.equal(map.labels.length, 2);
  assert.ok(map.labels.every((label) => label.dmOnly));
  assert.deepEqual(map.labels[0], { x: 13, y: 4, text: "A drowned altar, still wet.", dmOnly: true });
  assert.match(map.notes[0], /5 rooms and passages, 2 doors/);
  assert.match(map.notes[1], /flooded once/);
});

test("a dungeon with no rooms, or one too big, is refused with a reason", () => {
  assert.match(parseOnePageDungeon({ rects: [] }).error, /no rooms/);
  assert.match(parseOnePageDungeon({ rects: [{ x: 0, y: 0, w: WATABOU_LIMITS.maxSide + 5, h: 10 }] }).error, /tiles a side/);
  assert.match(parseOnePageDungeon({ rects: [{ x: 0, y: 0, w: 2, h: 2 }] }).error, /too small/);
});

test("a city fits into a box around its place: roads, a river and district labels", () => {
  const parsed = parseWatabouCity(cityFile, { width: 60, height: 40 }, { x: 30, y: 20 }, 12);
  assert.ok(!("error" in parsed), parsed.error);
  const { city } = parsed;
  assert.equal(city.name, "Harrowgate");
  assert.equal(city.paths.filter((path) => path.kind === "road").length, 2);
  assert.equal(city.paths.filter((path) => path.kind === "river").length, 1);
  assert.deepEqual(city.labels.map((label) => label.text).sort(), ["Old Quarter", "Tanners' Row"]);
  for (const path of city.paths) {
    for (const point of path.points) {
      assert.ok(point.x >= 24 && point.x <= 36 && point.y >= 14 && point.y <= 26, `road point off the box: ${point.x},${point.y}`);
    }
  }
  assert.match(city.blurb, /2 districts, 2 roads/);
});

test("a city near the map's edge is clamped onto it", () => {
  const parsed = parseWatabouCity(cityFile, { width: 20, height: 20 }, { x: 1, y: 1 }, 12);
  assert.ok(!("error" in parsed));
  for (const path of parsed.city.paths) {
    for (const point of path.points) {
      assert.ok(point.x >= 0 && point.y >= 0 && point.x <= 19 && point.y <= 19);
    }
  }
  assert.match(parseWatabouCity({ type: "FeatureCollection", features: [] }, { width: 20, height: 20 }, { x: 1, y: 1 }).error, /not a city/);
});

console.log(`watabou-import: ${passed} tests passed`);
