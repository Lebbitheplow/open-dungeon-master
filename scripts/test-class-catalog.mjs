// Setting-specific class catalog: definition invariants across every genre
// file, feature-table sanity, and DM-prompt rendering of custom semantics.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { CUSTOM_CLASSES, CUSTOM_CLASS_FEATURES, findCustomClass, classGenres, spellClassFor, classFeatureDescription } =
  await import("../src/lib/classes/index.ts");
const { SRD_CLASSES, ALL_CLASSES, findClass, spellSlotsFor } = await import("../src/lib/srd/index.ts");
const { GENRES } = await import("../src/lib/schemas/game-settings.ts");
const { buildGameStateBlock } = await import("../src/lib/dm/prompt.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

const SRD_CASTERS = new Set(
  SRD_CLASSES.filter((klass) => klass.casterType !== "none").map((klass) => klass.id),
);
const ABILITIES = new Set(["str", "dex", "con", "int", "wis", "cha"]);

test("catalog ids are unique and never collide with SRD ids", () => {
  const ids = ALL_CLASSES.map((klass) => klass.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("every catalog class satisfies the definition invariants", () => {
  for (const klass of CUSTOM_CLASSES) {
    const tag = `catalog class ${klass.id}`;
    assert.ok([6, 8, 10, 12].includes(klass.hitDie), `${tag}: bad hitDie`);
    assert.equal(klass.saves.length, 2, `${tag}: needs exactly 2 saves`);
    assert.ok(klass.saves.every((save) => ABILITIES.has(save)), `${tag}: bad save`);
    if (klass.casterType === "none") {
      assert.equal(klass.spellAbility, null, `${tag}: non-caster with spellAbility`);
      assert.equal(klass.spellListFrom, null, `${tag}: non-caster with spellListFrom`);
    } else {
      assert.ok(["int", "wis", "cha"].includes(klass.spellAbility), `${tag}: bad spellAbility`);
      assert.ok(SRD_CASTERS.has(klass.spellListFrom), `${tag}: spellListFrom must be an SRD caster`);
    }
    assert.ok(klass.genres.length >= 1, `${tag}: no genre tags`);
    assert.ok(klass.genres.every((genre) => GENRES.includes(genre)), `${tag}: bad genre tag`);
    assert.ok(klass.blurb.length > 0, `${tag}: missing blurb`);
    assert.ok(!klass.blurb.includes("—"), `${tag}: em dash in blurb`);
    assert.ok(klass.skillChoices.count >= 2, `${tag}: too few skill choices`);
  }
});

test("every catalog class has a feature table with a subclass", () => {
  for (const klass of CUSTOM_CLASSES) {
    const table = CUSTOM_CLASS_FEATURES[klass.id];
    assert.ok(table, `catalog class ${klass.id} has no feature table`);
    assert.ok(table.subclassLevel >= 1 && table.subclassLevel <= 3, `${klass.id}: odd subclassLevel`);
    assert.ok(table.levels["1"]?.length >= 2, `${klass.id}: fewer than 2 level-1 features`);
    assert.ok(table.levels["20"]?.length >= 1, `${klass.id}: no capstone`);
    assert.ok(table.subclass.name.length > 0, `${klass.id}: unnamed subclass`);
    assert.ok(
      Object.keys(table.subclass.levels).length >= 3,
      `${klass.id}: subclass has fewer than 3 feature levels`,
    );
    for (const [levels, where] of [
      [table.levels, "base"],
      [table.subclass.levels, "subclass"],
    ]) {
      for (const [levelKey, names] of Object.entries(levels)) {
        const level = Number(levelKey);
        assert.ok(level >= 1 && level <= 20, `${klass.id}: ${where} level ${levelKey} out of range`);
        for (const name of names) {
          assert.ok(name.length <= 80, `${klass.id}: feature name too long: ${name}`);
          const description = classFeatureDescription(klass.id, name);
          assert.ok(description, `${klass.id}: feature "${name}" has no description`);
          assert.ok(!description.includes("—"), `${klass.id}: em dash in "${name}" text`);
        }
      }
    }
  }
});

test("every feature table belongs to a defined class", () => {
  for (const classId of Object.keys(CUSTOM_CLASS_FEATURES)) {
    assert.ok(findCustomClass(classId), `feature table for unknown class ${classId}`);
  }
});

test("catalog casters get real spell slots via casterType", () => {
  for (const klass of CUSTOM_CLASSES.filter((entry) => entry.casterType !== "none")) {
    const slots = spellSlotsFor(klass.id, 5);
    assert.ok(Object.keys(slots).length > 0, `${klass.id}: no slots at level 5`);
  }
});

test("findClass resolves catalog classes; spellClassFor borrows SRD lists", () => {
  assert.equal(findClass("netrunner")?.hitDie, 6);
  assert.equal(spellClassFor("netrunner"), "wizard");
  assert.equal(spellClassFor("fighter"), "fighter");
});

test("classGenres covers catalog tags and SRD tags", () => {
  assert.ok(classGenres("netrunner").includes("cyberpunk"));
  assert.ok(classGenres("rogue").includes("cyberpunk"));
  assert.deepEqual(classGenres("monk"), []);
});

function makeSheet(overrides = {}) {
  return {
    id: "sheet-1",
    campaignId: "camp-1",
    userId: "user-1",
    libraryCharacterId: null,
    name: "Testa",
    race: "human",
    class: "fighter",
    subclass: "",
    background: "",
    alignment: "",
    level: 1,
    xp: 0,
    abilities: { str: 16, dex: 12, con: 14, int: 10, wis: 10, cha: 10 },
    maxHp: 12,
    currentHp: 12,
    tempHp: 0,
    ac: 16,
    speed: 30,
    hitDice: { die: "d10", total: 1, spent: 0 },
    proficiencies: { saves: ["str", "con"], skills: [], languages: [], tools: [], armor: [], weapons: [] },
    equipment: [],
    gold: 15,
    feats: [],
    spellcasting: null,
    conditions: [],
    portrait: null,
    notes: "",
    backstory: "",
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
    ...overrides,
  };
}

function makeState(sheet) {
  return {
    campaign: {
      id: "camp-1",
      title: "Test Campaign",
      description: "",
      difficulty: "normal",
      theme: "",
      scene: "",
      questLog: [],
      dmOutline: "",
      storyArc: null,
      gameSettings: {
        genre: "cyberpunk",
        customGenreText: "",
        aiStorySetup: true,
        dicePolicy: "digital_only",
        ttsEnabled: false,
        ttsVoice: "af_heart",
        mapsEnabled: false,
        midGameJoinOpen: false,
        holdSubmissions: false,
      },
    },
    members: [
      { userId: "user-1", username: "kaleb", role: "owner", ready: true, useRealDice: false, joinedAt: "2026-01-01" },
    ],
    sheets: [sheet],
    recentRolls: [],
    storySummary: "",
  };
}

test("DM prompt carries the class primer and feature rules text for catalog classes", () => {
  const sheet = makeSheet({
    class: "netrunner",
    hitDice: { die: "d6", total: 1, spent: 0 },
    features: [
      { name: "Deck Interface", source: "class", level: 1 },
      { name: "Hot-Sim Focus", source: "class", level: 1 },
    ],
    spellcasting: { ability: "int", slots: { 1: { max: 2, used: 0 } }, prepared: ["Mage Armor"], known: [] },
  });
  const block = buildGameStateBlock(makeState(sheet));
  assert.ok(block.includes("Class primer: Netrunner is a custom class"));
  assert.ok(block.includes("wizard-list spells reflavored as Programs (INT)"));
  assert.ok(block.includes("Hot-Sim Focus (May run any known program with the ritual tag"));
});

test("SRD sheets render without primers or feature glosses", () => {
  const sheet = makeSheet({
    features: [{ name: "Second Wind", source: "class", level: 1 }],
  });
  const block = buildGameStateBlock(makeState(sheet));
  assert.ok(!block.includes("Class primer:"));
  assert.ok(block.includes("Second Wind,") || block.includes("Second Wind\n") || /Second Wind(?! \()/.test(block));
  assert.ok(!block.includes("Second Wind ("));
});

console.log(`test-class-catalog: ${passed} tests passed.`);
