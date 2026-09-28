// Subclasses: the twelve the SRD prints, and the 105 ODM wrote.
//
// SRD 5.1 has one subclass per class. Each is held here against a table
// written out by hand (scripts/lib/enforce-srd-progression.mjs): the feature
// names, the level each arrives at, and the always-prepared spells of the
// Life Domain and the Oath of Devotion.
//
// The authored subclasses (src/lib/srd/subclasses.json) are not SRD text, so
// nothing here says what they should contain. What the rules do fix is their
// shape, and that is checked for every one of them:
//   a subclass belongs to one real class;
//   it grants something at the level that class picks its subclass, and
//   nothing before it;
//   its features arrive only at the levels that class's table gives to
//   subclass features (a fighter's at 3, 7, 10, 15 and 18);
//   no feature is named twice, in the subclass or against the class's own;
//   a spell it hands out is a real spell of a level the character can cast
//   on the day it arrives.
//
// Then each is put on a real sheet at every level, since a table that reads
// well can still be granted wrongly.
//
// ODM's rule, pinned below: a warlock patron's spells arrive on the sheet
// for free like a domain's (docs/rules-coverage.md, "Subclass spell lists
// (domain, circle, oath, patron)"). The SRD only adds them to the list a
// warlock chooses from.
import assert from "node:assert/strict";
import { heroInput, openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import {
  CLASS_IDS,
  PACT_SLOT_LEVEL,
  SRD_CLASSES,
  cleanName,
  featurePairs,
  stepped,
  topSlotLevel,
} from "./lib/enforce-srd-progression.mjs";

const { test, finish } = suite("test-enforce-subclasses");
const world = await openWorld();

const { createSheet } = await import("../src/lib/db/sheets.ts");
const { findClass } = await import("../src/lib/srd/index.ts");
const { classFeaturesFor, subclassNamesFor, subclassSpellsFor } = await import("../src/lib/srd/features.ts");
const { spellLevelOf } = await import("../src/lib/srd/spell-lists.ts");
const { sheetFeatureSchema, patchSheetSchema } = await import("../src/lib/schemas/sheet.ts");
const classFeaturesJson = (
  await import("../src/lib/srd/class-features.json", { with: { type: "json" } })
).default;
const subclassesJson = (
  await import("../src/lib/srd/subclasses.json", { with: { type: "json" } })
).default;

// The spells of the two SRD subclasses that have a list, with the level the
// SRD gives each.
const SRD_SPELL_LEVELS = {
  "Bless": 1, "Cure Wounds": 1, "Lesser Restoration": 2, "Spiritual Weapon": 2,
  "Beacon of Hope": 3, "Revivify": 3, "Death Ward": 4, "Guardian of Faith": 4,
  "Mass Cure Wounds": 5, "Raise Dead": 5, "Protection from Evil and Good": 1,
  "Sanctuary": 1, "Zone of Truth": 2, "Dispel Magic": 3, "Freedom of Movement": 4,
  "Commune": 5, "Flame Strike": 5,
};

// The highest spell level a class casts at a class level.
const castableAt = (classId, level) =>
  SRD_CLASSES[classId].caster === "pact"
    ? stepped(PACT_SLOT_LEVEL, level)
    : topSlotLevel(SRD_CLASSES[classId].caster, level);

// Recorded as a finding at the end of the file.
const KNOWN_EARLY = new Set();

const authored = Object.entries(subclassesJson.classes).flatMap(([classId, entries]) =>
  entries.map((entry) => ({ classId, entry })),
);

const made = (classId, level, subclass) =>
  createSheet(
    world.campaignId,
    world.addUser().id,
    level,
    heroInput({ name: `${classId} ${level}`, class: classId, level, subclass }),
  );

// ---- the twelve SRD subclasses ----

await test("each SRD subclass prints its SRD features at their SRD levels", () => {
  const problems = [];
  for (const classId of CLASS_IDS) {
    const table = SRD_CLASSES[classId];
    if (!table.subclass) {
      continue;
    }
    const bundled = classFeaturesJson.classes[classId].subclasses;
    assert.equal(bundled.length, 1, `${classId} has ${bundled.length} subclasses in the SRD table`);
    assert.equal(bundled[0].name, table.subclass.name);
    const wanted = featurePairs(table.subclass.features).map((pair) => `${pair.level}:${cleanName(pair.name)}`);
    const printed = featurePairs(bundled[0].levels).map((pair) => `${pair.level}:${cleanName(pair.name)}`);
    for (const key of wanted) {
      if (!printed.includes(key)) {
        problems.push(`${table.subclass.name} lacks ${key}`);
      }
    }
    for (const key of printed) {
      if (!wanted.includes(key)) {
        problems.push(`${table.subclass.name} adds ${key}`);
      }
    }
    assert.deepEqual(bundled[0].spells ?? {}, table.subclass.spells ?? {}, `${table.subclass.name} spells`);
  }
  assert.equal(problems.length, 0, problems.join("; "));
});

await test("domain and oath spells arrive when the SRD says, at a level the character casts", () => {
  for (const classId of ["cleric", "paladin"]) {
    const { name, spells } = SRD_CLASSES[classId].subclass;
    for (let level = 1; level <= 20; level += 1) {
      const wanted = Object.entries(spells)
        .filter(([atLevel]) => Number(atLevel) <= level)
        .flatMap(([, list]) => list);
      assert.deepEqual(subclassSpellsFor(classId, name, level), wanted, `${name} at ${level}`);
      for (const spell of wanted) {
        assert.ok(SRD_SPELL_LEVELS[spell] <= castableAt(classId, level), `${spell} at ${classId} ${level}`);
        assert.equal(spellLevelOf(spell), SRD_SPELL_LEVELS[spell], `${spell} is filed at the wrong level`);
      }
    }
  }
});

// ---- the authored subclasses, as written ----

await test("there are 105 authored subclasses, each under a real class with a name of its own", () => {
  assert.equal(authored.length, 105);
  for (const classId of Object.keys(subclassesJson.classes)) {
    assert.ok(findClass(classId), `${classId} is not a class`);
    assert.ok(SRD_CLASSES[classId], `${classId} has no class table to hold it against`);
    const names = subclassNamesFor(classId).map(cleanName);
    assert.equal(new Set(names).size, names.length, `${classId} lists a subclass twice`);
  }
  // A name under two classes would make a sheet's subclass ambiguous.
  const owners = new Map();
  for (const { classId, entry } of authored) {
    assert.equal(owners.get(cleanName(entry.name)), undefined, `${entry.name} is under two classes`);
    owners.set(cleanName(entry.name), classId);
  }
});

await test("every authored feature arrives at a level the class gives to its subclass", () => {
  const problems = [];
  for (const { classId, entry } of authored) {
    const table = SRD_CLASSES[classId];
    const levels = Object.keys(entry.levels).map(Number);
    if (!levels.includes(table.subclassAt)) {
      problems.push(`${entry.name} grants nothing at ${classId} ${table.subclassAt}`);
    }
    for (const level of levels) {
      if (level < table.subclassAt) {
        problems.push(`${entry.name} grants at ${level}, before ${classId} picks a subclass`);
      }
      if (!table.subclassLevels.includes(level)) {
        problems.push(`${entry.name} grants at ${level}, not a ${classId} subclass level`);
      }
      if (!entry.levels[level].length) {
        problems.push(`${entry.name} has an empty level ${level}`);
      }
    }
  }
  assert.equal(problems.length, 0, problems.join("; "));
});

await test("every authored feature has a name a sheet can hold, rules text, and no twin", () => {
  const problems = [];
  for (const { classId, entry } of authored) {
    const seen = new Set();
    const own = new Set(featurePairs(classFeaturesJson.classes[classId].levels).map((pair) => cleanName(pair.name)));
    for (const { name: feature, level } of featurePairs(
      Object.fromEntries(Object.entries(entry.levels).map(([at, list]) => [at, list.map((row) => row.n)])),
    )) {
      const key = cleanName(feature);
      if (seen.has(key)) {
        problems.push(`${entry.name} names "${feature}" twice`);
      }
      seen.add(key);
      // Extra Attack is the one name a subclass shares with classes that
      // have it; on a class without it the subclass is what grants it.
      if (own.has(key)) {
        problems.push(`${entry.name} repeats the ${classId}'s own "${feature}" at ${level}`);
      }
      if (feature.length > 80 || sheetFeatureSchema.parse({ name: feature }).name !== feature) {
        problems.push(`${entry.name}: "${feature}" does not fit a sheet`);
      }
    }
    for (const rows of Object.values(entry.levels)) {
      for (const row of rows) {
        if (!row.d || row.d.trim().length < 20) {
          problems.push(`${entry.name}: "${row.n}" has no rules text`);
        }
      }
    }
  }
  assert.equal(problems.length, 0, problems.join("; "));
});

await test("every spell a subclass hands out is real and castable on the day it arrives", () => {
  const problems = [];
  let lists = 0;
  for (const { classId, entry } of authored) {
    for (const [atLevel, spells] of Object.entries(entry.spells ?? {})) {
      lists += 1;
      const level = Number(atLevel);
      if (level < SRD_CLASSES[classId].subclassAt) {
        problems.push(`${entry.name} hands out spells at ${level}, before the subclass is picked`);
      }
      for (const spell of spells) {
        const spellLevel = spellLevelOf(spell);
        if (spellLevel === null) {
          problems.push(`${entry.name}: "${spell}" is not a spell the checklist knows`);
        } else if (spellLevel > castableAt(classId, level) && !KNOWN_EARLY.has(`${entry.name}:${level}:${spell}`)) {
          problems.push(
            `${entry.name}: ${spell} (level ${spellLevel}) arrives at ${classId} ${level}, which casts level ${castableAt(classId, level)}`,
          );
        }
      }
      if (new Set(spells.map(cleanName)).size !== spells.length) {
        problems.push(`${entry.name} lists a spell twice at ${level}`);
      }
    }
  }
  assert.ok(lists > 100, `only ${lists} spell lists were read`);
  assert.equal(problems.length, 0, problems.join("; "));
});

await test("a class with no spellcasting is handed no subclass spells", () => {
  for (const { classId, entry } of authored) {
    if (SRD_CLASSES[classId].caster === "none") {
      assert.equal(entry.spells, undefined, `${entry.name} (${classId}) has a spell list`);
    }
  }
});

// ---- the authored subclasses, on a sheet ----

await test("on a sheet, every subclass grants each feature at its level, once, and none before", () => {
  const problems = [];
  let most = 0;
  for (const classId of Object.keys(subclassesJson.classes)) {
    for (const subclass of subclassNamesFor(classId)) {
      const table =
        classFeaturesJson.classes[classId].subclasses.find((entry) => entry.name === subclass)?.levels ??
        Object.fromEntries(
          Object.entries(
            subclassesJson.classes[classId].find((entry) => entry.name === subclass).levels,
          ).map(([at, rows]) => [at, rows.map((row) => row.n)]),
        );
      const pairs = featurePairs(table);
      for (const level of [1, 2, 3, 5, 6, 7, 9, 10, 11, 13, 14, 15, 17, 18, 20]) {
        const sheet = world.sheet(made(classId, level, subclass).id);
        const held = sheet.features.map((feature) => cleanName(feature.name));
        most = Math.max(most, held.length);
        if (new Set(held).size !== held.length) {
          problems.push(`${subclass} ${level} holds a feature twice`);
        }
        for (const pair of pairs) {
          const has = held.includes(cleanName(pair.name));
          if (has !== pair.level <= level) {
            problems.push(`${subclass} ${level}: "${pair.name}" (level ${pair.level}) is ${has ? "held early" : "missing"}`);
          }
        }
        if (level < SRD_CLASSES[classId].subclassAt && subclassSpellsFor(classId, subclass, level).length) {
          problems.push(`${subclass} hands out spells at ${classId} ${level}`);
        }
      }
    }
  }
  assert.equal(problems.length, 0, problems.slice(0, 30).join("; "));
  // The level-up request carries the whole list, and the schema stops at 80.
  assert.ok(most <= 80, `a sheet holds ${most} features`);
  assert.equal(patchSheetSchema.shape.features.safeParse(new Array(most).fill({ name: "x" })).success, true);
});

await test("a subclass of another class grants nothing", () => {
  for (const [classId, subclass] of [
    ["fighter", "Life Domain"],
    ["wizard", "Path of the Berserker"],
    ["rogue", "Oath of Devotion"],
    ["barbarian", "School of Evocation"],
    ["cleric", "Champion"],
    ["fighter", "Circle of the Moon"],
  ]) {
    const classOnly = (sheet) =>
      sheet.features.filter((feature) => feature.source === "class").map((feature) => feature.name);
    const plain = classOnly(world.sheet(made(classId, 20, "").id));
    const held = classOnly(world.sheet(made(classId, 20, subclass).id));
    assert.deepEqual(held, plain, `${classId} with ${subclass}`);
    assert.deepEqual(subclassSpellsFor(classId, subclass, 20), [], `${classId} with ${subclass}`);
  }
});

await test("ODM's rule: a patron's spells arrive on the sheet for free", () => {
  // SRD 5.1 adds a patron's expanded spells to the list a warlock picks
  // from. ODM grants them outright, as it does a cleric's domain spells
  // (docs/rules-coverage.md, Class resources, "Subclass spell lists").
  const granted = subclassSpellsFor("warlock", "The Archfey", 1);
  assert.ok(granted.length >= 2, "The Archfey hands out no spells at 1st level");
  // The SRD's own patron has no such list in ODM, so a Fiend warlock gets
  // nothing the SRD would not give.
  assert.deepEqual(subclassSpellsFor("warlock", "The Fiend", 20), []);
});

// ---- findings ----

await test(
  "A spell a subclass hands out is of a level the character has slots for: a 1st-level Genie warlock casts 1st-level spells.",
  () => {
    const granted = subclassSpellsFor("warlock", "The Genie", 1);
    const tooHigh = granted.filter((spell) => spellLevelOf(spell) > castableAt("warlock", 1));
    assert.deepEqual(tooHigh, [], `a Genie warlock 1 is handed ${tooHigh.join(", ")}`);
  },
);

await test(
  "A sheet holds the features of the subclass it names, and a name that is no subclass grants none.",
  () => {
    for (const [classId, stored] of [["paladin", "Oath"], ["cleric", "Domain"], ["wizard", "School"]]) {
      const plain = classFeaturesFor(classId, "", 20).map((feature) => feature.name);
      const held = classFeaturesFor(classId, stored, 20).map((feature) => feature.name);
      assert.deepEqual(held, plain, `a ${classId} of "${stored}" holds ${held.length - plain.length} subclass features`);
    }
  },
);

const { optionSlotsFor } = await import("../src/lib/srd/options.ts");

await test(
  "A pick-list a subclass opens (maneuvers, runes, disciplines) is open only to a sheet that names that subclass: exactly, by an alias, or without its title; a fragment of the name opens nothing.",
  () => {
    // The Battle Master's three maneuvers at 3rd, the Rune Knight's two runes,
    // the Way of the Four Elements' two disciplines, however the sheet names it.
    for (const stored of ["Battle Master", "battle master", "battlemaster", "battle-master"]) {
      assert.equal(optionSlotsFor("fighter", stored, 3, "maneuver"), 3, stored);
    }
    assert.equal(optionSlotsFor("fighter", "Rune Knight", 3, "rune"), 2);
    for (const stored of ["Way of the Four Elements", "Four Elements", "four elements", "elemental monk"]) {
      assert.equal(optionSlotsFor("monk", stored, 3, "discipline"), 2, stored);
    }
    // A fragment, or a longer name that merely contains one, is not the subclass.
    for (const stored of ["Master", "Battle", "Grand Battle Master of Arms", "Knight", "Rune"]) {
      assert.equal(optionSlotsFor("fighter", stored, 3, "maneuver") + optionSlotsFor("fighter", stored, 3, "rune"), 0, stored);
    }
    for (const stored of ["Way of", "Elements", "Way of the Four Elements and Shadow"]) {
      assert.equal(optionSlotsFor("monk", stored, 3, "discipline"), 0, stored);
    }
    // A pick-list with no subclass (a warlock's invocations) is untouched.
    assert.ok(optionSlotsFor("warlock", "", 2, "invocation") > 0);
  },
);

world.close();
finish();
