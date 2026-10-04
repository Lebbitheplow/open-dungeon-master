// What each class makes a level 1 character proficient in.
//
// The table below is SRD 5.1's twelve classes, written out: hit die, the two
// saving throws, how many skills from which list, armor, weapons, tools, the
// class's own language, the level the subclass is chosen at, and the features
// of 1st level. Three things are held against it:
//
//   1. ODM's bundled data (src/lib/srd/skills.json, classes.json).
//   2. The sheet the character builder produces for each class
//      (src/app/characters/builder/useBuilderDerived.ts and submit.ts).
//   3. That sheet as the table stores it after
//      POST /api/campaigns/[campaignId]/sheet, with the features the server
//      grants (src/lib/db/sheets.ts createSheet).
//
// So a wrong entry in the data, a grant the builder forgets, and a field the
// route drops each fail here by name.
//
// ODM's own rules, pinned: the artificer is offered beside the SRD twelve (it
// is not in SRD 5.1; its row is ODM's); a class's choice of tools ("three
// musical instruments of your choice") is named by the player's picks on a
// character made here, and a stored one may keep the line; expertise is
// chosen among skills only, never thieves' tools.
import assert from "node:assert/strict";
import "./lib/enforce-world.mjs";
import { suite, abilityMod } from "./lib/enforce-harness.mjs";
import { openCreation } from "./lib/enforce-creation.mjs";
import { openBuilder } from "./lib/enforce-builder.mjs";

const { test, finish } = suite("test-enforce-proficiencies");
const {
  world, atTable, throughLibrary, clearSeat, call, characters, sheets, player, sheetRoute, campaignId,
} = await openCreation();
const builder = await openBuilder();
const srd = await import("../src/lib/srd/index.ts");
const { expertiseSlotsFor, subclassLevelFor } = await import("../src/lib/srd/features.ts");
const { SRD_WEAPONS, isWeaponProficient } = await import("../src/lib/srd/weapons.ts");
const { SRD_ARMOR, isArmorProficient } = await import("../src/lib/srd/armor.ts");

// SRD 5.1, "Using Each Ability".
const SKILLS = {
  acrobatics: "dex", animal_handling: "wis", arcana: "int", athletics: "str", deception: "cha",
  history: "int", insight: "wis", intimidation: "cha", investigation: "int", medicine: "wis",
  nature: "int", perception: "wis", performance: "cha", persuasion: "cha", religion: "int",
  sleight_of_hand: "dex", stealth: "dex", survival: "wis",
};
const ANY_SKILL = Object.keys(SKILLS);
const SIMPLE_MARTIAL = ["simple", "martial"];
const ROGUE_WEAPONS = ["simple", "hand crossbows", "longswords", "rapiers", "shortswords"];
const MAGE_WEAPONS = ["daggers", "darts", "slings", "quarterstaffs", "light crossbows"];

// SRD 5.1, each class's "Class Features": Hit Points, Proficiencies, and the
// 1st-level rows of the class table. `pick` is what the player chooses at
// level 1 for the builder to let the character through.
const CLASSES = {
  barbarian: {
    die: 12, saves: ["str", "con"], count: 2, armor: ["light", "medium", "shields"], weapons: SIMPLE_MARTIAL, tools: [],
    skills: ["animal_handling", "athletics", "intimidation", "nature", "perception", "survival"],
    subclassAt: 3, features: ["Rage", "Unarmored Defense"],
  },
  bard: {
    die: 8, saves: ["dex", "cha"], count: 3, armor: ["light"], weapons: ROGUE_WEAPONS, tools: ["three musical instruments of your choice"],
    skills: ANY_SKILL, subclassAt: 3, features: ["Spellcasting", "Bardic Inspiration"], cantrips: 2, spells: 4,
  },
  cleric: {
    die: 8, saves: ["wis", "cha"], count: 2, armor: ["light", "medium", "shields"], weapons: ["simple"], tools: [],
    skills: ["history", "insight", "medicine", "persuasion", "religion"],
    subclassAt: 1, features: ["Spellcasting", "Divine Domain"], cantrips: 3, spells: "wis", pick: { subclass: "Life Domain" },
  },
  druid: {
    die: 8, saves: ["int", "wis"], count: 2, armor: ["light", "medium", "shields (nonmetal)"], tools: ["herbalism kit"],
    weapons: ["clubs", "daggers", "darts", "javelins", "maces", "quarterstaffs", "scimitars", "sickles", "slings", "spears"],
    skills: ["arcana", "animal_handling", "insight", "medicine", "nature", "perception", "religion", "survival"],
    subclassAt: 2, features: ["Druidic", "Spellcasting"], cantrips: 2, spells: "wis", language: "Druidic",
  },
  fighter: {
    die: 10, saves: ["str", "con"], count: 2, armor: ["light", "medium", "heavy", "shields"], weapons: SIMPLE_MARTIAL, tools: [],
    skills: ["acrobatics", "animal_handling", "athletics", "history", "insight", "intimidation", "perception", "survival"],
    subclassAt: 3, features: ["Fighting Style", "Second Wind"], pick: { stylePicks: ["defense"] },
  },
  monk: {
    die: 8, saves: ["str", "dex"], count: 2, armor: [], weapons: ["simple", "shortswords"],
    tools: ["one artisan's tools or one musical instrument of your choice"],
    skills: ["acrobatics", "athletics", "history", "insight", "religion", "stealth"],
    subclassAt: 3, features: ["Unarmored Defense", "Martial Arts"],
  },
  paladin: {
    die: 10, saves: ["wis", "cha"], count: 2, armor: ["light", "medium", "heavy", "shields"], weapons: SIMPLE_MARTIAL, tools: [],
    skills: ["athletics", "insight", "intimidation", "medicine", "persuasion", "religion"],
    subclassAt: 3, features: ["Divine Sense", "Lay on Hands"],
  },
  ranger: {
    die: 10, saves: ["str", "dex"], count: 3, armor: ["light", "medium", "shields"], weapons: SIMPLE_MARTIAL, tools: [],
    skills: ["animal_handling", "athletics", "insight", "investigation", "nature", "perception", "stealth", "survival"],
    subclassAt: 3, features: ["Favored Enemy", "Natural Explorer"],
  },
  rogue: {
    die: 8, saves: ["dex", "int"], count: 4, armor: ["light"], weapons: ROGUE_WEAPONS, tools: ["thieves' tools"],
    skills: ["acrobatics", "athletics", "deception", "insight", "intimidation", "investigation", "perception", "performance", "persuasion", "sleight_of_hand", "stealth"],
    subclassAt: 3, features: ["Expertise", "Sneak Attack", "Thieves' Cant"], language: "Thieves' Cant", expertise: 2,
  },
  sorcerer: {
    die: 6, saves: ["con", "cha"], count: 2, armor: [], weapons: MAGE_WEAPONS, tools: [],
    skills: ["arcana", "deception", "insight", "intimidation", "persuasion", "religion"],
    subclassAt: 1, features: ["Spellcasting", "Sorcerous Origin"], cantrips: 4, spells: 2, pick: { subclass: "Draconic Bloodline" },
  },
  warlock: {
    die: 8, saves: ["wis", "cha"], count: 2, armor: ["light"], weapons: ["simple"], tools: [],
    skills: ["arcana", "deception", "history", "intimidation", "investigation", "nature", "religion"],
    subclassAt: 1, features: ["Otherworldly Patron", "Pact Magic"], cantrips: 2, spells: 2, pick: { subclass: "The Fiend" },
  },
  wizard: {
    die: 6, saves: ["int", "wis"], count: 2, armor: [], weapons: MAGE_WEAPONS, tools: [],
    skills: ["arcana", "history", "insight", "investigation", "medicine", "religion"],
    subclassAt: 2, features: ["Spellcasting", "Arcane Recovery"], cantrips: 3, spells: "int", book: 6,
  },
};

// Real SRD spells, each from its class's own list (SRD 5.1, Spell Lists):
// the server holds a new caster's spells to the list of the class.
const CANTRIPS_BY_CLASS = {
  bard: ["Light", "Mage Hand"],
  cleric: ["Light", "Guidance", "Sacred Flame"],
  druid: ["Guidance", "Druidcraft"],
  sorcerer: ["Light", "Mage Hand", "Prestidigitation", "Fire Bolt"],
  warlock: ["Mage Hand", "Prestidigitation"],
  wizard: ["Light", "Mage Hand", "Prestidigitation"],
};
const SPELLS_BY_CLASS = {
  bard: ["Detect Magic", "Sleep", "Charm Person", "Comprehend Languages"],
  // Not Bless or Cure Wounds: the Life Domain prepares those for free.
  cleric: ["Detect Magic", "Sanctuary", "Guiding Bolt", "Shield of Faith"],
  druid: ["Detect Magic", "Charm Person", "Cure Wounds", "Entangle"],
  sorcerer: ["Detect Magic", "Sleep"],
  warlock: ["Charm Person", "Comprehend Languages"],
  wizard: ["Detect Magic", "Sleep", "Charm Person", "Comprehend Languages", "Feather Fall", "Identify"],
};
const sorted = (list) => [...list].sort();

// The standard array with the class's casting ability (or its first save)
// given the 15, then a human's +1 on each.
function scoresFor(classId) {
  const row = CLASSES[classId];
  const lead = typeof row.spells === "string" ? row.spells : row.saves[0];
  const order = [lead, ...["con", "dex", "str", "wis", "int", "cha"].filter((ability) => ability !== lead)];
  return Object.fromEntries(order.map((ability, index) => [ability, [15, 14, 13, 12, 10, 8][index]]));
}

// A level 1 human acolyte of the class. The acolyte brings Insight and
// Religion, so the class's picks are the first of its list that are neither.
const toolChoices = await import("../src/lib/srd/tool-choices.ts");

function buildClass(classId, fields = {}) {
  const row = CLASSES[classId];
  const scores = scoresFor(classId);
  const chosenSkills = row.skills.filter((skill) => skill !== "insight" && skill !== "religion").slice(0, row.count);
  const casting = typeof row.spells === "string" ? abilityMod(scores[row.spells] + 1) + 1 : (row.spells ?? 0);
  const book = (SPELLS_BY_CLASS[classId] ?? []).slice(0, row.book ?? casting);
  return builder.build({
    race: "human",
    class: classId,
    background: "acolyte",
    scores,
    chosenSkills,
    bonusLanguages: ["Dwarvish", "Elvish", "Giant"],
    expertisePicks: chosenSkills.slice(0, row.expertise ?? 0),
    cantrips: (CANTRIPS_BY_CLASS[classId] ?? []).slice(0, row.cantrips ?? 0),
    spells: book,
    bookPrepared: book.slice(0, casting),
    ...(row.pick ?? {}),
    ...fields,
  });
}

await test("the eighteen skills, each under its ability", () => {
  assert.equal(srd.SRD_SKILLS.length, 18);
  assert.deepEqual(
    Object.fromEntries(srd.SRD_SKILLS.map((skill) => [skill.id, skill.ability])),
    SKILLS,
  );
  assert.equal(new Set(srd.SRD_SKILLS.map((skill) => skill.name)).size, 18);
});

await test("the bundled class table is SRD 5.1's, all twelve", () => {
  for (const [classId, row] of Object.entries(CLASSES)) {
    const klass = srd.findClass(classId);
    assert.ok(klass, classId);
    assert.equal(klass.hitDie, row.die, `${classId} hit die`);
    assert.deepEqual(klass.saves, row.saves, `${classId} saves`);
    assert.equal(klass.skillChoices.count, row.count, `${classId} skill count`);
    assert.deepEqual(sorted(klass.skillChoices.from), sorted(row.skills), `${classId} skill list`);
    assert.deepEqual(klass.armor, row.armor, `${classId} armor`);
    assert.deepEqual(sorted(klass.weapons), sorted(row.weapons), `${classId} weapons`);
    assert.deepEqual(klass.tools, row.tools, `${classId} tools`);
    assert.deepEqual(klass.languages ?? [], row.language ? [row.language] : [], `${classId} language`);
    assert.equal(subclassLevelFor(classId), row.subclassAt, `${classId} subclass level`);
  }
  // Exactly two saves each, and every save is given by some class.
  assert.ok(Object.values(CLASSES).every((row) => row.saves.length === 2));
});

await test("ODM's rule: the artificer sits beside the SRD twelve", () => {
  // Not in SRD 5.1. Pinned so a change to the list is a decision.
  assert.deepEqual(
    sorted(srd.SRD_CLASSES.map((klass) => klass.id)),
    sorted([...Object.keys(CLASSES), "artificer"]),
  );
  const artificer = srd.findClass("artificer");
  assert.equal(artificer.hitDie, 8);
  assert.deepEqual(artificer.saves, ["con", "int"]);
  assert.equal(artificer.skillChoices.count, 2);
});

await test("expertise: two skills for a rogue at 1 and 6, a bard at 3 and 10, nobody else", () => {
  for (let level = 1; level <= 20; level += 1) {
    assert.equal(expertiseSlotsFor("rogue", level), level >= 6 ? 4 : 2, `rogue ${level}`);
    assert.equal(expertiseSlotsFor("bard", level), level >= 10 ? 4 : level >= 3 ? 2 : 0, `bard ${level}`);
    for (const classId of Object.keys(CLASSES)) {
      if (classId !== "rogue" && classId !== "bard") {
        assert.equal(expertiseSlotsFor(classId, level), 0, `${classId} ${level}`);
      }
    }
  }
});

await test("the builder makes each class proficient in what the class grants, and the table stores it", async () => {
  for (const [classId, row] of Object.entries(CLASSES)) {
    const built = buildClass(classId);
    assert.equal(built.blocker, null, `${classId}: ${built.blocker?.message}`);
    const outcome = await atTable(built.sheet);
    assert.equal(outcome.status, 201, `${classId}: ${outcome.error}`);
    const { sheet } = outcome;
    const profs = sheet.proficiencies;
    assert.equal(sheet.level, 1);
    assert.deepEqual(profs.saves, row.saves, `${classId} saves`);
    assert.deepEqual(profs.armor, row.armor, `${classId} armor`);
    assert.deepEqual(sorted(profs.weapons), sorted(row.weapons), `${classId} weapons`);
    // The acolyte adds no tools; a human no training. A grant that leaves
    // the tool open is named on the sheet by the player's picks (the rig
    // picks the first tools of each list, scripts/lib/enforce-builder.mjs).
    const open = toolChoices.splitToolGrants(row.tools);
    assert.deepEqual(profs.tools, [...open.fixed, ...open.choices.flatMap((choice) => choice.from.slice(0, choice.count))], `${classId} tools`);
    assert.deepEqual(
      sorted(profs.languages),
      sorted(["Common", "Dwarvish", "Elvish", "Giant", ...(row.language ? [row.language] : [])]),
      `${classId} languages`,
    );
    // The class's count from the class's list, and the acolyte's two.
    assert.equal(profs.skills.length, row.count + 2, `${classId} skill count`);
    assert.equal(new Set(profs.skills).size, profs.skills.length, `${classId} repeats a skill`);
    assert.ok(profs.skills.includes("insight") && profs.skills.includes("religion"), `${classId} acolyte skills`);
    for (const skill of profs.skills.filter((entry) => entry !== "insight" && entry !== "religion")) {
      assert.ok(row.skills.includes(skill), `${classId} took ${skill}`);
    }
    assert.equal(profs.expertise.length, row.expertise ?? 0, `${classId} expertise`);
    // One hit die of the class's size, and its maximum plus CON for hit points
    // (plus Draconic Resilience's one for a Draconic Bloodline sorcerer).
    assert.deepEqual(sheet.hitDice, { die: `d${row.die}`, total: 1, spent: 0 }, `${classId} hit dice`);
    const draconic = classId === "sorcerer" && /draconic/i.test(sheet.subclass ?? "") ? 1 : 0;
    assert.equal(sheet.maxHp, row.die + abilityMod(sheet.abilities.con) + draconic, `${classId} hit points`);
    assert.equal(sheet.currentHp, sheet.maxHp);
    const granted = sheet.features.filter((feature) => feature.source === "class").map((feature) => feature.name);
    for (const feature of row.features) {
      assert.ok(granted.some((name) => name === feature || name.startsWith(`${feature} (`)), `${classId} lacks ${feature}: ${granted}`);
    }
    assert.equal(
      sheet.features.filter((feature) => feature.source === "class" && (feature.level ?? 1) > 1).length,
      0,
      `${classId} holds a feature from beyond level 1`,
    );
  }
});

await test("a caster's first level: cantrips, spells and slots by the class table", () => {
  // SRD 5.1 spellcasting tables, level 1. Paladins and rangers cast from 2.
  const SLOTS = { bard: { 1: 2 }, cleric: { 1: 2 }, druid: { 1: 2 }, sorcerer: { 1: 2 }, wizard: { 1: 2 }, warlock: { 1: 1 } };
  for (const [classId, row] of Object.entries(CLASSES)) {
    const built = buildClass(classId);
    const casting = built.sheet.spellcasting;
    if (!SLOTS[classId]) {
      assert.equal(built.derived.casts, false, `${classId} casts at level 1`);
      assert.deepEqual(srd.spellSlotsFor(classId, 1), {}, `${classId} slots`);
      assert.deepEqual(casting?.slots ?? {}, {}, `${classId} slots on the sheet`);
      continue;
    }
    assert.equal(built.derived.cantripAdvice, row.cantrips, `${classId} cantrips`);
    assert.deepEqual(srd.spellSlotsFor(classId, 1), SLOTS[classId], `${classId} slots`);
    assert.deepEqual(casting.slots, Object.fromEntries(Object.entries(SLOTS[classId]).map(([level, max]) => [level, { max, used: 0 }])));
    const expected = typeof row.spells === "string" ? abilityMod(built.sheet.abilities[row.spells]) + 1 : row.spells;
    assert.equal(built.derived.spellAdvice.count, expected, `${classId} spells`);
    assert.equal(built.derived.spellbookAdvice, row.book ?? null, `${classId} spellbook`);
    assert.equal(casting.cantrips.length, row.cantrips);
    assert.equal(casting.ability, typeof row.spells === "string" ? row.spells : "cha");
  }
});

await test("the builder asks for every pick the class is owed before it lets a character through", () => {
  const blocked = (fields, classId = "rogue") => buildClass(classId, fields).blocker?.kind === "error";
  // A rogue takes four skills and two expertise picks among them.
  assert.equal(blocked({ chosenSkills: ["acrobatics", "athletics", "deception"], expertisePicks: ["acrobatics", "athletics"] }), true);
  assert.equal(blocked({ expertisePicks: [] }), true);
  assert.equal(blocked({ expertisePicks: ["acrobatics"] }), true);
  // Expertise in a skill the rogue lacks is not a pick, and stays off the sheet.
  const untrained = buildClass("rogue", { expertisePicks: ["arcana", "acrobatics"] });
  assert.equal(untrained.blocker?.kind, "error");
  assert.deepEqual(untrained.sheet.proficiencies.expertise, ["acrobatics"]);
  // A fighter's style, a human acolyte's three languages.
  assert.equal(blocked({ stylePicks: [] }, "fighter"), true);
  assert.equal(blocked({ bonusLanguages: ["Dwarvish"] }, "fighter"), true);
  // One style at level 1, whatever the state holds.
  const styles = buildClass("fighter", { stylePicks: ["defense", "archery", "dueling"] });
  assert.deepEqual(styles.sheet.features.map((feature) => feature.name), ["Fighting Style: Defense"]);
});

await test("The builder re-checks every pick once more as the sheet is built, so the sheet it submits carries only what the class, race and background allow (rules-coverage.md, Character build).", () => {
  const offList = buildClass("fighter", { chosenSkills: ["arcana", "stealth"] });
  assert.ok(offList.blocker || !offList.sheet.proficiencies.skills.includes("arcana"), "a fighter with Arcana and Stealth as class skills");
  const tooMany = buildClass("fighter", { chosenSkills: ["acrobatics", "athletics", "history", "perception"] });
  assert.ok(tooMany.blocker || tooMany.sheet.proficiencies.skills.length === 4, "a fighter with four class skills");
  const expert = buildClass("fighter", { expertisePicks: ["acrobatics", "athletics"] });
  assert.ok(expert.blocker || expert.sheet.proficiencies.expertise.length === 0, "a fighter with expertise");
  const four = buildClass("rogue", { expertisePicks: ["acrobatics", "athletics", "deception", "stealth"] });
  assert.ok(four.blocker || four.sheet.proficiencies.expertise.length === 2, "a level 1 rogue with four expertise picks");
  const tongues = buildClass("fighter", { bonusLanguages: ["Dwarvish", "Elvish", "Giant", "Draconic", "Infernal"] });
  assert.ok(tongues.blocker || tongues.sheet.proficiencies.languages.length === 4, "a human acolyte with five chosen languages");
});

await test("a subclass is asked for at the class's level, and not before", () => {
  for (const [classId, row] of Object.entries(CLASSES)) {
    const early = buildClass(classId, { subclass: "Something" });
    assert.equal(early.sheet.subclass, row.subclassAt === 1 ? "Something" : "", `${classId} at level 1`);
    if (row.subclassAt === 1) {
      const missing = buildClass(classId, { subclass: "" });
      assert.equal(missing.blocker?.kind, "error", `${classId} with no subclass at level 1`);
    }
  }
});

await test("weapon and armor training cover what the class's list says, and nothing else", () => {
  const weapon = (name) => SRD_WEAPONS.find((entry) => entry.name === name);
  const armor = (name) => SRD_ARMOR.find((entry) => entry.name === name);
  // SRD 5.1 weapon table: category of each weapon named here.
  const CASES = {
    wizard: { yes: ["Dagger", "Dart", "Sling", "Quarterstaff", "Light Crossbow"], no: ["Club", "Mace", "Shortsword", "Longsword", "Longbow"] },
    druid: { yes: ["Club", "Dagger", "Dart", "Javelin", "Mace", "Quarterstaff", "Scimitar", "Sickle", "Sling", "Spear"], no: ["Handaxe", "Light Crossbow", "Shortbow", "Longsword", "Rapier"] },
    rogue: { yes: ["Club", "Dagger", "Shortbow", "Hand Crossbow", "Longsword", "Rapier", "Shortsword"], no: ["Battleaxe", "Longbow", "Greatsword", "Heavy Crossbow", "Scimitar"] },
    monk: { yes: ["Club", "Dagger", "Quarterstaff", "Shortsword", "Light Crossbow"], no: ["Longsword", "Rapier", "Longbow", "Scimitar"] },
    cleric: { yes: ["Mace", "Light Crossbow", "Spear"], no: ["Longsword", "Warhammer", "Longbow"] },
    fighter: { yes: ["Dagger", "Longsword", "Greatsword", "Longbow", "Heavy Crossbow", "Lance"], no: [] },
  };
  for (const [classId, { yes, no }] of Object.entries(CASES)) {
    const held = srd.findClass(classId).weapons;
    for (const name of yes) {
      assert.ok(weapon(name), `no ${name} in the weapon table`);
      assert.equal(isWeaponProficient(held, weapon(name)), true, `${classId} with a ${name}`);
    }
    for (const name of no) {
      assert.ok(weapon(name), `no ${name} in the weapon table`);
      assert.equal(isWeaponProficient(held, weapon(name)), false, `${classId} with a ${name}`);
    }
  }
  const wears = (classId, name) => isArmorProficient(srd.findClass(classId).armor, armor(name));
  for (const classId of ["wizard", "sorcerer", "monk"]) {
    for (const name of ["Leather", "Chain Shirt", "Plate", "Shield"]) {
      assert.equal(wears(classId, name), false, `${classId} in ${name}`);
    }
  }
  for (const classId of ["bard", "rogue", "warlock"]) {
    assert.equal(wears(classId, "Leather"), true);
    assert.equal(wears(classId, "Studded Leather"), true);
    assert.equal(wears(classId, "Hide"), false, `${classId} in hide`);
    assert.equal(wears(classId, "Shield"), false, `${classId} with a shield`);
  }
  for (const classId of ["barbarian", "cleric", "druid", "ranger"]) {
    assert.equal(wears(classId, "Scale Mail"), true);
    assert.equal(wears(classId, "Shield"), true);
    assert.equal(wears(classId, "Chain Mail"), false, `${classId} in chain mail`);
    assert.equal(wears(classId, "Plate"), false, `${classId} in plate`);
  }
  for (const classId of ["fighter", "paladin"]) {
    for (const name of ["Leather", "Half Plate", "Plate", "Shield"]) {
      assert.equal(wears(classId, name), true, `${classId} in ${name}`);
    }
  }
});

const tools = await import("../src/lib/srd/tool-choices.ts");

await test("a tool sentence is read as a pick among named tools, and the picks are checked against it", () => {
  const bard = tools.toolChoiceOf("three musical instruments of your choice");
  assert.equal(bard.count, 3);
  assert.ok(bard.from.includes("lute") && !bard.from.includes("smith's tools"));
  const monk = tools.toolChoiceOf("one artisan's tools or one musical instrument of your choice");
  assert.equal(monk.count, 1);
  assert.ok(monk.from.includes("smith's tools") && monk.from.includes("flute"));
  assert.equal(tools.toolChoiceOf("thieves' tools"), null);
  assert.deepEqual(tools.splitToolGrants(["disguise kit", "one musical instrument"]).fixed, ["disguise kit"]);
  assert.equal(tools.toolPickProblem([bard], ["lute", "drum", "flute"]), null);
  assert.ok(tools.toolPickProblem([bard], ["lute", "drum"]));
  assert.ok(tools.toolPickProblem([bard], ["lute", "drum", "smith's tools"]));
  assert.ok(tools.toolPickProblem([bard], ["lute", "drum", "flute", "horn"]));
  // A content-pack background names the tools it offers (Crime Syndicate
  // Member), with a curly apostrophe.
  const named = tools.toolChoiceOf("Your choice of one from Thieves’ Tools, Forgery Kit, or Disguise Kit");
  assert.deepEqual(named, { count: 1, from: ["thieves' tools", "forgery kit", "disguise kit"], label: "tool" });
  assert.equal(tools.toolPickProblem([named], ["forgery kit"]), null);
  assert.ok(tools.toolPickProblem([named], ["lute"]));
});

// The content pack's druid row, as Open5e writes it: its armor training is a
// sentence longer than the sheet keeps a training name.
const PACK_DRUID_ROW = {
  slug: "druid",
  name: "Druid",
  source: "wotc-srd",
  documentSlug: "wotc-srd",
  data: {
    hit_dice: "1d8",
    prof_armor: "Light armor, medium armor, shields (druids will not wear armor or use shields made of metal)",
    prof_weapons: "Clubs, daggers, darts, javelins, maces, quarterstaffs, scimitars, sickles, slings, spears",
    prof_tools: "Herbalism kit",
    prof_saving_throws: "Intelligence, Wisdom",
    prof_skills: "Choose two from Arcana, Animal Handling, Insight, Medicine, Nature, Perception, Religion, and Survival",
    spellcasting_ability: "Wisdom",
  },
};

await test("a druid built from the content pack's class list joins the table, trained as the bundled druid", async () => {
  const options = await import("../src/lib/characters/options.ts");
  const packDruid = options.packClassOptions([PACK_DRUID_ROW]).find((row) => row.id === "druid");
  assert.deepEqual(packDruid.armor, CLASSES.druid.armor);
  const built = buildClass("druid", { class: packDruid });
  assert.equal(built.blocker, null, built.blocker?.message);
  const joined = await atTable(built.sheet);
  assert.equal(joined.status, 201, joined.error);
  assert.deepEqual(joined.sheet.proficiencies.armor, CLASSES.druid.armor);
});

await test("an app built before that fix still joins with the pack's armor sentence; the server writes the training", async () => {
  const druid = buildClass("druid").sheet;
  const sentence = "shields (druids will not wear armor or use shields made of metal)";
  const joined = await atTable({
    ...druid,
    proficiencies: { ...druid.proficiencies, armor: ["Light armor", "medium armor", sentence] },
  });
  assert.equal(joined.status, 201, joined.error);
  assert.deepEqual(joined.sheet.proficiencies.armor, CLASSES.druid.armor);
});

await test("A bard is proficient with three musical instruments of their choice, a monk with one artisan's tool or instrument: the sheet names the ones chosen.", () => {
  for (const classId of ["bard", "monk"]) {
    const tools = buildClass(classId).sheet.proficiencies.tools;
    assert.ok(tools.length > 0, `${classId} has no tools`);
    assert.ok(!tools.some((tool) => /choice|\bone\b|\bthree\b/i.test(tool)), `${classId} is proficient in "${tools.join('", "')}"`);
  }
});

await test("a tool pick that is not among the grant's choices is refused, and the right ones are stored by name", async () => {
  const bard = buildClass("bard");
  const off = {
    ...bard.sheet,
    proficiencies: { ...bard.sheet.proficiencies, tools: ["lute", "drum", "smith's tools"] },
  };
  const refused = await atTable(off);
  assert.equal(refused.status, 400, "a bard stored smith's tools as an instrument");
  const chosen = {
    ...bard.sheet,
    proficiencies: { ...bard.sheet.proficiencies, tools: ["lute", "horn", "viol"] },
  };
  const stored = await atTable(chosen);
  assert.equal(stored.status, 201, stored.error);
  assert.deepEqual(stored.sheet.proficiencies.tools, ["lute", "horn", "viol"]);
});

await test("the builder picks no tool for the player: the class step waits until each open tool grant is answered", () => {
  const none = buildClass("bard", { toolPicks: [] });
  assert.deepEqual(none.derived.toolGrants.chosen, [], "a tool was picked for the player");
  assert.equal(none.blocker?.message, "Pick 3 more musical instruments for your tool proficiency.");
  // The Calling step's own gate says the same, on the step where it is fixed.
  const bardRow = builder.classes.find((row) => row.id === "bard");
  assert.equal(
    builder.submit.callingBlocker(bardRow, none.state, none.derived),
    "Pick 3 more musical instruments for your tool proficiency.",
  );
  const two = buildClass("bard", { toolPicks: ["viol", "lute"] });
  assert.deepEqual(two.derived.toolGrants.chosen, ["viol", "lute"]);
  assert.equal(two.blocker?.message, "Pick 1 more musical instrument for your tool proficiency.");
  const three = buildClass("bard", { toolPicks: ["viol", "lute", "horn"] });
  assert.equal(three.blocker, null, three.blocker?.message);
  assert.deepEqual(three.sheet.proficiencies.tools, ["viol", "lute", "horn"]);
  const monk = buildClass("monk", { toolPicks: [] });
  assert.equal(monk.blocker?.message, "Pick 1 more artisan's tools or musical instrument for your tool proficiency.");
});

await test("a character made at a table or in the library names the tools an open grant leaves to it; a stored one keeps the grant's words", async () => {
  const bard = buildClass("bard").sheet;
  const unnamed = { ...bard, proficiencies: { ...bard.proficiencies, tools: ["three musical instruments of your choice"] } };
  const table = await atTable(unnamed);
  assert.equal(table.status, 400, "a bard was made at the table with no instrument named");
  assert.match(table.error, /Choose 3 musical instruments/);
  const short = await atTable({ ...bard, proficiencies: { ...bard.proficiencies, tools: ["lute"] } });
  assert.equal(short.status, 400, "a bard was made at the table with one instrument of three");
  const library = await throughLibrary(unnamed);
  assert.equal(library.status, 400, "a bard was made in the library with no instrument named");
  assert.match(library.error, /Choose 3 musical instruments/);
  assert.equal(library.character, null);
  // A library character stored before the pick existed still enters play
  // (the "stored" door), with the grant's own words.
  clearSeat();
  const old = characters.createCharacter(player.id, 1, { ...unnamed, portrait: { url: "/uploads/test.png" } });
  world.signIn(player);
  const joined = await call(sheetRoute, "POST", { libraryCharacterId: old.id }, { campaignId });
  assert.equal(joined.status, 201, joined.json.error);
  assert.ok(
    sheets.getSheetForUser(campaignId, player.id).proficiencies.tools.includes("three musical instruments of your choice"),
  );
});

world.close();
finish();
