// The map editor's pure parts (docs/visual-overhaul-plan.md 1.1, 4.3, 4.5):
// the rail still holds every tool mode the ledger lists with the app's own
// keys, the live board still hides what it cannot hold, and the two pickers
// order the painted catalogue the way the plan says.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { register } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

register("./lib/register-alias.mjs", import.meta.url);

const state = await import("../src/app/campaigns/[campaignId]/mapToolState.ts");
const catalogue = await import("../src/app/campaigns/[campaignId]/mapCatalogue.ts");
const { BRUSHES } = await import("../src/lib/battlemap/paint.ts");
const { STAMPS } = await import("../src/lib/battlemap/stamp.ts");
const { skinById } = await import("../src/lib/battlemap/skins.ts");

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

// The ledger's table, section 1.1: mode, key, group.
const LEDGER = [
  ["brush", "B", "paint"],
  ["line", "L", "paint"],
  ["rect", "R", "paint"],
  ["box", "X", "paint"],
  ["fill", "F", "paint"],
  ["stamp", "S", "paint"],
  ["pick", "I", "paint"],
  ["select", "V", "scene"],
  ["light", "T", "scene"],
  ["door", "D", "scene"],
  ["label", "A", "scene"],
  ["prop", "P", "scene"],
  ["zone", "Z", "scene"],
  ["pan", "M", "other"],
  ["backdrop", "K", "other"],
  ["roll", "N", "other"],
];

test("all fifteen tool modes and Roll are on the rail, with the app's keys and not the mockup's", () => {
  assert.equal(state.MODES.length, 16);
  for (const [mode, key, group] of LEDGER) {
    const entry = state.MODES.find((candidate) => candidate.mode === mode);
    assert.ok(entry, `${mode} is gone`);
    assert.equal(entry.key, key, mode);
    assert.equal(entry.group, group, mode);
    assert.ok(entry.hint.length > 10 && entry.label.length > 0, mode);
  }
  assert.equal(new Set(state.MODES.map((entry) => entry.key)).size, 16, "two tools share a key");
  assert.ok(!state.MODES.some((entry) => entry.key === "G"), "the mockup's G is not a mode here");
});

test("digits one to six still pick the six brushes", () => {
  assert.deepEqual(Object.keys(state.BRUSH_KEYS), ["1", "2", "3", "4", "5", "6"]);
  assert.deepEqual(Object.values(state.BRUSH_KEYS), [...BRUSHES]);
  assert.equal(BRUSHES.length, 6);
  assert.equal(STAMPS.length, 6);
});

test("the live board hides lights and props, the library holds everything", () => {
  const shown = (caps) => state.MODES.filter((entry) => !entry.needs || caps[entry.needs]).map((entry) => entry.mode);
  assert.equal(shown(state.LIBRARY_CAPS).length, 16);
  const board = shown(state.BOARD_CAPS);
  assert.ok(!board.includes("light") && !board.includes("prop"));
  assert.equal(board.length, 14);
  const held = (mode) => state.canvasToolFor({ ...state.DEFAULT_MAP_TOOLS, mode }, state.BOARD_CAPS);
  assert.equal(held("light"), null);
  assert.equal(held("prop"), null);
  assert.deepEqual(held("zone"), { kind: "zone", ambient: "dark", zoneKind: "light" });
});

test("every mode means something to the canvas, except Roll, which holds nothing", () => {
  for (const entry of state.MODES) {
    const tool = state.canvasToolFor({ ...state.DEFAULT_MAP_TOOLS, mode: entry.mode }, state.LIBRARY_CAPS);
    if (entry.mode === "roll") {
      assert.equal(tool, null);
    } else {
      assert.ok(tool, entry.mode);
    }
  }
  assert.deepEqual(state.canvasToolFor({ ...state.DEFAULT_MAP_TOOLS, mode: "brush", brush: "water", radius: 2 }, state.LIBRARY_CAPS), {
    kind: "brush",
    brush: "water",
    radius: 2,
  });
  assert.equal(state.canvasToolFor(state.DEFAULT_MAP_TOOLS, state.LIBRARY_CAPS), null, "nothing in hand is nothing on the canvas");
  assert.ok(["brush", "line", "rect", "box", "fill"].every(state.isPaintMode));
  assert.ok(!["stamp", "pick", "select", "roll", ""].some(state.isPaintMode));
});

test("the keys sheet lists every tool, every brush, and the editing keys", () => {
  const groups = state.mapHotkeyGroups(state.LIBRARY_CAPS);
  assert.deepEqual(groups.map((group) => group.title), ["Tools", "Brushes", "Editing"]);
  assert.equal(groups[0].rows.length, 16);
  assert.equal(groups[1].rows.length, 6);
  const editing = groups[2].rows.map((row) => row.does).join("|");
  for (const word of ["Undo", "Redo", "Put the tool down", "Delete", "This sheet"]) {
    assert.ok(editing.includes(word), word);
  }
  assert.equal(state.mapHotkeyGroups(state.BOARD_CAPS)[0].rows.length, 14);
});

// ---- the pickers ----

const OBJECTS = [
  { id: "barrel", label: "Barrel", src: "/b.webp", sets: ["dungeon", "tavern"], kind: "wall" },
  { id: "altar", label: "Altar", src: "/a.webp", sets: ["temple"], kind: "feature" },
  { id: "anchor", label: "Anchor", src: "/n.webp", sets: ["river", "ship"], kind: "scatter" },
  { id: "cp-terminal", label: "Terminal", src: "/t.webp", sets: ["cyberpunk"], kind: "wall" },
];

test("stamps are grouped by set, the map's own sets first, every object under each of its sets", () => {
  const groups = catalogue.groupStamps(OBJECTS, ["river"], "");
  assert.equal(groups[0].set, "river");
  assert.equal(groups[0].own, true);
  assert.deepEqual(groups.slice(1).map((group) => group.label), ["Cyberpunk", "Dungeon", "Ship", "Tavern", "Temple"]);
  assert.equal(groups.filter((group) => group.objects.some((object) => object.id === "barrel")).length, 2);
  assert.equal(catalogue.setLabel("throne"), "Throne room");
  assert.equal(catalogue.setLabel("some-new-set"), "Some New Set");
});

test("the stamp search matches a label, an id or a set, and an empty result is empty", () => {
  assert.deepEqual(catalogue.groupStamps(OBJECTS, [], "alt").flatMap((group) => group.objects.map((object) => object.id)), ["altar"]);
  assert.deepEqual(catalogue.groupStamps(OBJECTS, [], "cp-").map((group) => group.set), ["cyberpunk"]);
  assert.deepEqual(catalogue.groupStamps(OBJECTS, [], "TAVERN").map((group) => group.set), ["tavern"]);
  assert.deepEqual(catalogue.groupStamps(OBJECTS, [], "zzz"), []);
});

const TILES = [
  { id: "wall-cave-rock", label: "Cave rock", src: "/1", category: "wall", genre: null, themes: ["cave"] },
  { id: "wall-hedge-dense", label: "Dense hedge", src: "/2", category: "wall", genre: null, themes: ["field"] },
  { id: "cp-wall-neon", label: "Neon wall", src: "/3", category: "wall", genre: "cyberpunk", themes: ["interior"] },
  { id: "water-deep-blue", label: "Deep blue", src: "/4", category: "water", genre: null, themes: ["field"] },
  { id: "hazard-lava-molten", label: "Molten lava", src: "/5", category: "hazard", genre: null, themes: ["cave"] },
  { id: "door-wood-plain", label: "Plain door", src: "/6", category: "door", genre: null, themes: [] },
];

test("a material picker offers only what can paint that character, the setting's own first, the theme's ahead of the rest", () => {
  const walls = catalogue.materialChoices(TILES, "#", "high_fantasy", "field", "");
  assert.deepEqual(walls.map((group) => group.group), ["This setting", "Other settings"]);
  assert.deepEqual(walls[0].tiles.map((tile) => tile.id), ["wall-hedge-dense", "wall-cave-rock"]);
  const cyber = catalogue.materialChoices(TILES, "#", "cyberpunk", "interior", "");
  assert.deepEqual(cyber.map((group) => group.group), ["This setting", "Fantasy"]);
  assert.deepEqual(cyber[0].tiles.map((tile) => tile.id), ["cp-wall-neon"]);
  assert.deepEqual(catalogue.materialChoices(TILES, "~", null, "cave", "").flatMap((group) => group.tiles.map((tile) => tile.id)), [
    "hazard-lava-molten",
    "water-deep-blue",
  ]);
  assert.deepEqual(catalogue.materialChoices(TILES, "+", null, "cave", "").flatMap((group) => group.tiles.map((tile) => tile.id)), ["door-wood-plain"]);
  assert.deepEqual(catalogue.materialChoices(TILES, "#", null, "cave", "hedge").flatMap((group) => group.tiles.map((tile) => tile.id)), ["wall-hedge-dense"]);
});

const propsManifest = path.join(ROOT, "public", "assets", "props", "manifest.json");
const tilesManifest = path.join(ROOT, "public", "assets", "tiles", "manifest.json");
if (existsSync(propsManifest) && existsSync(tilesManifest)) {
  const objects = JSON.parse(readFileSync(propsManifest, "utf8")).objects;
  const tiles = JSON.parse(readFileSync(tilesManifest, "utf8")).tiles;

  test("the shipped object set: every set has a name, every object is reachable, every skin's sets exist", () => {
    const groups = catalogue.groupStamps(objects, skinById("tavern").sets, "");
    const reachable = new Set(groups.flatMap((group) => group.objects.map((object) => object.id)));
    assert.equal(reachable.size, objects.length);
    for (const group of groups) {
      assert.ok(catalogue.SET_LABELS[group.set], `the set "${group.set}" has no label`);
    }
    assert.ok(groups[0].own, "the tavern's own sets do not lead");
  });

  test("the shipped tile set: each of the six characters has materials to choose from in every setting", () => {
    for (const genre of [null, "cyberpunk", "steampunk", "post_apocalyptic", "horror", "mystery"]) {
      for (const char of [".", "#", "~", ",", "+", "|"]) {
        const groups = catalogue.materialChoices(tiles, char, genre, "interior", "");
        assert.ok(groups.length > 0 && groups[0].tiles.length > 0, `${genre} ${char}`);
        if (genre) {
          assert.ok(groups[0].tiles.every((tile) => tile.genre === genre), `${genre} ${char}: its own materials do not lead`);
        }
      }
    }
  });
}

// A placed thing pops in on the canvas: the mockup's pop-in keyframes as maths,
// and the ledger of which things are new enough to still be popping.
{
  const draw = await import("../src/app/campaigns/[campaignId]/terrainDraw.ts");
  test("pop-in starts at half size, overshoots at 60%, and settles at one", () => {
    assert.equal(draw.popScale(0), 0.5);
    assert.ok(Math.abs(draw.popScale(0.6) - 1.15) < 1e-9);
    assert.equal(draw.popScale(1), 1);
    assert.equal(draw.popScale(4), 1);
    assert.ok(draw.popScale(0.3) > 0.5 && draw.popScale(0.3) < 1.15);
    assert.ok(draw.popScale(0.8) < 1.15 && draw.popScale(0.8) > 1);
  });
  test("only a new thing pops, for one pop's length, and never where motion is off", () => {
    const births = { known: new Set(), born: new Map() };
    assert.equal(draw.trackBirths(births, ["light:1,1"], 0, false), true);
    assert.equal(draw.trackBirths(births, ["light:1,1", "prop:2,2"], 100, false), true);
    assert.deepEqual([...births.born.keys()], ["light:1,1", "prop:2,2"]);
    assert.equal(draw.trackBirths(births, ["light:1,1", "prop:2,2"], draw.POP_MS, false), true, "the prop is still popping");
    assert.deepEqual([...births.born.keys()], ["prop:2,2"]);
    assert.equal(draw.trackBirths(births, ["light:1,1", "prop:2,2"], 100 + draw.POP_MS, false), false);
    // A thing taken away mid-pop is forgotten, and comes back as new.
    draw.trackBirths(births, ["light:1,1", "prop:2,2", "label:3,3"], 1000, false);
    assert.equal(draw.trackBirths(births, ["light:1,1", "prop:2,2"], 1010, false), false);
    assert.equal(draw.trackBirths(births, ["light:1,1", "prop:2,2", "label:3,3"], 1020, false), true);
    const calm = { known: new Set(), born: new Map() };
    assert.equal(draw.trackBirths(calm, ["light:1,1"], 0, true), false);
  });
}

console.log(`map editor: ${passed} checks passed.`);
