// Issue 548, the region map after a made-up world's first twenty places:
// which places fold into a bigger one, which routes are drawn once they do,
// where a place lands when the DM says which way and how far, and where each
// name goes so none prints over another.
import assert from "node:assert/strict";
import {
  OVERWORLD_HEIGHT,
  OVERWORLD_WIDTH,
  generateOverworldTerrain,
  placeAnchor,
  tileAt,
} from "../src/lib/overworld/logic.ts";
import {
  nameWithin,
  normalizeDirection,
  normalizeDistance,
  parentsByName,
  placeNamedInside,
  placeTree,
  regionRoutes,
  resolveParents,
  spotFrom,
} from "../src/lib/overworld/places.ts";
import { boxesOverlap, layoutLabels, shortenLabel } from "../src/lib/overworld/label-layout.ts";

let passed = 0;
function test(name, fn) {
  try {
    fn();
  } catch (error) {
    error.message = `${name}: ${error.message}`;
    throw error;
  }
  passed += 1;
}

const place = (id, name, parentName = null, extra = {}) => ({ id, name, parentName, connections: [], anchor: null, ...extra });

// ---- which places are parts of which ----

test("A new place files under a place whose whole name its own opens with, the longest such place winning", () => {
  const places = [
    place("shrine", "Duskleaf Shrine"),
    place("hall", "Thornhollow Village Hall"),
    place("village", "Thornhollow Village"),
    place("road", "Duskleaf Road"),
  ];
  assert.equal(placeNamedInside("Duskleaf Shrine Root Cellar", places)?.id, "shrine");
  assert.equal(placeNamedInside("Thornhollow Village Hall Approach", places)?.id, "hall", "the hall, not the village");
  // Sharing a first word is not being inside: a shrine road is not the shrine's.
  assert.equal(placeNamedInside("Duskleaf Bridge", places), null);
  assert.equal(placeNamedInside("Duskleaf Shrine", places)?.id, undefined, "a place is not inside itself");
});

test("Only whole words count, case and accents folded the way places are compared", () => {
  const places = [place("thorn", "Thorn"), place("eglise", "Église Saint-Rémi")];
  assert.equal(placeNamedInside("Thornhollow Fair", places), null, "Thornhollow is not a part of Thorn");
  assert.equal(placeNamedInside("église saint-rémi crypt", places)?.id, "eglise");
});

test("The upgrade files a place's parts by name, but not a namesake whose dot stands far from the place", () => {
  const places = [
    place("shrine", "Duskleaf Shrine"),
    place("cellar", "Duskleaf Shrine Root Cellar"),
    place("ravenmoor", "Ravenmoor"),
    place("keep", "Ravenmoor Keep"),
    place("fair", "Thornhollow Fair"),
  ];
  const anchors = {
    shrine: { x: 20, y: 20 },
    cellar: { x: 25, y: 22 },
    ravenmoor: { x: 60, y: 40 },
    keep: { x: 60, y: 20 },
  };
  const filed = parentsByName(places, anchors);
  assert.equal(filed.get("cellar"), "Duskleaf Shrine");
  assert.equal(filed.has("keep"), false, "a keep twenty tiles from its city is a place of its own");
  assert.equal(filed.has("fair"), false);
  assert.equal(filed.size, 1);
  // Without anchors (never drawn) the name alone decides.
  assert.equal(parentsByName(places).get("keep"), "Ravenmoor");
});

test("Parents are read only from what was written: a name, \"\" or none is a place of its own, and a parent that is not a place leaves it on its own", () => {
  const parents = resolveParents([
    place("vault", "Hollowroot Vault"),
    place("woods", "Hollowroot Woods"),
    place("entrance", "Hollowroot Vault Entrance", "Hollowroot Woods"),
    place("gate", "Hollowroot Vault Gate", ""),
    place("hall", "Hollowroot Vault Hall"),
    place("lost", "Sunken Stair", "Nowhere At All"),
  ]);
  assert.equal(parents.get("entrance"), "woods");
  assert.equal(parents.get("gate"), null);
  assert.equal(parents.get("hall"), null, "nothing is read off a name later");
  assert.equal(parents.get("lost"), null);
});

test("A loop is cut where it closes, so every chain ends at a place of its own", () => {
  const said = resolveParents([place("a", "Alder Mill", "Birch Ford"), place("b", "Birch Ford", "Alder Mill")]);
  assert.equal([said.get("a"), said.get("b")].filter(Boolean).length, 1);
  // A tail leading into a loop keeps its link.
  const loop = [
    place("t", "Tail Room", "Loop One"),
    place("l1", "Loop One", "Loop Two"),
    place("l2", "Loop Two", "Loop One"),
  ];
  assert.equal(resolveParents(loop).get("t"), "l1");
  const tree = placeTree(loop);
  for (const id of ["t", "l1", "l2"]) {
    assert.ok(["l1", "l2"].includes(tree.topOf(id)), `${id} ends somewhere`);
  }
});

test("The tree knows each place's own place and every part below it", () => {
  const tree = placeTree([
    place("village", "Thornhollow"),
    place("hall", "Thornhollow Village Hall", "Thornhollow"),
    place("approach", "Thornhollow Village Hall Approach", "Thornhollow Village Hall"),
    place("tower", "Briarwatch Tower"),
  ]);
  assert.equal(tree.topOf("approach"), "village");
  assert.equal(tree.topOf("tower"), "tower");
  assert.deepEqual(tree.descendantsOf("village"), ["hall", "approach"]);
  assert.deepEqual(tree.childrenOf.get("hall"), ["approach"]);
});

test("A part reads by its short name under its place, and keeps its whole name when it does not start with the place's", () => {
  assert.equal(nameWithin("Hollowroot Vault Entrance Passage", "Hollowroot Vault"), "Entrance Passage");
  assert.equal(nameWithin("Hollowroot Vault: Inner Sanctum", "Hollowroot Vault"), "Inner Sanctum");
  assert.equal(nameWithin("The Root Cellar", "Duskleaf Shrine"), "The Root Cellar");
  assert.equal(nameWithin("Hollowroot Vault", "Hollowroot Vault"), "Hollowroot Vault");
  assert.equal(nameWithin("Hollowroots", "Hollowroot"), "Hollowroots");
});

// ---- which way and how far ----

test("Directions read the ways a model writes them, and anything else is no direction", () => {
  assert.equal(normalizeDirection("North"), "north");
  assert.equal(normalizeDirection("north-east"), "northeast");
  assert.equal(normalizeDirection("NE"), "northeast");
  assert.equal(normalizeDirection("south west"), "southwest");
  assert.equal(normalizeDirection("up the hill"), null);
  assert.equal(normalizeDirection(7), null);
});

test("Distances are the listed values whatever their case or spacing, and anything else is no distance", () => {
  assert.equal(normalizeDistance("half a day"), "half a day");
  assert.equal(normalizeDistance("Half_a_Day"), "half a day");
  assert.equal(normalizeDistance(" a  day "), "a day");
  assert.equal(normalizeDistance("several-days"), "several days");
  assert.equal(normalizeDistance("a few hours"), "a few hours");
  assert.equal(normalizeDistance("4 hours"), null);
  assert.equal(normalizeDistance("far"), null);
  assert.equal(normalizeDistance(3), null);
});

test("A spot north of a place is above it, a day is further than half a day, and nearby stays near", () => {
  const from = { x: 50, y: 40 };
  const north = spotFrom(from, { direction: "north", distance: "a day" }, "Briarwatch Tower");
  assert.ok(north.y < from.y - 8, `a day north lands well above: ${JSON.stringify(north)}`);
  assert.ok(Math.abs(north.x - from.x) <= 3, `and roughly in line: ${JSON.stringify(north)}`);
  const east = spotFrom(from, { direction: "east", distance: "half a day" }, "Mill");
  assert.ok(east.x > from.x + 4 && Math.abs(east.y - from.y) <= 2, JSON.stringify(east));
  const near = spotFrom(from, { direction: "southwest", distance: "nearby" }, "Well");
  assert.ok(near.x < from.x && near.y > from.y && Math.hypot(near.x - from.x, near.y - from.y) <= 4, JSON.stringify(near));
  const far = spotFrom(from, { direction: "west", distance: "several days" }, "Far Keep");
  assert.ok(from.x - far.x >= 15, JSON.stringify(far));
  // Deterministic per name.
  assert.deepEqual(spotFrom(from, { direction: "north", distance: "a day" }, "Briarwatch Tower"), north);
});

// ---- placement ----

test("placeAnchor puts a place at the spot the story gave, or the nearest usable tile to it", () => {
  const terrain = generateOverworldTerrain(555);
  const existing = [];
  const target = { x: 40, y: 30 };
  const at = placeAnchor({ terrain, width: OVERWORLD_WIDTH, height: OVERWORLD_HEIGHT, existing, connected: null, name: "Briarwatch Tower", target });
  const tile = tileAt(terrain, OVERWORLD_WIDTH, at.x, at.y);
  assert.ok(tile !== "w" && tile !== "m", `landed on ${tile}`);
  // Nearest usable: nothing usable lies closer to the target than where it landed.
  const landed = Math.hypot(at.x - target.x, at.y - target.y);
  for (let y = 2; y < OVERWORLD_HEIGHT - 2; y += 1) {
    for (let x = 2; x < OVERWORLD_WIDTH - 2; x += 1) {
      const kind = tileAt(terrain, OVERWORLD_WIDTH, x, y);
      if (kind !== "w" && kind !== "m" && Math.max(Math.abs(x - target.x), Math.abs(y - target.y)) < Math.max(Math.abs(at.x - target.x), Math.abs(at.y - target.y))) {
        assert.fail(`(${x}, ${y}) is a usable tile in a nearer ring than (${at.x}, ${at.y}), ${landed.toFixed(1)} away`);
      }
    }
  }
});

test("Without a spot from the story, a place still keeps clear of the places around its neighbour", () => {
  const terrain = "p".repeat(OVERWORLD_WIDTH * OVERWORLD_HEIGHT);
  const hub = { x: 48, y: 36 };
  const existing = [hub];
  for (const name of ["Ash Ford", "Bell Hill", "Crow Wood", "Dun Mere", "Elm Cross", "Fen Stile"]) {
    const at = placeAnchor({ terrain, width: OVERWORLD_WIDTH, height: OVERWORLD_HEIGHT, existing, connected: hub, name });
    for (const other of existing) {
      assert.ok(Math.max(Math.abs(other.x - at.x), Math.abs(other.y - at.y)) >= 3, `${name} at ${JSON.stringify(at)} crowds ${JSON.stringify(other)}`);
    }
    existing.push(at);
  }
});

// ---- routes ----

test("Routes roll up to places of their own, a route inside one place is dropped, and each pair is drawn once", () => {
  const places = [
    place("village", "Thornhollow", null, { anchor: { x: 10, y: 10 }, connections: ["Thornhollow Smithy", "Hollowroot Vault"] }),
    place("smithy", "Thornhollow Smithy", "Thornhollow", { anchor: { x: 12, y: 10 }, connections: ["Thornhollow", "Hollowroot Vault Entrance"] }),
    place("vault", "Hollowroot Vault", null, { anchor: { x: 30, y: 10 } }),
    place("entrance", "Hollowroot Vault Entrance", "Hollowroot Vault", { connections: ["Thornhollow Smithy", "Hollowroot Vault"] }),
  ];
  assert.deepEqual(regionRoutes(places), [{ a: "vault", b: "village" }]);
});

test("A long route is left out when the map already shows the way through a place on the path", () => {
  const places = [
    place("a", "Ashford", null, { anchor: { x: 0, y: 0 }, connections: ["Bellmoor", "Crowhold"] }),
    place("b", "Bellmoor", null, { anchor: { x: 10, y: 1 }, connections: ["Crowhold"] }),
    place("c", "Crowhold", null, { anchor: { x: 20, y: 0 } }),
    place("d", "Dunmere", null, { anchor: { x: 10, y: 15 }, connections: ["Ashford", "Crowhold"] }),
  ];
  const drawn = regionRoutes(places).map((route) => `${route.a}-${route.b}`).sort();
  assert.ok(!drawn.includes("a-c"), "Ashford to Crowhold runs through Bellmoor");
  assert.ok(drawn.includes("a-b") && drawn.includes("b-c"));
  // Dunmere is well off the line, so Ashford-Dunmere-Crowhold is no shortcut's stand-in.
  assert.ok(drawn.includes("a-d") && drawn.includes("c-d"));
});

test("A place next to another keeps its route to a far place: the way round is drawn before the shortcut is left out", () => {
  // Two places a few tiles apart, both linked to a third far away and to each other.
  const places = [
    place("a", "Ashford", null, { anchor: { x: 10, y: 10 }, connections: ["Bellmoor", "Crowhold"] }),
    place("b", "Bellmoor", null, { anchor: { x: 40, y: 10 }, connections: ["Crowhold"] }),
    place("c", "Crowhold", null, { anchor: { x: 40, y: 14 } }),
  ];
  const drawn = regionRoutes(places).map((route) => `${route.a}-${route.b}`).sort();
  assert.ok(drawn.includes("b-c"), "the short hop is drawn");
  assert.ok(drawn.some((route) => route.includes("a")), `Ashford keeps a route: ${drawn.join(", ")}`);
  assert.equal(drawn.length, 2, `one of the two long routes stands for both: ${drawn.join(", ")}`);
});

// ---- names ----

const measure = (text) => text.length * 6;
const dot = (id, x, y) => ({ owner: id, x: x - 5, y: y - 5, width: 10, height: 10 });

test("Names never print over each other or over another place's dot", () => {
  // The issue's own pair: two roads a tile apart.
  const requests = [
    { id: "a", text: "Thornhollow Road", x: 100, y: 100, radius: 4.5, rank: 1 },
    { id: "b", text: "Duskleaf Road", x: 112, y: 102, radius: 4.5, rank: 1 },
    { id: "c", text: "Duskleaf Shrine", x: 104, y: 120, radius: 4.5, rank: 1 },
    { id: "d", text: "Briarwatch Tower", x: 160, y: 100, radius: 4.5, rank: 3 },
  ];
  const obstacles = requests.map((request) => dot(request.id, request.x, request.y));
  const { placed } = layoutLabels(requests, { measure, height: 12, gap: 4, pad: 3, obstacles, bounds: null });
  for (const one of placed) {
    for (const two of placed) {
      if (one !== two) {
        assert.ok(!boxesOverlap(one.box, two.box), `${one.text} prints over ${two.text}`);
      }
    }
    for (const obstacle of obstacles) {
      if (obstacle.owner !== one.id) {
        assert.ok(!boxesOverlap(one.box, obstacle), `${one.text} covers another dot`);
      }
    }
  }
});

test("Where the party is chooses first, a pointed-at name always shows, and a crowded name waits", () => {
  const requests = [
    { id: "far", text: "Unvisited Somewhere", x: 50, y: 50, radius: 4.5, rank: 3 },
    { id: "here", text: "Where They Stand", x: 52, y: 50, radius: 4.5, rank: 0 },
  ];
  // A box of a world just big enough for one name beside the pair.
  const bounds = { x: 0, y: 30, width: 160, height: 40 };
  const tight = layoutLabels(requests, { measure, height: 12, gap: 4, pad: 3, obstacles: [], bounds });
  assert.ok(tight.placed.some((label) => label.id === "here"), "the party's place is named");
  const pointed = layoutLabels(
    requests.map((request) => (request.id === "far" ? { ...request, force: true } : request)),
    { measure, height: 12, gap: 4, pad: 3, obstacles: [], bounds },
  );
  assert.ok(pointed.placed.some((label) => label.id === "far" && label.force), "the pointed-at name shows");
  const hidden = layoutLabels(
    Array.from({ length: 12 }, (_, index) => ({ id: `p${index}`, text: `Place number ${index}`, x: 50 + index, y: 50, radius: 4.5, rank: 1 })),
    { measure, height: 12, gap: 4, pad: 3, obstacles: [], bounds: { x: 0, y: 0, width: 200, height: 100 } },
  );
  assert.ok(hidden.hidden.length > 0, "a dozen names on one spot cannot all fit");
  assert.equal(hidden.placed.length + hidden.hidden.length, 12);
});

test("A long name with no room tries a shortened form before it waits", () => {
  assert.equal(shortenLabel("Second Hollowroot Waystone Woodland Flank", 18), "Second Hollowroot…");
  assert.equal(shortenLabel("Short", 18), "Short");
  assert.equal(shortenLabel("Supercalifragilisticexpialidocious", 10), "Supercali…");
  const requests = [{ id: "long", text: "Second Hollowroot Waystone Woodland Flank", x: 20, y: 50, radius: 4.5, rank: 1 }];
  // Room for about eighteen characters to the right of the long name's dot and nowhere else.
  const bounds = { x: 0, y: 40, width: 160, height: 20 };
  const obstacles = [{ x: 0, y: 40, width: 15, height: 20 }, { x: 140, y: 40, width: 20, height: 20 }];
  const { placed } = layoutLabels(requests, { measure, height: 12, gap: 4, pad: 3, obstacles, bounds });
  const long = placed.find((label) => label.id === "long");
  assert.ok(long, "the long name found room");
  assert.ok(long.text.endsWith("…"), `shortened: ${long?.text}`);
});

console.log(`test-overworld-places: ${passed} tests passed`);
