// What the server accepts as a new character: what the character can DO.
//
// Under SRD 5.1 a class grants exactly two saving throw proficiencies, a
// fixed count of skills from its own list, and its armor, weapon and tool
// training; the background adds two skills; the race adds what its traits
// say. Expertise belongs to rogues (level 1) and bards (level 3). Feats come
// from an ability score improvement (level 4 at the earliest) or the variant
// human. Class features arrive at the level the class table gives them, spell
// slots from the class's slot table, and a character attunes to three items.
//
// The server grants class features, racial traits and the background feature
// itself (src/lib/db/sheets.ts createSheet, src/lib/srd/features.ts), and
// holds the spell lists to the tables (src/lib/srd/spell-prep.ts
// spellListProblems). Those are the test()s. Everything else on the sheet is
// taken from the request as sent, and each gap() shows one thing a request
// can walk away with. A gap passes when the illegal sheet is refused OR
// stored corrected.
//
// ODM's own rules, pinned here: an unknown class or race is accepted
// (homebrew and content-pack rows have no server-side table), and a feature
// with source "story" or "feat" survives every regrant, which is how the DM
// hands out boons in play. SRD 5.1 has neither notion; the second is a gap at
// creation only, where the one writing the sheet is the player.
import assert from "node:assert/strict";
import "./lib/enforce-world.mjs";
import { suite, abilityMod } from "./lib/enforce-harness.mjs";
import { LEGAL_FIGHTER, LEGAL_WIZARD, openCreation } from "./lib/enforce-creation.mjs";
import { openBuilder } from "./lib/enforce-builder.mjs";

const { test, finish } = suite("test-enforce-creation-grants");
const { world, atTable } = await openCreation();
const builder = await openBuilder();
const { computeSheetDerived } = await import("../src/lib/srd/index.ts");
const { combatRiders } = await import("../src/lib/srd/feature-effects.ts");

const fighterProfs = (overrides) => ({ proficiencies: { ...LEGAL_FIGHTER.proficiencies, ...overrides } });
const wizardProfs = (overrides) => ({ proficiencies: { ...LEGAL_WIZARD.proficiencies, ...overrides } });
const names = (sheet) => sheet.features.map((feature) => feature.name);

const LEGAL_WARLOCK = {
  ...LEGAL_FIGHTER,
  name: "Morrow",
  class: "warlock",
  background: "charlatan",
  abilities: { str: 9, dex: 15, con: 14, int: 11, wis: 13, cha: 16 },
  maxHp: 10,
  hitDice: { die: "d8", total: 1, spent: 0 },
  proficiencies: {
    saves: ["wis", "cha"],
    skills: ["arcana", "intimidation", "deception", "sleight_of_hand"],
    expertise: [],
    languages: ["Common", "Infernal"],
    tools: ["disguise kit", "forgery kit"],
    armor: ["light"],
    weapons: ["simple"],
  },
  equipment: [{ name: "Leather", qty: 1 }, { name: "Dagger", qty: 1 }],
  features: [],
  spellcasting: {
    ability: "cha",
    slots: { 1: { max: 1, used: 0 } },
    prepared: [],
    known: ["Hex", "Hellish Rebuke"],
    cantrips: ["Eldritch Blast", "Mage Hand"],
  },
};

function holds(outcome, legal, message) {
  if (outcome.status >= 400) {
    assert.equal(outcome.sheet, null, "a refused character must not be stored");
    return;
  }
  assert.ok(outcome.sheet, "accepted but nothing stored");
  assert.ok(legal(outcome.sheet), message);
}

// ---- what is enforced today ----

await test("class and race features are the server's grant, not the request's", async () => {
  const { status, sheet } = await atTable({
    ...LEGAL_WIZARD,
    features: [
      { name: "Extra Attack (3)", source: "class", level: 1 },
      { name: "Sneak Attack", source: "class" },
      { name: "Superior Darkvision 120 ft", source: "race" },
      { name: "Relentless Endurance", source: "race" },
    ],
  });
  assert.equal(status, 201);
  // SRD 5.1 wizard, level 1: Spellcasting and Arcane Recovery. High elf:
  // darkvision, Keen Senses, Fey Ancestry, Trance, a cantrip.
  const granted = names(sheet);
  for (const stolen of ["Extra Attack (3)", "Sneak Attack", "Superior Darkvision 120 ft", "Relentless Endurance"]) {
    assert.ok(!granted.includes(stolen), `${stolen} was kept`);
  }
  for (const earned of ["Spellcasting", "Arcane Recovery", "Darkvision 60 ft", "Trance", "Researcher (Sage)"]) {
    assert.ok(granted.includes(earned), `${earned} is missing`);
  }
  assert.equal(combatRiders(sheet).extraAttacks, 0);
  assert.deepEqual(Object.keys(sheet.resources), ["arcane_recovery"]);
});

await test("a pick from a list no class on the sheet opens is dropped", async () => {
  // A wizard has no Fighting Style; a level 1 warlock has no invocations
  // (SRD 5.1: two at level 2); a level 1 fighter has one style, not three.
  const wizard = await atTable({ ...LEGAL_WIZARD, features: [{ name: "Fighting Style: Archery", source: "choice" }] });
  assert.ok(!names(wizard.sheet).includes("Fighting Style: Archery"));
  assert.equal(combatRiders(wizard.sheet).rangedAttackBonus, 0);

  const warlock = await atTable({
    ...LEGAL_WARLOCK,
    features: [{ name: "Invocation: Agonizing Blast", source: "choice" }, { name: "Pact Boon: Pact of the Blade", source: "choice" }],
  });
  assert.equal(warlock.status, 201);
  assert.deepEqual(names(warlock.sheet).filter((name) => /^(Invocation|Pact Boon):/.test(name)), []);

  const fighter = await atTable({
    ...LEGAL_FIGHTER,
    features: ["Archery", "Defense", "Dueling"].map((style) => ({ name: `Fighting Style: ${style}`, source: "choice" })),
  });
  assert.deepEqual(names(fighter.sheet).filter((name) => name.startsWith("Fighting Style: ")), ["Fighting Style: Archery"]);
});

await test("the spell lists are held to the class tables", async () => {
  const casting = LEGAL_WIZARD.spellcasting;
  const bad = {
    // SRD 5.1 wizard, level 1: 3 cantrips, a book of 6, INT modifier + level
    // prepared (3 + 1), and nothing above 1st level.
    "a fourth cantrip": { ...casting, cantrips: [...casting.cantrips, "Ray of Frost"] },
    "a fifth prepared spell": { ...casting, prepared: [...casting.prepared, "Detect Magic"] },
    "a seventh spell in the book": { ...casting, spellbook: [...casting.spellbook, "Thunderwave"] },
    "a 3rd level spell": { ...casting, prepared: ["Fireball"], spellbook: ["Fireball"] },
  };
  for (const [label, spellcasting] of Object.entries(bad)) {
    const outcome = await atTable({ ...LEGAL_WIZARD, spellcasting });
    assert.equal(outcome.status, 400, label);
    assert.equal(outcome.sheet, null, label);
  }
  const fighter = await atTable({
    ...LEGAL_FIGHTER,
    spellcasting: { ability: "int", slots: { 9: { max: 4, used: 0 } }, prepared: ["Wish"], known: [], cantrips: [] },
  });
  assert.equal(fighter.status, 400);
  assert.equal(fighter.sheet, null);
});

await test("a class or a race nobody published is refused, and one the content pack carries is read from its row", async () => {
  // This case used to pin "any name is accepted as written and granted
  // nothing". The owner's decision is that the server enforces the rules, and
  // a class with no table has no rules to enforce, so a name no bundled
  // table, content pack row or homebrew entry answers to is refused.
  for (const stranger of [{ class: "demigod" }, { race: "moonfolk" }, { background: "time traveller" }]) {
    const outcome = await atTable({ ...LEGAL_FIGHTER, ...stranger, features: [] });
    assert.equal(outcome.status, 400, JSON.stringify(stranger));
    assert.equal(outcome.sheet, null);
  }
  if (!world.hasPack) {
    return;
  }
  // Catfolk (Tome of Heroes, in the pack): +2 Dexterity, so the standard
  // array with the 14 in Dexterity reads 15, 16, 13, 12, 10, 8.
  const { status, error, sheet } = await atTable({
    ...LEGAL_FIGHTER,
    race: "catfolk",
    abilities: { str: 15, dex: 16, con: 13, int: 12, wis: 10, cha: 8 },
    proficiencies: { ...LEGAL_FIGHTER.proficiencies, languages: ["Common"] },
    features: [],
  });
  assert.equal(status, 201, error);
  assert.ok(sheet.features.some((feature) => feature.source === "race"), "the pack's traits are on the sheet");
  assert.ok(names(sheet).includes("Military Rank (Soldier)"));
});

// ---- proficiencies ----

await test("A class grants proficiency in exactly two saving throws: Strength and Constitution for a fighter.", async () => {
  const outcome = await atTable({ ...LEGAL_FIGHTER, ...fighterProfs({ saves: ["str", "dex", "con", "int", "wis", "cha"] }) });
  holds(outcome, (sheet) => [...sheet.proficiencies.saves].sort().join() === "con,str", "a fighter proficient in six saves");
});

await test("A fighter picks two skills from the fighter list and a background adds two: four in all for a human soldier.", async () => {
  const every = Object.keys(computeSheetDerived({ ...LEGAL_FIGHTER, level: 1 }).skills);
  assert.equal(every.length, 18);
  const outcome = await atTable({ ...LEGAL_FIGHTER, ...fighterProfs({ skills: every }) });
  holds(outcome, (sheet) => sheet.proficiencies.skills.length <= 4, "a level 1 fighter proficient in all eighteen skills");
});

await test("Class skills come from the class's list: a fighter cannot pick Arcana or Stealth.", async () => {
  // Soldier gives Athletics and Intimidation; the other two must be fighter skills.
  const outcome = await atTable({ ...LEGAL_FIGHTER, ...fighterProfs({ skills: ["arcana", "stealth", "athletics", "intimidation"] }) });
  holds(outcome, (sheet) => !sheet.proficiencies.skills.includes("arcana"), "a human soldier fighter proficient in Arcana and Stealth");
});

await test("Expertise is a rogue's at level 1 and a bard's at level 3; no other SRD class has it.", async () => {
  const outcome = await atTable({ ...LEGAL_FIGHTER, ...fighterProfs({ expertise: ["perception", "athletics", "survival", "intimidation"] }) });
  holds(outcome, (sheet) => sheet.proficiencies.expertise.length === 0, "a level 1 fighter with expertise");
});

await test("Expertise doubles a proficiency the character has; it cannot stand on a skill they are not proficient in.", async () => {
  const outcome = await atTable({ ...LEGAL_FIGHTER, ...fighterProfs({ expertise: ["stealth"] }) });
  holds(
    outcome,
    // DEX 15: +2, and nothing else without the proficiency.
    (sheet) => computeSheetDerived(sheet).skills.stealth === abilityMod(15),
    "double proficiency in a skill the sheet is not proficient in",
  );
});

await test("There are eighteen skills; a proficiency names one of them.", async () => {
  const outcome = await atTable({ ...LEGAL_FIGHTER, ...fighterProfs({ skills: ["lockpicking", "haggling", "athletics", "intimidation"] }) });
  holds(outcome, (sheet) => !sheet.proficiencies.skills.includes("lockpicking"), "a skill that does not exist");
});

await test("A wizard is trained in no armor and no shields.", async () => {
  const outcome = await atTable({ ...LEGAL_WIZARD, ...wizardProfs({ armor: ["light", "medium", "heavy", "shields"] }) });
  holds(outcome, (sheet) => sheet.proficiencies.armor.length === 0, "a wizard trained in heavy armor and shields");
});

await test("A wizard is trained in daggers, darts, slings, quarterstaffs and light crossbows, and nothing else.", async () => {
  const outcome = await atTable({ ...LEGAL_WIZARD, ...wizardProfs({ weapons: ["simple", "martial"] }) });
  holds(outcome, (sheet) => !sheet.proficiencies.weapons.includes("martial"), "a wizard trained in martial weapons");
});

await test("A human speaks Common and one more language; a soldier adds none.", async () => {
  const outcome = await atTable({
    ...LEGAL_FIGHTER,
    ...fighterProfs({ languages: ["Common", "Dwarvish", "Elvish", "Giant", "Draconic", "Infernal", "Abyssal", "Celestial", "Sylvan", "Undercommon", "Deep Speech", "Thieves' Cant"] }),
  });
  holds(outcome, (sheet) => sheet.proficiencies.languages.length <= 2, "a human soldier speaking twelve languages");
});

// ---- features, feats and levels ----

await test("A feat replaces an ability score improvement (level 4 at the earliest) or is the variant human's one feat.", async () => {
  // The engines read feats by name (Alert adds 5 to initiative), so a feat
  // with no improvement behind it must not reach a stored sheet. The server
  // refuses the character; were it stored corrected instead, its initiative
  // would be the bare Dexterity modifier.
  const outcome = await atTable({ ...LEGAL_FIGHTER, feats: ["Alert", "Observant", "Tough", "Lucky"] });
  holds(outcome, (sheet) => sheet.feats.length === 0, "a level 1 human with four feats");
  if (outcome.sheet) {
    assert.equal(computeSheetDerived(outcome.sheet).initiative, abilityMod(15));
  }
  const one = await atTable({ ...LEGAL_FIGHTER, feats: ["Alert"] });
  holds(one, (sheet) => sheet.feats.length === 0, "a level 1 human with one feat");
});

await test("A character has the features its class, race and background grant at its level, and no others.", async () => {
  const outcome = await atTable({
    ...LEGAL_WIZARD,
    features: [
      { name: "Extra Attack (3)", source: "story" },
      { name: "Sneak Attack", source: "feat" },
      { name: "Rage", source: "story" },
      { name: "Fighting Style: Archery", source: "story" },
    ],
  });
  holds(
    outcome,
    (sheet) => combatRiders(sheet).extraAttacks === 0 && combatRiders(sheet).sneakAttackDice === 0 && !sheet.resources.rage,
    "a level 1 wizard with four attacks, Sneak Attack and Rage",
  );
});

await test("Class levels add up to the character's level, and a character is created single-class.", async () => {
  const outcome = await atTable({
    ...LEGAL_FIGHTER,
    classes: [{ id: "fighter", subclass: "Champion", level: 20 }, { id: "wizard", subclass: "", level: 20 }],
  });
  holds(
    outcome,
    (sheet) => sheet.classes.reduce((sum, entry) => sum + entry.level, 0) <= sheet.level && !names(sheet).includes("Extra Attack (3)"),
    "forty class levels on a level 1 sheet",
  );
});

await test("A fighter chooses an archetype at level 3.", async () => {
  const outcome = await atTable({ ...LEGAL_FIGHTER, subclass: "Champion" });
  holds(outcome, (sheet) => sheet.subclass === "", "a level 1 Champion");
});

await test("Spell slots come from the class table: a level 1 wizard has two 1st-level slots.", async () => {
  const outcome = await atTable({
    ...LEGAL_WIZARD,
    spellcasting: { ...LEGAL_WIZARD.spellcasting, slots: { 1: { max: 10, used: 0 }, 9: { max: 10, used: 0 } } },
  });
  holds(outcome, (sheet) => JSON.stringify(sheet.spellcasting.slots) === JSON.stringify({ 1: { max: 2, used: 0 } }), "ten 9th-level slots at level 1");
});

await test("A high elf knows one wizard cantrip from its race, on top of the cantrips its class teaches.", async () => {
  const built = builder.build({
    race: "high_elf",
    class: "wizard",
    background: "sage",
    scores: { str: 8, dex: 14, con: 13, int: 15, wis: 12, cha: 10 },
    chosenSkills: ["investigation", "insight"],
    bonusLanguages: ["Dwarvish", "Giant", "Draconic"],
    racialCantrip: "Prestidigitation",
    cantrips: ["Fire Bolt", "Light", "Mage Hand"],
    spells: ["Magic Missile", "Shield", "Sleep", "Mage Armor", "Detect Magic", "Burning Hands"],
    bookPrepared: ["Magic Missile", "Shield", "Sleep", "Mage Armor"],
  });
  assert.equal(built.blocker, null, "the builder passes this character");
  const outcome = await atTable(built.sheet);
  assert.equal(outcome.status, 201, outcome.error);
  assert.ok(outcome.sheet.spellcasting.cantrips.includes("Prestidigitation"));
});

// ---- gear ----

await test("A character is attuned to at most three magic items.", async () => {
  const rings = ["Ring of Protection", "Cloak of Protection", "Ring of Resistance", "Bracers of Defense", "Amulet of Health"];
  const outcome = await atTable({
    ...LEGAL_FIGHTER,
    equipment: rings.map((name) => ({ name, qty: 1, equipped: true, attuned: true })),
  });
  holds(outcome, (sheet) => sheet.equipment.filter((item) => item.attuned).length <= 3, "five attuned items");
});

await test("Starting equipment is the class's and background's kit, or what up to 200 gp of starting wealth buys: plate armor costs 1,500 gp.", async () => {
  const outcome = await atTable({
    ...LEGAL_FIGHTER,
    equipment: [{ name: "Plate", qty: 1, equipped: true }, { name: "Shield +3", qty: 1, equipped: true }, { name: "Potion of Healing", qty: 999 }],
  });
  holds(outcome, (sheet) => !sheet.equipment.some((item) => item.name === "Plate" || item.qty > 100), "plate, a +3 shield and 999 potions at level 1");
});

world.close();
finish();
