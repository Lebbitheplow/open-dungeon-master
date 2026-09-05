// A Fantasy Map Generator export becomes a region grid: cells to tiles by
// nearest centroid, burgs to places, rivers and routes to paths. See
// docs/workshop-parity-audit.md phase 15.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { importAzgaar, tileForCell, AZGAAR_LIMITS } = await import("../src/lib/overworld/azgaar.ts");
const { OVERWORLD_SIZE_LIMITS } = await import("../src/lib/overworld/features.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

// A square cell of side 10 with its corner at (x, y), in map pixels.
function cell(x, y, height, biome) {
  return {
    type: "Feature",
    geometry: {
      type: "Polygon",
      coordinates: [[[x, y], [x + 10, y], [x + 10, y + 10], [x, y + 10], [x, y]]],
    },
    properties: { id: x * 100 + y, height, biome },
  };
}

// Ten by ten cells over a 100 by 100 pixel map: land on the left half,
// sea on the right, a peak in the middle of the land.
function cellsFile() {
  const features = [];
  for (let row = 0; row < 10; row += 1) {
    for (let column = 0; column < 10; column += 1) {
      const land = column < 5;
      const peak = column === 2 && row === 5;
      features.push(cell(column * 10, row * 10, peak ? 85 : land ? 40 : 8, land ? 6 : 0));
    }
  }
  return JSON.stringify({ type: "FeatureCollection", features });
}

const burgsFile = JSON.stringify({
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: { type: "Point", coordinates: [15, 15] },
      properties: { id: 1, name: "Harrowgate", capital: 1, type: "Generic", population: 12 },
    },
    {
      type: "Feature",
      geometry: { type: "Point", coordinates: [35, 85] },
      properties: { id: 2, name: "Saltmere", capital: 0, type: "Naval", population: 4 },
    },
    {
      type: "Feature",
      geometry: { type: "Point", coordinates: [36, 86] },
      properties: { id: 3, name: "saltmere", capital: 0, type: "Generic", population: 1 },
    },
  ],
});

const linesFile = JSON.stringify({
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: { type: "LineString", coordinates: [[15, 15], [25, 45], [35, 85]] },
      properties: { id: 1, group: "roads", name: "Kingsway" },
    },
    {
      type: "Feature",
      geometry: { type: "LineString", coordinates: [[60, 5], [90, 50]] },
      properties: { id: 2, group: "searoutes" },
    },
    {
      type: "Feature",
      geometry: { type: "LineString", coordinates: [[5, 5], [5, 95]] },
      properties: { id: 3, name: "Ashwater", discharge: 120, length: 90, type: "River" },
    },
  ],
});

test("a cell's height and biome pick its tile", () => {
  assert.equal(tileForCell(10, 6), "w");
  assert.equal(tileForCell(85, 6), "m");
  assert.equal(tileForCell(55, 6), "h");
  assert.equal(tileForCell(30, 12), "s");
  assert.equal(tileForCell(30, 6), "f");
  assert.equal(tileForCell(30, 4), "p");
});

test("cells become tiles by nearest centroid at the size asked for", () => {
  const result = importAzgaar([cellsFile()], { width: 40, height: 20 }, { width: 96, height: 72 });
  assert.ok(!("error" in result), result.error);
  assert.equal(result.width, 40);
  assert.equal(result.height, 20);
  assert.equal(result.terrain.length, 800);
  // Left half forest, right half water, the peak where the tall cell was.
  assert.equal(result.terrain[0], "f");
  assert.equal(result.terrain[39], "w");
  assert.equal(result.terrain[11 * 40 + 10], "m");
  // A size below the floor is lifted to it rather than refused.
  const tiny = importAzgaar([cellsFile()], { width: 4, height: 4 }, { width: 96, height: 72 });
  assert.equal(tiny.width, OVERWORLD_SIZE_LIMITS.minWidth);
  assert.equal(tiny.height, OVERWORLD_SIZE_LIMITS.minHeight);
  assert.equal(result.summary.cells, 100);
  assert.equal(result.paths.length, 0);
  assert.equal(result.places.length, 0);
});

test("burgs, rivers and routes come along from their own files", () => {
  const result = importAzgaar(
    [cellsFile(), burgsFile, linesFile],
    { width: 40, height: 20 },
    { width: 96, height: 72 },
  );
  assert.ok(!("error" in result), result.error);
  // The capital first, then by population, and one place per name.
  assert.deepEqual(
    result.places.map((place) => place.name),
    ["Harrowgate", "Saltmere"],
  );
  assert.deepEqual(result.places[0].at, { x: 6, y: 3 });
  assert.equal(result.places[0].blurb, "A capital.");
  assert.equal(result.places[1].blurb, "A naval settlement.");
  // The road and the river; the sea route stays at sea.
  assert.deepEqual(
    result.paths.map((path) => [path.kind, path.label]),
    [
      ["road", "Kingsway"],
      ["river", "Ashwater"],
    ],
  );
  assert.deepEqual(result.paths[0].points[0], { x: 6, y: 3 });
  assert.equal(result.summary.routes, 1);
  assert.equal(result.summary.rivers, 1);
  assert.equal(result.summary.burgs, 3);
});

test("longitude and latitude are read north-up", () => {
  const geographic = JSON.stringify({
    type: "FeatureCollection",
    features: [
      cell(0, 0, 40, 4),
      cell(1, 0, 40, 4),
      cell(0, 10, 85, 4),
      cell(1, 10, 85, 4),
    ].map((feature) => ({
      ...feature,
      geometry: {
        type: "Polygon",
        // Scaled down into the geographic range: lon 0..2, lat 0..20.
        coordinates: [feature.geometry.coordinates[0].map(([x, y]) => [x / 10, y])],
      },
    })),
  });
  const result = importAzgaar([geographic], { width: 24, height: 18 }, { width: 96, height: 72 });
  assert.ok(!("error" in result), result.error);
  // The high-latitude peaks land on the TOP rows, and four cells are enough
  // to cover a grid of hundreds of tiles: no tile is left as sea for want
  // of a nearby centroid.
  assert.equal(result.terrain.slice(0, 24), "m".repeat(24));
  assert.equal(result.terrain.slice(-24), "p".repeat(24));
  assert.ok(!result.terrain.includes("w"));
});

test("refusals say what was wrong", () => {
  const fallback = { width: 96, height: 72 };
  assert.match(importAzgaar([], {}, fallback).error, /one to/);
  assert.match(importAzgaar(["not json"], {}, fallback).error, /not GeoJSON/);
  assert.match(importAzgaar([burgsFile], {}, fallback).error, /Cells/);
  const huge = "x".repeat(AZGAAR_LIMITS.maxChars + 1);
  assert.match(importAzgaar([huge], {}, fallback).error, /too large/);
});

console.log(`test-azgaar-import: ${passed} passed`);
