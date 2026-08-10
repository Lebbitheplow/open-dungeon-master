// World pack plumbing: how a pack layers over its base genre preset, how the
// display reskins behave, and what the DM primer renders.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { presetFor, packFor } = await import("../src/lib/worlds/preset.ts");
const { genrePreset } = await import("../src/lib/genres.ts");
const { listWorldPacks, worldPack } = await import("../src/lib/worlds/index.ts");
const { applyIdReskins, applyClassReskins, displayName, packRecommends, packIds } =
  await import("../src/lib/worlds/reskin-logic.ts");
const { renderWorldPrimer } = await import("../src/lib/worlds/primer-logic.ts");
const { estimateTokens } = await import("../src/lib/dm/context-budget.ts");
const { normalizeGameSettings } = await import("../src/lib/schemas/game-settings.ts");
const { settingClassIds } = await import("../src/lib/classes/index.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

const packs = listWorldPacks();
// Every case below needs one real pack to layer; the packs directory always
// ships at least the worked example.
assert.ok(packs.length > 0, "no world packs installed");
const sample = packs[0];

test("no pack and an unknown pack both fall back to the plain genre", () => {
  assert.deepEqual(presetFor({ genre: "horror", worldPack: "" }), genrePreset("horror"));
  assert.deepEqual(
    presetFor({ genre: "horror", worldPack: "definitely_not_a_pack" }),
    genrePreset("horror"),
  );
  assert.deepEqual(presetFor({ genre: "horror" }), genrePreset("horror"));
  assert.equal(packFor({ genre: "horror", worldPack: "" }), null);
});

test("a pack's non-empty overrides win and its empty ones inherit", () => {
  const base = genrePreset(sample.baseGenre);
  const merged = presetFor({ genre: sample.baseGenre, worldPack: sample.id });
  assert.equal(merged.name, sample.name);
  assert.equal(merged.mapStyle, sample.mapStyle || base.mapStyle);
  assert.equal(merged.portraitStyle, sample.portraitStyle || base.portraitStyle);
  assert.equal(merged.nameHints, sample.nameHints || base.nameHints);
  assert.equal(
    merged.companionRaces,
    sample.companionRaces.length ? sample.companionRaces : base.companionRaces,
  );
});

test("the pack's flavor is appended so the genre's own rule survives", () => {
  const base = genrePreset(sample.baseGenre);
  const merged = presetFor({ genre: sample.baseGenre, worldPack: sample.id });
  if (base.dmFlavor && sample.dmFlavor) {
    assert.ok(merged.dmFlavor.startsWith(base.dmFlavor), "base flavor was replaced, not kept");
    assert.ok(merged.dmFlavor.includes(sample.dmFlavor), "pack flavor is missing");
  }
});

test("a pack layers onto whatever genre is stored, not only its own", () => {
  // The create dialog copies baseGenre into `genre`, but a lead may change the
  // genre afterwards; the pack must still apply rather than vanish.
  const merged = presetFor({ genre: "mystery", worldPack: sample.id });
  assert.equal(merged.name, sample.name);
});

test("worldPack round-trips through the settings schema and defaults empty", () => {
  assert.equal(normalizeGameSettings({}).worldPack, "");
  assert.equal(normalizeGameSettings({ worldPack: sample.id }).worldPack, sample.id);
  // A legacy row with no field at all still parses.
  assert.equal(normalizeGameSettings({ genre: "horror" }).worldPack, "");
});

test("applyIdReskins renames without ever touching an id", () => {
  const options = [
    { id: "human", name: "Human" },
    { id: "not_in_pack", name: "Untouched" },
  ];
  const reskinned = applyIdReskins(options, [
    { id: "human", name: "Spacer", blurb: "b" },
    { id: "ghost_id_that_does_not_exist", name: "Phantom", blurb: "" },
  ]);
  assert.equal(reskinned.length, 2, "a reskin for a missing id must not add an option");
  assert.equal(reskinned[0].id, "human");
  assert.equal(reskinned[0].name, "Spacer");
  assert.equal(reskinned[0].packName, "Spacer");
  assert.equal(reskinned[1].name, "Untouched");
  assert.equal(reskinned[1].packName, undefined);
});

test("applyClassReskins overrides the casting label and leaves the rest alone", () => {
  const pack = {
    classes: [{ id: "wizard", name: "Magus", blurb: "b", castingLabel: "Arts" }],
  };
  const [magus, monk] = applyClassReskins(
    [
      { id: "wizard", name: "Wizard", castingLabel: null, spellListFrom: "wizard" },
      { id: "monk", name: "Monk", castingLabel: null },
    ],
    pack,
  );
  assert.equal(magus.id, "wizard");
  assert.equal(magus.name, "Magus");
  assert.equal(magus.castingLabel, "Arts");
  assert.equal(magus.spellListFrom, "wizard", "an unrelated field was disturbed");
  assert.equal(monk.name, "Monk");
  assert.equal(applyClassReskins([{ id: "monk", name: "Monk" }], null)[0].name, "Monk");
});

test("displayName falls back to the canonical string", () => {
  assert.equal(displayName(null, "spells", "Cure Wounds"), "Cure Wounds");
  const pack = { spells: [{ from: "Cure Wounds", name: "Curaga", blurb: "" }] };
  assert.equal(displayName(pack, "spells", "Cure Wounds"), "Curaga");
  // Case-insensitive, because sheets store whatever the picker wrote.
  assert.equal(displayName(pack, "spells", "cure wounds"), "Curaga");
  assert.equal(displayName(pack, "spells", "Fireball"), "Fireball");
});

test("packRecommends and packIds read the pack's own lists", () => {
  const firstRace = sample.races[0];
  assert.ok(packRecommends(sample, "races", firstRace.id));
  assert.ok(!packRecommends(sample, "races", "definitely_not_a_race"));
  assert.ok(!packRecommends(null, "races", firstRace.id));
  assert.deepEqual(packIds(sample, "classes"), sample.classes.map((entry) => entry.id));
  assert.deepEqual(packIds(null, "classes"), []);
});

test("settingClassIds prefers the pack list and falls back to the genre", () => {
  assert.deepEqual(settingClassIds("cyberpunk", ["a", "b"]), ["a", "b"]);
  assert.ok(settingClassIds("cyberpunk", []).includes("netrunner"));
  assert.deepEqual(settingClassIds("high_fantasy", []), []);
});

test("the primer names the world and prints canonical names in the alias table", () => {
  assert.equal(renderWorldPrimer(null), "");
  const primer = renderWorldPrimer(sample);
  assert.ok(primer.includes(sample.name), "the primer does not name the world");
  if (sample.spells.length) {
    const alias = sample.spells[0];
    assert.ok(
      primer.includes(`${alias.name} = ${alias.from}`),
      "the alias table does not map the world's name back to the canonical one",
    );
    assert.ok(
      primer.includes("call every tool with the canonical name"),
      "the primer never tells the DM which name the tools take",
    );
  }
});

test("an all-defaults pack renders nothing rather than empty headers", () => {
  const bare = {
    id: "bare",
    name: "Bare",
    blurb: "b",
    inspiredBy: "i",
    franchise: "Bare",
    edition: "",
    editionOrder: 0,
    baseGenre: "high_fantasy",
    dmFlavor: "",
    mapStyle: "",
    portraitStyle: "",
    nameHints: "",
    raceHint: "",
    companionRaces: [],
    theme: "t",
    premise: "",
    races: [],
    classes: [],
    backgrounds: [],
    spells: [],
    items: [],
    features: [],
    monsters: [],
    alignments: [],
    nameSeeds: { people: [], places: [] },
    factions: [],
    locations: [],
    hooks: [],
    glossary: [],
  };
  const primer = renderWorldPrimer(bare);
  // The headline sentence is all a contentless pack should ever produce.
  assert.equal(primer, "This campaign runs in Bare. b");
});

test("every installed pack's primer fits the prompt budget", () => {
  for (const pack of packs) {
    const tokens = estimateTokens(renderWorldPrimer(pack));
    assert.ok(tokens < 1200, `${pack.id}: primer is ${tokens} tokens, too heavy for every turn`);
  }
});

test("worldPack() resolves by id and refuses anything else", () => {
  assert.equal(worldPack(sample.id)?.id, sample.id);
  assert.equal(worldPack(""), null);
  assert.equal(worldPack("nope"), null);
});

console.log(`test-world-preset: ${passed} passed`);
