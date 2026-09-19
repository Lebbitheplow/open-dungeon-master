// The campaign creator's pure halves (docs/visual-overhaul-plan.md 8.5): the
// world portals, the theme that types itself, the table sheet and the cover.
// The rule under test throughout is that the new presentation reads the same
// presets and the same draft the old form did, and loses none of it.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { GENRE_PRESETS } = await import("../src/lib/genres.ts");
const { arrivalTypeIn, dmFlavorText, portalCards, presetTheme, typeInPlan, worldFacts, TYPE_MS_PER_CHAR } =
  await import("../src/app/create-campaign/portals.ts");
const { countableRows, featuresOn, flipRow, tableSheet } = await import(
  "../src/app/create-campaign/table-sheet.ts"
);
const { coverSheet } = await import("../src/app/create-campaign/cover-sheet.ts");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

// draft.ts pulls in a component for one constant, so the draft is rebuilt
// here from the fields these modules read. The values are DEFAULT_DRAFT's.
const DRAFT = {
  dmMode: "ai",
  title: "",
  description: "",
  theme: "",
  maxPlayers: 5,
  startingLevel: 1,
  difficulty: "normal",
  campaignLength: "standard",
  genre: "high_fantasy",
  customGenreText: "",
  worldPack: "",
  themeTouched: false,
  descriptionTouched: false,
  aiStorySetup: true,
  dicePolicy: "digital_only",
  ttsEnabled: true,
  mapsEnabled: true,
  ambienceEnabled: true,
  ambienceAuto: true,
  boardDrawing: true,
  enemyIntent: true,
  presentation: "plain",
  multiCharacter: "off",
  multiclassingEnabled: true,
  worldSimulation: true,
  inventoryApprovals: false,
  midGameJoinOpen: false,
  holdSubmissions: false,
  narrationGuard: true,
  relationships: "on",
  romance: "on",
};
const TABLE = {
  solo: false,
  aiNarrates: true,
  storyKnownMissing: false,
  storyUnreachable: false,
  ttsAvailable: true,
  mapsAvailable: true,
};
const ALL_ON = { ...DRAFT, inventoryApprovals: true, midGameJoinOpen: true, holdSubmissions: true };

// ---- the portals ----

test("every preset is a portal, in preset order, custom included", () => {
  const cards = portalCards("high_fantasy");
  assert.deepEqual(cards.map((card) => card.id), GENRE_PRESETS.map((preset) => preset.id));
  assert.ok(cards.some((card) => card.id === "custom"));
  for (const [index, card] of cards.entries()) {
    const preset = GENRE_PRESETS[index];
    assert.equal(card.name, preset.name);
    assert.equal(card.blurb, preset.blurb);
    assert.equal(card.climate, preset.climate);
    assert.equal(card.delayMs, index * 40);
  }
});

test("exactly one portal is chosen, and it is the draft's genre", () => {
  for (const preset of GENRE_PRESETS) {
    const chosen = portalCards(preset.id).filter((card) => card.chosen);
    assert.deepEqual(chosen.map((card) => card.id), [preset.id]);
  }
});

test("every portal's plate is a file that exists", () => {
  for (const card of portalCards("custom")) {
    assert.match(card.plate, /^\/assets\/placeholders\/campaign\/[a-z-]+-[123]\.webp$/);
    assert.ok(fs.existsSync(path.join(root, "public", card.plate)), `${card.plate} is missing`);
  }
});

test("humans only follows the companion races, not a list kept by hand", () => {
  const humans = portalCards("custom").filter((card) => card.humansOnly).map((card) => card.id);
  assert.deepEqual(humans, ["mystery", "horror", "cyberpunk"]);
});

test("the four facts come from the preset, and custom never shows an empty one", () => {
  for (const preset of GENRE_PRESETS) {
    const facts = worldFacts(preset.id);
    assert.deepEqual(facts.map((fact) => fact.key), ["Maps", "Names", "Who lives here", "Sky"]);
    assert.equal(facts[0].value, preset.mapStyle);
    assert.equal(facts[2].value, preset.raceHint);
    assert.ok(facts[3].value.startsWith(preset.climate));
    for (const fact of facts) {
      assert.ok(fact.value.trim().length > 0, `${preset.id} has an empty ${fact.key}`);
    }
    assert.ok(dmFlavorText(preset.id).trim().length > 0);
  }
  assert.equal(dmFlavorText("horror"), GENRE_PRESETS.find((preset) => preset.id === "horror").dmFlavor);
});

// ---- the theme that writes itself ----

test("an untouched theme follows the preset", () => {
  assert.equal(presetTheme(DRAFT).theme, GENRE_PRESETS[0].defaultTheme);
  const horror = presetTheme({ ...DRAFT, genre: "horror", theme: "anything the last preset wrote" });
  assert.equal(horror.theme, GENRE_PRESETS.find((preset) => preset.id === "horror").defaultTheme);
  assert.equal(presetTheme({ ...DRAFT, genre: "custom", theme: "left over" }).theme, "");
});

test("a typed theme is never overwritten, and neither is a pack's", () => {
  const typed = { ...DRAFT, theme: "Mine", themeTouched: true };
  assert.equal(presetTheme(typed), typed);
  const packed = { ...DRAFT, theme: "The pack's line", worldPack: "some-pack" };
  assert.equal(presetTheme(packed), packed);
  assert.equal(presetTheme(DRAFT).themeTouched, false, "a preset write must not claim the field");
});

test("the type-in respects themeTouched", () => {
  assert.equal(typeInPlan({ theme: "Mine", themeTouched: true }, "horror"), null);
  const plan = typeInPlan({ theme: "", themeTouched: false }, "horror");
  const text = GENRE_PRESETS.find((preset) => preset.id === "horror").defaultTheme;
  assert.deepEqual(plan, {
    text,
    chars: text.length,
    typeMs: text.length * TYPE_MS_PER_CHAR,
    sweepMs: text.length * TYPE_MS_PER_CHAR + 300,
  });
  assert.equal(TYPE_MS_PER_CHAR, 22);
});

test("nothing types when there is nothing new to write", () => {
  assert.equal(typeInPlan({ theme: "", themeTouched: false }, "custom"), null);
  assert.equal(typeInPlan({ theme: GENRE_PRESETS[0].defaultTheme, themeTouched: false }, "high_fantasy"), null);
});

test("arriving on the step replays only a line the preset wrote", () => {
  assert.equal(arrivalTypeIn(presetTheme(DRAFT)).text, GENRE_PRESETS[0].defaultTheme);
  assert.equal(arrivalTypeIn({ ...DRAFT, theme: "Mine", themeTouched: true }), null);
  assert.equal(arrivalTypeIn({ ...DRAFT, theme: "Pack line", worldPack: "some-pack" }), null);
  assert.equal(arrivalTypeIn({ ...DRAFT, genre: "custom" }), null);
});

// ---- the table sheet ----

function rowsOf(draft, gates) {
  return tableSheet(draft, gates).flatMap((group) => group.rows);
}

test("featuresOn still counts thirteen", () => {
  assert.equal(featuresOn(ALL_ON, TABLE), 13);
  assert.equal(countableRows(TABLE), 13);
  assert.equal(rowsOf(ALL_ON, TABLE).filter((row) => row.counted).length, 13);
  // The four that are shown but uncounted stay uncounted.
  const uncounted = rowsOf(ALL_ON, TABLE).filter((row) => !row.counted).map((row) => row.key);
  assert.deepEqual(uncounted.sort(), ["boardDrawing", "enemyIntent", "multiCharacter", "presentation"]);
});

test("the dots on the sheet always add up to featuresOn", () => {
  const gateSets = [
    TABLE,
    { ...TABLE, solo: true },
    { ...TABLE, aiNarrates: false },
    { ...TABLE, solo: true, aiNarrates: false },
    { ...TABLE, ttsAvailable: false, mapsAvailable: false },
  ];
  const drafts = [
    DRAFT,
    ALL_ON,
    { ...ALL_ON, ambienceEnabled: false },
    { ...ALL_ON, relationships: "off" },
    { ...ALL_ON, romance: "off", ttsEnabled: false, mapsEnabled: false },
    { ...DRAFT, aiStorySetup: false, worldSimulation: false, narrationGuard: false },
  ];
  for (const gates of gateSets) {
    for (const draft of drafts) {
      const dots = rowsOf(draft, gates).filter((row) => row.counted && row.on).length;
      assert.equal(dots, featuresOn(draft, gates));
      assert.ok(dots <= countableRows(gates));
    }
  }
});

test("gating is the old gating", () => {
  const keys = (draft, gates) => rowsOf(draft, gates).map((row) => row.key);
  assert.equal(keys(ALL_ON, TABLE).length, 17);
  const human = keys(ALL_ON, { ...TABLE, aiNarrates: false });
  for (const key of ["aiStorySetup", "narrationGuard", "worldSimulation"]) {
    assert.ok(!human.includes(key), `${key} shows with a human narrator`);
  }
  assert.ok(!tableSheet(ALL_ON, { ...TABLE, aiNarrates: false }).some((group) => group.id === "narration"));
  const solo = keys(ALL_ON, { ...TABLE, solo: true });
  assert.ok(!solo.includes("midGameJoinOpen") && !solo.includes("holdSubmissions"));
  assert.ok(!keys({ ...ALL_ON, ambienceEnabled: false }, TABLE).includes("ambienceAuto"));
  assert.ok(!keys({ ...ALL_ON, relationships: "off" }, TABLE).includes("romance"));
});

test("a missing backend disables its row and says why", () => {
  const rows = rowsOf(DRAFT, { ...TABLE, ttsAvailable: false, mapsAvailable: false });
  const tts = rows.find((row) => row.key === "ttsEnabled");
  const maps = rows.find((row) => row.key === "mapsEnabled");
  assert.equal(tts.disabled, true);
  assert.equal(tts.hint, "No speech service on this server");
  assert.equal(maps.disabled, true);
  assert.equal(maps.hint, "No image service on this server");
  assert.ok(rowsOf(DRAFT, TABLE).every((row) => !row.disabled));
});

test("a press flips, and the tri-state walks its three stops", () => {
  assert.deepEqual(flipRow(DRAFT, "mapsEnabled"), { mapsEnabled: false });
  assert.deepEqual(flipRow(DRAFT, "inventoryApprovals"), { inventoryApprovals: true });
  assert.deepEqual(flipRow(DRAFT, "relationships"), { relationships: "off" });
  assert.deepEqual(flipRow({ ...DRAFT, relationships: "off" }, "relationships"), { relationships: "on" });
  assert.deepEqual(flipRow(DRAFT, "romance"), { romance: "off" });
  assert.deepEqual(flipRow(DRAFT, "presentation"), { presentation: "theatre" });
  assert.deepEqual(flipRow(DRAFT, "enemyIntent"), { enemyIntent: false });
  let draft = DRAFT;
  const stops = [];
  const knobs = [];
  for (let press = 0; press < 3; press += 1) {
    draft = { ...draft, ...flipRow(draft, "multiCharacter") };
    stops.push(draft.multiCharacter);
    knobs.push(rowsOf(draft, TABLE).find((row) => row.key === "multiCharacter").knob);
  }
  assert.deepEqual(stops, ["one_active", "all_active", "off"]);
  assert.deepEqual(knobs, [0.5, 1, 0]);
});

// ---- the cover ----

test("the cover is the draft's, not a constant", () => {
  const draft = { ...presetTheme(DRAFT), title: "  Curse of the Ash Kingdom  ", difficulty: "deadly", campaignLength: "epic", maxPlayers: 3, startingLevel: 7, dicePolicy: "real_allowed" };
  const sheet = coverSheet(draft, TABLE, null);
  assert.equal(sheet.title, "Curse of the Ash Kingdom");
  assert.equal(sheet.theme, GENRE_PRESETS[0].defaultTheme);
  assert.equal(sheet.difficulty, "Deadly");
  assert.equal(sheet.stampSub, "6-8 acts");
  assert.equal(sheet.party, "3 players · level 7");
  assert.equal(sheet.dice, "Real dice allowed");
  assert.equal(sheet.setting, "High fantasy");
  assert.deepEqual(sheet.chips, ["temperate sky", "epic · 6-8 acts"]);
});

test("the cover keeps the old read-back wording for solo, packs and a human narrator", () => {
  const solo = coverSheet({ ...DRAFT, title: "Alone" }, { solo: true, aiNarrates: true }, "Ashfall");
  assert.equal(solo.party, "Solo · level 1");
  assert.equal(solo.setting, "Ashfall (High fantasy)");
  assert.equal(solo.dice, "Digital only");
  const human = coverSheet({ ...DRAFT, title: "Ours" }, { solo: false, aiNarrates: false }, null);
  assert.deepEqual(human.chips, ["temperate sky"], "length is an AI narrator's fact");
  assert.equal(human.stampSub, "level 1");
});

console.log(`test-world-portals: ${passed} passed`);
