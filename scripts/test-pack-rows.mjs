// The character builder reading content-pack rows as their text says.
//
// With the Open5e pack installed the builder builds its race, class and
// background options from pack rows (src/lib/content/mechanics.ts,
// race-options.ts, the builder's useBuilderOptions.ts). The rows in
// fixtures/open5e-pack-rows.json are copied verbatim from the pack
// (data/content/open5e.sqlite, as /api/content/* serves them), cut to the
// fields the builder reads. Each test below failed before its fix: a wizard
// proficient in armor "None", a pack background granting no languages, tools
// or gear, a pick read as every option of it, a gearforged with no ability
// increase, the Tome of Heroes drow built as the SRD's, a pack class with
// 8 HP at every level.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const here = path.dirname(fileURLToPath(import.meta.url));
const rows = JSON.parse(readFileSync(path.join(here, "fixtures", "open5e-pack-rows.json"), "utf8"));

const { ALL_SKILLS, backgroundMechanics, classMechanics, raceMechanics } = await import("../src/lib/content/mechanics.ts");
const { packRaceOptions } = await import("../src/lib/content/race-options.ts");
const { mergedBackgroundOptions } = await import("../src/app/characters/builder/useBuilderOptions.ts");
const { buildBuilderResult } = await import("../src/app/characters/builder/submit.ts");
const { builderMaxHp } = await import("../src/app/characters/builder/abilityDice.ts");
const { suggestedStartingHp } = await import("../src/lib/srd/index.ts");
const { populateFeaturesForClasses, racialTraitsFor } = await import("../src/lib/srd/features.ts");
const { createSheetSchema } = await import("../src/lib/schemas/sheet.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

const find = (list, slug) => {
  const row = list.find((entry) => entry.slug === slug);
  assert.ok(row, `fixture ${slug}`);
  return row;
};
const background = (slug) => backgroundMechanics(find(rows.backgrounds, slug).data);
const raceOptions = packRaceOptions(rows.races);
const race = (id) => {
  const option = raceOptions.find((entry) => entry.id === id);
  assert.ok(option, `race option ${id}`);
  return option;
};

test("no SRD class is proficient in armor, weapons or tools called None", () => {
  assert.equal(rows.srdClasses.length, 12);
  for (const row of rows.srdClasses) {
    const mechanics = classMechanics(row.slug, row.data);
    for (const list of [mechanics.armor, mechanics.weapons, mechanics.tools]) {
      assert.ok(!list.some((entry) => /^none$/i.test(entry)), `${row.slug}: ${list}`);
    }
  }
  const wizard = classMechanics("wizard", find(rows.srdClasses, "wizard").data);
  assert.deepEqual(wizard.armor, []);
  assert.deepEqual(wizard.tools, []);
  assert.deepEqual(wizard.weapons, ["Daggers", "darts", "slings", "quarterstaffs", "light crossbows"]);
  const monk = classMechanics("monk", find(rows.srdClasses, "monk").data);
  assert.deepEqual(monk.armor, []);
  assert.deepEqual(monk.tools, ["Choose one type of artisan's tools or one musical instrument"]);
  assert.deepEqual(classMechanics("fighter", find(rows.srdClasses, "fighter").data).armor, ["All armor", "shields"]);
  assert.deepEqual(classMechanics("bard", find(rows.srdClasses, "bard").data).tools, ["Three musical instruments of your choice"]);
});

test("a pack background's languages, tools and gear carry through, v1 prose and v2 benefits", () => {
  const occultist = background("occultist");
  assert.equal(occultist.languages, 2);
  assert.deepEqual(occultist.knownLanguages, []);
  assert.deepEqual(occultist.tools, ["Thieves' tools"]);
  assert.deepEqual(occultist.equipment, [
    "A book of obscure lore holding clues to an occult location",
    "a bottle of black ink",
    "a quill",
    "a leather-bound journal in which you record your secrets",
    "a bullseye lantern",
    "a set of common clothes",
    "a belt pouch containing 5 gp",
  ]);
  const cultist = background("cultist");
  assert.equal(cultist.languages, 1);
  assert.deepEqual(cultist.equipment, ["Holy symbol (amulet or reliquary)", "common clothes", "robes", "5 torches"]);
  assert.deepEqual(background("deep-hunter").tools, ["Leatherworker’s tools"]);
  assert.deepEqual(background("freebooter").tools, ["Navigator's tools", "vehicles (water)"]);
  const scoundrel = background("scoundrel");
  assert.deepEqual(scoundrel.tools, ["One type of gaming set", "thieves' tools"]);
  assert.equal(scoundrel.equipment[0], "A bag of 1,000 ball bearings");
});

test("negatives grant nothing, choices stay one entry, named languages are known", () => {
  const diplomat = background("diplomat");
  assert.deepEqual(diplomat.tools, []);
  assert.equal(diplomat.languages, 2);
  const freebooter = background("freebooter");
  assert.equal(freebooter.languages, 0);
  assert.deepEqual(freebooter.knownLanguages, []);
  const syndicate = background("crime-syndicate-member");
  assert.deepEqual(syndicate.tools, ["Your choice of one from Thieves’ Tools, Forgery Kit, or Disguise Kit"]);
  assert.deepEqual(syndicate.knownLanguages, ["Thieves’ Cant"]);
  assert.equal(syndicate.languages, 0);
  const forest = background("forest-dweller");
  assert.deepEqual(forest.knownLanguages, ["Sylvan"]);
  assert.equal(forest.languages, 0);
  assert.equal(background("destined").equipment[0], "A dagger, quarterstaff, or spear");
  assert.equal(background("dungeon-robber").languages, 6);
  assert.deepEqual(background("con-artist").tools, ["Two tools of your choice"]);
});

test("the builder's background options carry the pack rows' grants", () => {
  const options = mergedBackgroundOptions(rows.backgrounds.map((row) => ({ ...row, source: "open5e" })));
  const occultist = options.find((option) => option.id === "occultist");
  assert.deepEqual(occultist.tools, ["Thieves' tools"]);
  assert.equal(occultist.languages, 2);
  assert.equal(occultist.equipment.length, 7);
  assert.deepEqual(options.find((option) => option.id === "forest-dweller").knownLanguages, ["Sylvan"]);
  assert.deepEqual(options.find((option) => option.id === "cultist").skills, ["religion"]);
});

test("background skills: the fixed ones are granted, a choice is a pick of its count", () => {
  const artisan = background("artisan");
  assert.deepEqual(artisan.skills, ["persuasion"]);
  assert.deepEqual(artisan.skillChoice, { count: 1, from: ["history", "insight"] });
  assert.deepEqual(background("lyceum-student").skills, []);
  assert.deepEqual(background("lyceum-student").skillChoice, { count: 2, from: ["arcana", "history", "persuasion"] });
  assert.deepEqual(background("guildmember").skillChoice, { count: 2, from: [...ALL_SKILLS] });
  const haunted = background("haunted");
  assert.deepEqual(haunted.skills, ["religion"]);
  assert.deepEqual(haunted.skillChoice, { count: 1, from: [...ALL_SKILLS] });
  const cultist = background("cultist");
  assert.deepEqual(cultist.skills, ["religion"]);
  assert.deepEqual(cultist.skillChoice, { count: 1, from: ["arcana", "deception"] });
  assert.deepEqual(background("crime-syndicate-member").skillChoice, { count: 1, from: ["sleight_of_hand", "stealth"] });
  const occultist = background("occultist");
  assert.deepEqual(occultist.skills, ["arcana", "religion"]);
  assert.equal(occultist.skillChoice, undefined);
});

test("'Any' ability increases become the builder's asiChoice pickers", () => {
  assert.deepEqual(race("human-chassis").asi, {});
  assert.deepEqual(race("human-chassis").asiChoice, { count: 3, amount: 1 });
  assert.deepEqual(race("dwarf-chassis").asi, { con: 1 });
  assert.deepEqual(race("dwarf-chassis").asiChoice, { count: 2, amount: 1 });
  assert.deepEqual(race("humanhalf-elf-heritage").asi, { con: 1 });
  assert.deepEqual(race("humanhalf-elf-heritage").asiChoice, { count: 1, amount: 2 });
  assert.deepEqual(race("shade").asi, { cha: 1 });
  assert.deepEqual(race("shade").asiChoice, { count: 1, amount: 1 });
});

test("only wotc-srd and odm-expanded rows defer to the bundled race; a srd-2024 species is not offered unless a stored character names it", () => {
  // Tome of Heroes' drow shares the bundled drow's slug, so its id carries
  // its document and no SRD reader mistakes it (issue #115).
  assert.equal(raceOptions.some((entry) => entry.id === "drow"), false);
  const drow = race("toh-drow");
  assert.equal(drow.slug, "drow");
  assert.deepEqual(drow.asi, { int: 2 });
  assert.equal(drow.speed, 25);
  assert.equal(drow.weapons, undefined);
  assert.equal(race("delver").speed, 25);
  assert.deepEqual(race("high-elf").skills, ["perception"]);
  assert.equal(race("wood-elf").speed, 35);
  assert.equal(raceOptions.some((entry) => entry.id === "goliath"), false);
  const kept = packRaceOptions(rows.races, ["goliath"]).find((entry) => entry.id === "goliath");
  assert.ok(kept, "a stored srd-2024 goliath keeps its race in an edit");
});

test("a v2 class gets its saves, armor, weapons, tools and skills", () => {
  const marshal = classMechanics("marshal", find(rows.v2Classes, "marshal").data);
  assert.equal(marshal.hitDie, 10);
  assert.deepEqual(marshal.saves, ["con", "wis"]);
  assert.deepEqual(marshal.armor, ["Light armor", "medium armor", "heavy armor", "shields"]);
  assert.deepEqual(marshal.weapons, ["Simple weapons", "martial weapons"]);
  assert.deepEqual(marshal.tools, []);
  assert.deepEqual(marshal.skillChoices, {
    count: 2,
    from: ["athletics", "history", "insight", "intimidation", "medicine", "perception", "persuasion"],
  });
  const mechanist = classMechanics("mechanist", find(rows.v2Classes, "mechanist").data);
  assert.deepEqual(mechanist.saves, ["con", "int"]);
  assert.deepEqual(mechanist.armor, ["Light armor", "medium armor", "shields"]);
  assert.deepEqual(mechanist.tools, ["Tinker tools and two additional tools your choice"]);
  assert.deepEqual(mechanist.skillChoices, {
    count: 2,
    from: ["arcana", "history", "investigation", "perception", "sleight_of_hand"],
  });
});

test("a pack class's Max HP comes from its own hit die", () => {
  const { hitDie } = classMechanics("marshal", find(rows.v2Classes, "marshal").data);
  // d10, CON 14: 10 + 2 at 1st level, 6 + 2 for each level after.
  assert.equal(builderMaxHp(hitDie, "catfolk", 14, 1), 12);
  assert.equal(builderMaxHp(hitDie, "catfolk", 14, 5), 44);
  // The same number the server rule gives a bundled class.
  assert.equal(builderMaxHp(10, "human", 14, 5), suggestedStartingHp("fighter", "human", 14, 5));
});

test("Dwarven Toughness applies under every Hill Dwarf id", () => {
  for (const id of ["hill_dwarf", "hill-dwarf", "odm-hill-dwarf"]) {
    assert.equal(suggestedStartingHp("fighter", id, 14, 5), 49, id);
    assert.equal(builderMaxHp(10, id, 14, 5), 49, id);
  }
});

test("Lightfoot finds its bundled traits; parents that require a subrace are not options", () => {
  assert.ok(racialTraitsFor("lightfoot").length > 0);
  assert.ok(race("lightfoot").traitsSummary.includes("Lucky"));
  const ids = new Set(raceOptions.map((option) => option.id));
  for (const parent of ["dwarf", "elf", "halfling", "gnome", "gearforged", "darakhul", "mushroomfolk"]) {
    assert.ok(!ids.has(parent), parent);
  }
  for (const kept of [
    "hill-dwarf", "high-elf", "lightfoot", "rock-gnome", "human-chassis", "humanhalf-elf-heritage", "acid-cap",
    "catfolk", "malkin", "minotaur", "bhain-kwai", "derro", "mutated", "toh-drow", "delver", "human",
  ]) {
    assert.ok(ids.has(kept), kept);
  }
});

test("backgroundChoices is optional and bounded", () => {
  const field = createSheetSchema.shape.backgroundChoices;
  assert.equal(field.parse(undefined), undefined);
  assert.deepEqual(field.parse({}), { skills: [], gear: [] });
  assert.deepEqual(field.parse({ skills: ["insight"] }), { skills: ["insight"], gear: [] });
  // The either-or lines of the kit, by the alternative's words (issue #127).
  assert.deepEqual(field.parse({ gear: ["Light hammer"] }).gear, ["Light hammer"]);
  assert.equal(field.safeParse({ gear: Array.from({ length: 9 }, () => "Dagger") }).success, false);
  assert.equal(field.safeParse({ skills: ["a", "b", "c", "d", "e"] }).success, false);
  assert.equal(field.safeParse({ skills: ["x".repeat(41)] }).success, false);
});

test("trait names: headings only, and a subrace drops its parent's choice heading", () => {
  assert.deepEqual(race("catfolk").traitNames, ["Cat's Claws", "Hunter's Senses"]);
  assert.deepEqual(race("human-chassis").traitNames, [
    "Construct Resilience", "Construct Vitality", "Living Construct", "Adaptable Acumen", "Inspired Ingenuity",
  ]);
  assert.deepEqual(race("acid-cap").traitNames, [
    "Fungoid Form", "Hardy Survivor", "Acid Cap Resistance", "Acid Spores", "Clan Athlete",
  ]);
  assert.deepEqual(race("mutated").traitNames, [
    "Eldritch Resilience", "Sunlight Sensitivity", "Athletic Training", "Otherworldly Influence",
  ]);
  assert.ok(race("shade").traitNames.includes("Living Origin"));
  assert.deepEqual(raceMechanics(find(rows.races, "elf").data).traitNames, ["Keen Senses", "Fey Ancestry", "Trance"]);
});

test("a pack-only race saves its trait names, and a level-up regrant keeps them", () => {
  const catfolk = race("catfolk");
  const result = buildBuilderResult({
    state: {
      name: "Mira", subclass: "", alignment: "N", gender: "", appearance: "", acOverride: null, portrait: null,
      gold: 15, feats: [], stylePicks: [], optionPicks: [], racialAsi: [], racialSkills: [], racialTool: "",
      racialCantrip: "", backgroundSkills: ["insight"], backstory: "", spells: [], spellWarningAck: true,
    },
    derived: {
      abilities: { str: 10, dex: 14, con: 12, int: 10, wis: 12, cha: 10 },
      preview: { maxHp: 11, proficiencies: { saves: [], skills: [], expertise: [], languages: [], tools: [], armor: [], weapons: [] } },
      effectiveLevel: 1, activeAsiChoices: [], ac: 12, fullEquipment: [], styleSlots: 0,
    },
    race: catfolk,
    klass: { id: "fighter", hitDie: 10, spellAbility: null },
    background: { id: "artisan", name: "Artisan", ...background("artisan") },
  });
  const raceFeatures = result.sheet.features.filter((feature) => feature.source === "race");
  assert.deepEqual(raceFeatures.map((feature) => feature.name), ["Cat's Claws", "Hunter's Senses"]);
  assert.deepEqual(result.sheet.backgroundChoices, { skills: ["insight"], gear: [] });

  const regranted = populateFeaturesForClasses(result.sheet.features, [{ id: "fighter", subclass: "", level: 2 }], "catfolk");
  assert.deepEqual(
    regranted.filter((feature) => feature.source === "race").map((feature) => feature.name),
    ["Cat's Claws", "Hunter's Senses"],
  );
  // A bundled race's traits still come from the bundled data alone.
  const hillDwarf = populateFeaturesForClasses(
    [{ name: "Something Stale", source: "race" }],
    [{ id: "fighter", subclass: "", level: 2 }],
    "hill_dwarf",
  );
  const names = hillDwarf.filter((feature) => feature.source === "race").map((feature) => feature.name);
  assert.ok(!names.includes("Something Stale"));
  assert.deepEqual(names, racialTraitsFor("hill_dwarf").map((feature) => feature.name));
});

test("an either-or increase is one pick from its two abilities, not both or neither", () => {
  // Delver's row lists Strength +1 and Dexterity +1 under "Your Strength or
  // Dexterity score increases by 1"; erina's lists nothing under "either your
  // Wisdom or Charisma score by 1".
  const delver = race("delver");
  assert.deepEqual(delver.asi, { int: 2 });
  assert.deepEqual(delver.asiChoice, { count: 1, amount: 1, from: ["str", "dex"] });
  const erina = race("erina");
  assert.deepEqual(erina.asi, { dex: 2 });
  assert.deepEqual(erina.asiChoice, { count: 1, amount: 1, from: ["wis", "cha"] });
});

test("a race an edit needs stays an option even when its rules ask for a subrace", () => {
  // A character saved on the bare Dwarf before its subraces stood alone.
  const kept = packRaceOptions(rows.races, ["dwarf"]);
  const dwarf = kept.find((option) => option.id === "dwarf");
  assert.ok(dwarf);
  assert.deepEqual(dwarf.asi, { con: 2 });
  assert.equal(dwarf.speed, 25);
  assert.ok(!kept.some((option) => option.id === "elf"));
});

console.log(`\ntest-pack-rows: ${passed} tests passed.`);
