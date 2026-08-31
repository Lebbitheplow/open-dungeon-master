// Prepared encounters: the roster shorthand, and the limits that stop a
// template being saved in a shape the engine will only refuse at the table.
import assert from "node:assert/strict";

const {
  parseRoster,
  formatRoster,
  rosterSize,
  checkRoster,
  normalizeTemplateMap,
  addToRoster,
  EMPTY_TEMPLATE_MAP,
  TEMPLATE_MAX_ENEMIES,
  TEMPLATE_MAX_ROWS,
} = await import("../src/lib/dm/encounter-template-logic.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

test("a roster reads counts written either way round", () => {
  assert.deepEqual(parseRoster("goblin x4"), [{ monster: "goblin", count: 4 }]);
  assert.deepEqual(parseRoster("4x goblin"), [{ monster: "goblin", count: 4 }]);
  assert.deepEqual(parseRoster("4 goblins"), [{ monster: "goblins", count: 4 }]);
  assert.deepEqual(parseRoster("hobgoblin"), [{ monster: "hobgoblin", count: 1 }]);
});

test("lines and semicolons both separate rows, and blanks are dropped", () => {
  assert.deepEqual(parseRoster("goblin x2\n\nwolf; bear"), [
    { monster: "goblin", count: 2 },
    { monster: "wolf", count: 1 },
    { monster: "bear", count: 1 },
  ]);
});

test("an already-parsed roster passes through", () => {
  assert.deepEqual(parseRoster([{ monster: "wolf", count: 3 }]), [
    { monster: "wolf", count: 3 },
  ]);
  // A count that is not a number is one creature, not zero or NaN.
  assert.deepEqual(parseRoster([{ monster: "wolf", count: "many" }]), [
    { monster: "wolf", count: 1 },
  ]);
});

test("anything that is not text or rows is an empty roster", () => {
  assert.deepEqual(parseRoster(null), []);
  assert.deepEqual(parseRoster(42), []);
  assert.deepEqual(parseRoster(""), []);
});

test("formatting round-trips what a DM typed", () => {
  const rows = parseRoster("goblin x4\nhobgoblin");
  assert.equal(formatRoster(rows), "goblin x4\nhobgoblin");
  assert.deepEqual(parseRoster(formatRoster(rows)), rows);
});

test("rosterSize counts creatures, not lines", () => {
  assert.equal(rosterSize(parseRoster("goblin x4\nhobgoblin")), 5);
});

test("an empty roster is refused with a sentence", () => {
  const outcome = checkRoster([]);
  assert.ok("error" in outcome);
  assert.match(outcome.error, /at least one monster/i);
});

test("a roster over the engine's combatant cap is refused", () => {
  const outcome = checkRoster(parseRoster(`goblin x${TEMPLATE_MAX_ENEMIES + 1}`));
  assert.ok("error" in outcome);
  assert.match(outcome.error, new RegExp(`${TEMPLATE_MAX_ENEMIES} or fewer`));
});

test("a roster at the cap is allowed", () => {
  const outcome = checkRoster(parseRoster(`goblin x${TEMPLATE_MAX_ENEMIES}`));
  assert.ok(!("error" in outcome));
  assert.equal(rosterSize(outcome.rows), TEMPLATE_MAX_ENEMIES);
});

test("map settings default to nothing rather than to a guess", () => {
  assert.deepEqual(normalizeTemplateMap(undefined, { themes: ["cave"], ambients: ["dim"] }), {
    ...EMPTY_TEMPLATE_MAP,
  });
});

test("map settings keep known values and drop unknown ones", () => {
  const allowed = { themes: ["cave", "field"], ambients: ["bright", "dim", "dark"] };
  const kept = normalizeTemplateMap(
    { seed: 7, theme: "cave", ambient: "dark", width: 20, height: 15 },
    allowed,
  );
  assert.deepEqual(kept, {
    mapId: null,
    seed: 7,
    theme: "cave",
    ambient: "dark",
    width: 20,
    height: 15,
  });
  const dropped = normalizeTemplateMap({ theme: "moon", ambient: "greenish" }, allowed);
  assert.equal(dropped.theme, null);
  assert.equal(dropped.ambient, null);
});

test("a linked prepared map survives normalization and the DB read spread", () => {
  const allowed = { themes: [], ambients: [] };
  const normalized = normalizeTemplateMap({ mapId: "  map-1  " }, allowed);
  assert.equal(normalized.mapId, "map-1");
  // Old rows stored before the field existed read null through the spread
  // src/lib/db/encounter-templates.ts applies.
  assert.equal({ ...EMPTY_TEMPLATE_MAP, ...JSON.parse("{}") }.mapId, null);
  // And a stored mapId round-trips through the same read shape.
  assert.equal({ ...EMPTY_TEMPLATE_MAP, ...normalized }.mapId, "map-1");
});

test("a mapId that is not a usable string reads as no link", () => {
  const allowed = { themes: [], ambients: [] };
  assert.equal(normalizeTemplateMap({ mapId: "   " }, allowed).mapId, null);
  assert.equal(normalizeTemplateMap({ mapId: 7 }, allowed).mapId, null);
  assert.equal(normalizeTemplateMap({ mapId: null }, allowed).mapId, null);
  // Ids are uuids; anything longer is clipped rather than trusted.
  assert.equal(normalizeTemplateMap({ mapId: "x".repeat(80) }, allowed).mapId.length, 64);
});

test("a seed outside the range is clamped rather than refused", () => {
  const allowed = { themes: [], ambients: [] };
  assert.equal(normalizeTemplateMap({ seed: -5 }, allowed).seed, 0);
  assert.equal(normalizeTemplateMap({ seed: "not a seed" }, allowed).seed, null);
});

// ---- picking a monster instead of typing one ----

test("picking a monster appends it to the roster", () => {
  assert.deepEqual(addToRoster([], "Goblin"), [{ monster: "Goblin", count: 1 }]);
  assert.deepEqual(addToRoster([{ monster: "Goblin", count: 1 }], "Wolf"), [
    { monster: "Goblin", count: 1 },
    { monster: "Wolf", count: 1 },
  ]);
});

test("picking the same monster twice counts it, whatever the case", () => {
  assert.deepEqual(addToRoster([{ monster: "Goblin", count: 1 }], "goblin"), [
    { monster: "Goblin", count: 2 },
  ]);
  assert.deepEqual(addToRoster([{ monster: "goblin", count: 4 }], " Goblin "), [
    { monster: "goblin", count: 5 },
  ]);
});

test("a pick round-trips through the shorthand the box shows", () => {
  const picked = formatRoster(addToRoster(parseRoster("goblin x4\nhobgoblin"), "goblin"));
  assert.equal(picked, "goblin x5\nhobgoblin");
  assert.equal(formatRoster(addToRoster(parseRoster(picked), "wolf")), "goblin x5\nhobgoblin\nwolf");
});

test("picking cannot push the roster past the row limit or an empty name in", () => {
  const full = Array.from({ length: TEMPLATE_MAX_ROWS }, (_, index) => ({
    monster: `Thing ${index}`,
    count: 1,
  }));
  assert.deepEqual(addToRoster(full, "Goblin"), full);
  // A row already there still counts up, because that adds no row.
  assert.equal(addToRoster(full, "Thing 0")[0].count, 2);
  assert.deepEqual(addToRoster([], "   "), []);
});

console.log(`encounter-templates: ${passed} tests passed`);
