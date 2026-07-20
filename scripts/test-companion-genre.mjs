// Setting fit for AI companions: the class list a genre allows, the race
// coercion set, and the party/guest slot accounting behind the request button.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { genreClassIds, classGenres } = await import("../src/lib/classes/index.ts");
const { GENRE_PRESETS, genrePreset } = await import("../src/lib/genres.ts");
const { GENRES, gameSettingsSchema, resolveCompanionMode, companionSlotsFree } = await import(
  "../src/lib/schemas/game-settings.ts"
);
const { SRD_RACES } = await import("../src/lib/srd/index.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

const settings = (overrides = {}) => gameSettingsSchema.parse(overrides);

test("open worlds take the whole catalog, themed worlds do not", () => {
  assert.deepEqual(genreClassIds("high_fantasy"), []);
  assert.deepEqual(genreClassIds("custom"), []);
  for (const genre of GENRES) {
    if (genre === "high_fantasy" || genre === "custom") {
      continue;
    }
    const ids = genreClassIds(genre);
    assert.ok(ids.length >= 6, `${genre} should offer a full class list`);
    for (const id of ids) {
      assert.ok(classGenres(id).includes(genre), `${id} is not tagged ${genre}`);
    }
  }
});

test("the cyberpunk gate keeps fantasy classes out and its own classes in", () => {
  const ids = genreClassIds("cyberpunk");
  assert.ok(ids.includes("netrunner"));
  assert.ok(ids.includes("street_samurai"));
  assert.ok(ids.includes("rogue"), "the SRD rogue is tagged cyberpunk");
  for (const id of ["paladin", "druid", "wizard", "grave_knight"]) {
    assert.ok(!ids.includes(id), `${id} does not belong in a cyberpunk campaign`);
  }
});

test("every preset carries usable companion race guidance", () => {
  const raceIds = new Set(SRD_RACES.map((race) => race.id));
  for (const preset of GENRE_PRESETS) {
    assert.ok(preset.raceHint.length > 0, `${preset.id} needs a race hint`);
    for (const id of preset.companionRaces) {
      assert.ok(raceIds.has(id), `${preset.id} lists unknown race ${id}`);
    }
    // A restricted world must still allow the fallback the server coerces to.
    if (preset.companionRaces.length) {
      assert.ok(preset.companionRaces.includes("human"), `${preset.id} must allow human`);
    }
  }
  assert.deepEqual(genrePreset("cyberpunk").companionRaces, ["human"]);
  assert.deepEqual(genrePreset("high_fantasy").companionRaces, []);
});

test("auto resolves by table size, explicit settings win", () => {
  assert.equal(resolveCompanionMode(settings(), 1), "full");
  assert.equal(resolveCompanionMode(settings(), 4), "guests");
  assert.equal(resolveCompanionMode(settings({ companions: "full" }), 4), "full");
  assert.equal(resolveCompanionMode(settings({ companions: "off" }), 1), "off");
});

test("party and guest slots are counted separately", () => {
  const solo = settings({ maxCompanions: 1, maxGuests: 1 });
  assert.equal(companionSlotsFree(solo, 1, []), true);
  // A guest filling the guest slot still leaves the party slot open.
  assert.equal(companionSlotsFree(solo, 1, ["guest"]), true);
  assert.equal(companionSlotsFree(solo, 1, ["guest", "party"]), false);
  // A multiplayer table only ever gets guests, so party sheets never free a slot.
  const table = settings({ maxCompanions: 4, maxGuests: 1 });
  assert.equal(companionSlotsFree(table, 4, ["guest"]), false);
  assert.equal(companionSlotsFree(table, 4, ["party"]), true);
  assert.equal(companionSlotsFree(settings({ companions: "off" }), 1, []), false);
});

console.log(`test-companion-genre: ${passed} passed`);
