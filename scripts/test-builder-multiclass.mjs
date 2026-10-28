// Backlog F9, phase 1: the builder makes a character with levels in more
// than one class. The classes taken after the first sit beside the first
// class's own fields (src/app/characters/builder/multiclassBuild.ts), every
// number the builder shows is read from the class list (useBuilderDerived),
// and the save sends the list the server keeps (submit.ts). Each build here
// is held against the server's own check (src/lib/srd/sheet-legality.ts
// legalizeSheet), so the builder never promises a hit point total, an
// improvement, a proficiency or a spell slot the server then changes.
//
// The rules are SRD 5.1's multiclassing, with the plan's accepted defaults:
// prerequisites read on the final scores, the first class's levels taken
// first, and (phase 1) one casting class.
import assert from "node:assert/strict";
import fs from "node:fs";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { openBuilder } = await import("./lib/enforce-builder.mjs");
const { legalizeSheet } = await import("../src/lib/srd/sheet-legality.ts");
const { bundledPrices } = await import("../src/lib/srd/starting-wealth.ts");
const { checklistSpell } = await import("../src/lib/srd/spell-lists.ts");
const { bundledSubclassName } = await import("../src/lib/srd/features.ts");
const { earnedAsiCountFor } = await import("../src/lib/srd/asi.ts");
const mc = await import("../src/app/characters/builder/multiclassBuild.ts");
const { reconcilePicks } = await import("../src/app/characters/builder/reconcile.ts");
const { levelProgressionRows } = await import("../src/app/characters/builder/levelProgression.ts");
const { builderProgressionInput } = await import("../src/app/characters/builder/LevelProgressionTable.tsx");
const { storedSpellLists } = await import("../src/app/characters/builder/useBuilderState.ts");
const { buildMathSections } = await import("../src/app/characters/builder/buildMath.ts");

// Windows CI checks out with CRLF.
const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

let passed = 0;
async function test(name, fn) {
  await fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

const builder = await openBuilder();
const { classes, races, backgrounds } = builder;
const classRow = (id) => classes.find((entry) => entry.id === id);

// The server's check for a character made in the library, from the same
// bundled rows the builder reads.
function server(sheet, level, overrides = {}) {
  const race = races.find((entry) => entry.id === sheet.race);
  return legalizeSheet(sheet, {
    door: "library",
    level,
    hpMethod: "average",
    startingWealth: "equipment",
    classOf: (id) => classRow(id) ?? null,
    race: race ? { ...race, feats: 0 } : null,
    background: backgrounds.find((entry) => entry.id === sheet.background) ?? null,
    baseline: null,
    abilityPool: null,
    wealthRoll: null,
    priceOf: bundledPrices,
    spellOf: checklistSpell,
    featOf: () => null,
    subclassOffered: (classId, name) => Boolean(bundledSubclassName(classId, name)),
    rollDie: () => 3,
    ...overrides,
  });
}

const sorted = (list) => [...list].map((entry) => entry.toLowerCase()).sort();

// A lightfoot halfling soldier, fighter 3 (Champion) and rogue 2: the
// rogue's levels bring light armor, thieves' tools, one rogue skill and two
// expertise picks, and no saving throw.
const FIGHTER_ROGUE = {
  race: "lightfoot_halfling",
  class: "fighter",
  background: "soldier",
  level: 5,
  // Strength 15, Dexterity 14 + 2: both classes' 13s met.
  scores: { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 },
  subclass: "Champion",
  chosenSkills: ["perception", "survival"],
  stylePicks: ["defense"],
  extraClasses: [{ classId: "rogue", subclass: "", level: 2, skills: ["stealth"] }],
  expertisePicks: ["perception", "stealth"],
};

// A rock gnome soldier, fighter 3 (Champion) and wizard 2 (Evocation): the
// wizard's spell list at the wizard's own 2nd level.
const FIGHTER_WIZARD = {
  race: "rock_gnome",
  class: "fighter",
  background: "soldier",
  level: 5,
  // Strength 15, Intelligence 14 + 2.
  scores: { str: 15, dex: 12, con: 13, int: 14, wis: 10, cha: 8 },
  subclass: "Champion",
  chosenSkills: ["perception", "survival"],
  stylePicks: ["defense"],
  extraClasses: [{ classId: "wizard", subclass: "School of Evocation", level: 2, skills: [] }],
  cantrips: ["Fire Bolt", "Light", "Mage Hand"],
  // A wizard's book at its 2nd level: six, and two more.
  spells: ["Magic Missile", "Shield", "Sleep", "Burning Hands", "Detect Magic", "Mage Armor", "Thunderwave", "Feather Fall"],
  // Intelligence +3 and wizard level 2.
  bookPrepared: ["Magic Missile", "Shield", "Sleep", "Mage Armor", "Detect Magic"],
};

await test("fighter 3 / rogue 2: the builder's numbers are the server's", () => {
  const built = builder.build(FIGHTER_ROGUE);
  assert.equal(built.blocker, null, built.blocker?.message);
  const { derived, sheet } = built;
  // The class list, the first class first, at the levels the others leave.
  assert.deepEqual(derived.classList.map((entry) => [entry.id, entry.level]), [["fighter", 3], ["rogue", 2]]);
  assert.equal(derived.primaryLevel, 3);
  assert.deepEqual(sheet.classes.map((entry) => [entry.id, entry.subclass, entry.level]), [["fighter", "Champion", 3], ["rogue", "", 2]]);
  assert.equal(sheet.class, "fighter");
  assert.equal(sheet.hitDice.total, 5);
  // Neither class has reached its 4th level: no improvement (a single
  // fighter 5 would have one).
  assert.equal(derived.asiSlotLevels.length, 0);
  assert.equal(derived.asiSlotLevels.length, earnedAsiCountFor(derived.classList));
  const out = server(sheet, 5);
  assert.deepEqual(out.problems, []);
  // Hit points: 1st level the d10's 10, two fighter levels at 6 and two
  // rogue levels at 5, each with Constitution +1.
  assert.equal(derived.hp.maxHp, 10 + 1 + 2 * 7 + 2 * 6);
  assert.equal(out.sheet.maxHp, derived.hp.maxHp);
  assert.equal(derived.hp.parts.total, derived.hp.maxHp);
  // Training: the fighter's saves only; the rogue's thieves' tools; armor
  // and weapons the fighter's with the rogue's light armor already in.
  assert.deepEqual(sorted(derived.training.saves), sorted(out.sheet.proficiencies.saves));
  assert.deepEqual(sorted(out.sheet.proficiencies.saves), ["con", "str"]);
  assert.deepEqual(sorted(derived.training.armor), sorted(out.sheet.proficiencies.armor));
  assert.deepEqual(sorted(derived.training.weapons), sorted(out.sheet.proficiencies.weapons));
  assert.ok(out.sheet.proficiencies.tools.includes("thieves' tools"));
  assert.ok(derived.training.tools.includes("thieves' tools"));
  // The rogue's skill pick and its two expertise picks survive the check.
  assert.deepEqual(sorted(sheet.proficiencies.skills), sorted(out.sheet.proficiencies.skills));
  assert.ok(out.sheet.proficiencies.skills.includes("stealth"));
  assert.deepEqual(sorted(out.sheet.proficiencies.expertise), ["perception", "stealth"]);
  assert.equal(derived.expertiseSlots, 2);
  // Thieves' Cant, the rogue's own tongue.
  assert.ok(sheet.proficiencies.languages.includes("Thieves' Cant") || out.sheet.proficiencies.languages.includes("Thieves' Cant"));
  // The hit dice the server builds: one pool per class.
  assert.deepEqual(out.sheet.hitDicePools.map((pool) => [pool.classId, pool.die, pool.total]), [["fighter", "d10", 3], ["rogue", "d8", 2]]);
  // No casting class, no spells.
  assert.equal(derived.casts, false);
  assert.equal(sheet.spellcasting, null);
});

await test("fighter 3 / wizard 2: the wizard's own counts drive the one spell list", () => {
  const built = builder.build(FIGHTER_WIZARD);
  assert.equal(built.blocker, null, built.blocker?.message);
  const { derived, sheet } = built;
  // The wizard casts, at its own 2nd level: three cantrips, eight in the
  // book, Intelligence +3 and 2 prepared.
  assert.equal(derived.casts, true);
  assert.equal(derived.casterKlass.id, "wizard");
  assert.equal(derived.casterLevel, 2);
  assert.equal(derived.cantripAdvice, 3);
  assert.equal(derived.spellbookAdvice, 8);
  assert.equal(derived.spellAdvice.count, 5);
  assert.equal(derived.spellStyle, "spellbook");
  // One casting class keeps its own table: a wizard 2 has three 1st-level slots.
  assert.deepEqual(derived.spellSlots, { 1: { max: 3, used: 0 } });
  const out = server(sheet, 5);
  assert.deepEqual(out.problems, []);
  assert.deepEqual(
    Object.fromEntries(Object.entries(out.sheet.spellcasting.slots).map(([level, slot]) => [level, slot.max])),
    { 1: 3 },
  );
  assert.equal(out.sheet.spellcasting.ability, "int");
  // The lists are the wizard's own entry, the shape the server judges.
  const wizard = out.sheet.spellcasting.casters.find((caster) => caster.classId === "wizard");
  assert.ok(wizard);
  assert.deepEqual(sorted(wizard.cantrips), sorted(FIGHTER_WIZARD.cantrips));
  assert.deepEqual(sorted(wizard.prepared), sorted(FIGHTER_WIZARD.bookPrepared));
  assert.deepEqual(sorted(wizard.spellbook), sorted(FIGHTER_WIZARD.spells));
  // Hit points: the d10's 10, two fighter levels at 6, two wizard levels at
  // 4, Constitution +1 (13 + 1).
  assert.equal(derived.hp.maxHp, 10 + 2 + 2 * 8 + 2 * 6);
  assert.equal(out.sheet.maxHp, derived.hp.maxHp);
  assert.deepEqual(sorted(derived.training.armor), sorted(out.sheet.proficiencies.armor));
  assert.deepEqual(sorted(derived.training.weapons), sorted(out.sheet.proficiencies.weapons));
  assert.deepEqual(sorted(derived.training.saves), sorted(out.sheet.proficiencies.saves));
  assert.equal(derived.asiSlotLevels.length, earnedAsiCountFor(out.sheet.classes));
  assert.deepEqual(out.sheet.classes.map((entry) => [entry.id, entry.subclass, entry.level]), [
    ["fighter", "Champion", 3],
    ["wizard", "School of Evocation", 2],
  ]);
});

await test("improvements come from each class's own levels, the first class's first", () => {
  // Fighter 6 / rogue 4: the fighter's 4th and 6th, the rogue's 4th (at
  // character level 10).
  assert.deepEqual(
    mc.builderAsiSlotLevels([{ id: "fighter", level: 6 }, { id: "rogue", level: 4 }]),
    [4, 6, 10],
  );
  // Wizard 3 / fighter 3: none; a single wizard 6 has one.
  assert.deepEqual(mc.builderAsiSlotLevels([{ id: "wizard", level: 3 }, { id: "fighter", level: 3 }]), []);
  const built = builder.build({
    ...FIGHTER_ROGUE,
    level: 8,
    extraClasses: [{ classId: "rogue", subclass: "Thief", level: 4, skills: ["stealth"] }],
    asiChoices: [{ mode: "plus2", ability: "dex" }, { mode: "plus2", ability: "con" }],
  });
  assert.equal(built.blocker, null, built.blocker?.message);
  assert.deepEqual(built.derived.asiSlotLevels, [4, 8]);
  assert.equal(built.sheet.asiChoices.length, 2);
  const out = server(built.sheet, 8);
  assert.deepEqual(out.problems, []);
  assert.equal(out.sheet.asiChoices.length, earnedAsiCountFor(out.sheet.classes));
  assert.equal(out.sheet.maxHp, built.derived.hp.maxHp);
});

await test("the classes that may be added come first, each refusal in words", () => {
  const rowOf = (id) => classRow(id);
  const fighterList = [{ id: "fighter", subclass: "", level: 3 }];
  const low = { str: 15, dex: 12, con: 13, int: 8, wis: 10, cha: 8 };
  const choices = mc.multiclassChoices({ rows: classes, classList: fighterList, abilities: low, rowOf });
  const firstRefused = choices.findIndex((choice) => !choice.ok);
  assert.ok(firstRefused > 0);
  assert.ok(choices.slice(firstRefused).every((choice) => !choice.ok), "eligible first");
  const wizard = choices.find((choice) => choice.row.id === "wizard");
  assert.equal(wizard.ok, false);
  assert.match(wizard.reason, /Needs Intelligence 13/);
  assert.equal(wizard.needs, "Intelligence 13");
  const barbarian = choices.find((choice) => choice.row.id === "barbarian");
  assert.equal(barbarian.ok, true);
  assert.match(barbarian.grants, /shields/);
  // The class started in must meet its own 13 too.
  const weakWizard = mc.multiclassChoices({
    rows: classes,
    classList: [{ id: "wizard", subclass: "", level: 3 }],
    abilities: { ...low, int: 10 },
    rowOf,
  });
  assert.ok(weakWizard.every((choice) => !choice.ok));
  assert.match(weakWizard.find((choice) => choice.row.id === "fighter").reason, /your Wizard needs Intelligence 13 too/);
  // Phase 2: a second casting class beside one that casts is offered.
  const cleric = mc.multiclassChoices({
    rows: classes,
    classList: [{ id: "cleric", subclass: "", level: 3 }],
    abilities: { str: 13, dex: 13, con: 13, int: 13, wis: 13, cha: 13 },
    rowOf,
  });
  assert.equal(cleric.find((choice) => choice.row.id === "wizard").ok, true);
  assert.equal(cleric.find((choice) => choice.row.id === "warlock").ok, true);
  assert.equal(cleric.find((choice) => choice.row.id === "fighter").ok, true);
  // Before the scores are set every class is offered with what it needs.
  const unset = mc.multiclassChoices({ rows: classes, classList: fighterList, abilities: null, rowOf });
  assert.equal(unset.find((choice) => choice.row.id === "wizard").ok, true);
  // At the cap of three, nothing more.
  const full = mc.multiclassChoices({
    rows: classes,
    classList: [...fighterList, { id: "rogue", subclass: "", level: 1 }, { id: "barbarian", subclass: "", level: 1 }],
    abilities: null,
    rowOf,
  });
  assert.ok(full.every((choice) => !choice.ok && /at most 3/.test(choice.reason)));
});

await test("a lower level takes levels from the last class first and keeps the list valid", () => {
  const two = [
    { classId: "rogue", subclass: "", level: 2, skills: [] },
    { classId: "wizard", subclass: "School of Evocation", level: 3, skills: [] },
  ];
  const fit = (extras, total, primaryId = "fighter") =>
    mc.fitExtraClasses(extras, { primaryId, total }).map((entry) => [entry.classId, entry.level, entry.subclass]);
  assert.deepEqual(fit(two, 8), [["rogue", 2, ""], ["wizard", 3, "School of Evocation"]]);
  // Level 5: the fighter keeps one, the wizard drops to 2 and keeps its school.
  assert.deepEqual(fit(two, 5), [["rogue", 2, ""], ["wizard", 2, "School of Evocation"]]);
  // Level 4: the wizard drops to 1, below its subclass level: the school goes.
  assert.deepEqual(fit(two, 4), [["rogue", 2, ""], ["wizard", 1, ""]]);
  // Level 3: the wizard has no level left and goes.
  assert.deepEqual(fit(two, 3), [["rogue", 2, ""]]);
  assert.deepEqual(fit(two, 2), [["rogue", 1, ""]]);
  assert.deepEqual(fit(two, 1), []);
  // The first class is never taken twice, nor any class, and three is the most.
  assert.deepEqual(fit([{ classId: "fighter", level: 1 }, { classId: "rogue", level: 1 }, { classId: "rogue", level: 1 }], 6), [["rogue", 1, ""]]);
  assert.deepEqual(
    fit([{ classId: "rogue", level: 1 }, { classId: "wizard", level: 1 }, { classId: "cleric", level: 1 }], 9).map(([id]) => id),
    ["rogue", "wizard"],
  );
  // A lower level sheds the last class's levels first, as joining a lower
  // table does (adapt.ts): fighter 3 / rogue 2 / wizard 3 at 7, then at 5.
  const shed = (extras, levels) => mc.shedExtraLevels(extras, levels).map((entry) => [entry.classId, entry.level]);
  assert.deepEqual(shed(two, 1), [["rogue", 2], ["wizard", 2]]);
  assert.deepEqual(shed(two, 3), [["rogue", 2]]);
  assert.deepEqual(shed(two, 4), [["rogue", 1]]);
  // A stored split opened at a lower table sheds the same way.
  const stored = { classes: [{ id: "fighter", subclass: "Champion", level: 3 }, { id: "wizard", subclass: "", level: 2 }] };
  assert.deepEqual(mc.storedExtraClasses(stored, 5).map((entry) => [entry.classId, entry.level]), [["wizard", 2]]);
  assert.deepEqual(mc.storedExtraClasses(stored, 4).map((entry) => [entry.classId, entry.level]), [["wizard", 1]]);
  assert.deepEqual(mc.storedExtraClasses(stored, 3), []);
  // A higher level goes to the first class.
  assert.deepEqual(mc.storedExtraClasses(stored, 7).map((entry) => [entry.classId, entry.level]), [["wizard", 2]]);
  // The builder's own state holds the same: a lower level sheds before the
  // list is fitted and the picks are checked (useBuilderState).
  const state = read("src/app/characters/builder/useBuilderState.ts");
  assert.match(state, /const fitted = fitExtraClasses\(ids\.extraClasses, \{ primaryId: ids\.classId, total \}\);/);
  assert.match(state, /next < level \? \{ extraClasses: shedExtraLevels\(extraClasses, level - next\) \}/);
  // The first class's subclass is read at the first class's own level.
  const { picks } = reconcilePicks(
    { subclass: "Champion" },
    { klass: classRow("fighter"), level: 4, extras: [{ klass: classRow("rogue"), subclass: "", level: 2 }] },
  );
  assert.equal(picks.subclass, "", "fighter 2 has no subclass yet");
  const kept = reconcilePicks(
    { subclass: "Champion" },
    { klass: classRow("fighter"), level: 5, extras: [{ klass: classRow("rogue"), subclass: "", level: 2 }] },
  );
  assert.equal(kept.picks.subclass, "Champion");
});

await test("the second class's skill and its expertise are checked like the first's", () => {
  const extras = [{ klass: classRow("rogue"), subclass: "", level: 2, skills: ["stealth", "athletics"] }];
  const out = reconcilePicks(
    { chosenSkills: ["perception", "survival"], expertisePicks: ["stealth", "perception", "insight"] },
    { klass: classRow("fighter"), background: backgrounds.find((entry) => entry.id === "soldier"), level: 5, extras },
  );
  // One rogue skill, and not one the soldier already gives (athletics).
  assert.deepEqual(out.extraSkills, [["stealth"]]);
  // Two expertise picks, both in skills held.
  assert.deepEqual(out.picks.expertisePicks, ["stealth", "perception"]);
  // A stored split gives each class its skills back.
  const split = mc.splitStoredSkills(["perception", "survival", "stealth"], classRow("fighter"), [{ classId: "rogue" }]);
  assert.deepEqual(split, { chosen: ["perception", "survival"], extraSkills: [["stealth"]] });
});

await test("the level table says which class each level went to", () => {
  const built = builder.build(FIGHTER_WIZARD);
  const rows = levelProgressionRows(builderProgressionInput(built.state, built.derived, classRow("fighter")));
  assert.deepEqual(rows.map((row) => row.classLabel), ["Fighter 1", "Fighter 2", "Fighter 3", "Wizard 1", "Wizard 2"]);
  // The fighter's subclass at its 3rd, the wizard's at its 2nd.
  assert.deepEqual(rows.map((row) => row.subclass?.pick ?? null), [null, null, "Champion", null, "School of Evocation"]);
  // The wizard's slots and counts once its levels begin.
  assert.deepEqual(rows[2].slots, []);
  assert.deepEqual(rows[3].slots, [{ level: 1, count: 2 }]);
  assert.deepEqual(rows[4].slots, [{ level: 1, count: 3 }]);
  assert.equal(rows[4].spells.spellbook, 8);
  assert.equal(rows[4].cantrips, 3);
  // Proficiency follows the character's level.
  assert.equal(rows[4].proficiency, 3);
});

await test("a table that turns multiclassing off holds a new character to one class", () => {
  const built = builder.build({ ...FIGHTER_ROGUE });
  const blocks = builder.submit.callingBlocks(classRow("fighter"), built.state, { ...built.derived, multiclassAllowed: false });
  assert.ok(blocks.some((entry) => entry.target === "multiclass" && /turns multiclassing off/.test(entry.message)));
  // A stored split the seat already holds is kept there, so its rebuild owes
  // nothing for it; a class it did not hold is still held back.
  const off = { ...built.derived, multiclassAllowed: false };
  const kept = builder.submit.callingBlocks(classRow("fighter"), { ...built.state, storedClassIds: ["fighter", "rogue"] }, off);
  assert.ok(!kept.some((entry) => /turns multiclassing off/.test(entry.message)), "a kept split was blocked");
  const other = builder.submit.callingBlocks(classRow("fighter"), { ...built.state, storedClassIds: ["fighter", "wizard"] }, off);
  assert.ok(other.some((entry) => /turns multiclassing off/.test(entry.message)), "a class the seat did not hold was let through");
  // The table rule reaches the builder from the table's settings.
  const rules = read("src/app/characters/builder/useTableRules.ts");
  assert.match(rules, /multiclassingEnabled: stored\?\.multiclassingEnabled !== false/);
  assert.match(rules, /multiclassAllowed: !campaignId \|\| \(settings\?\.multiclassingEnabled \?\? true\)/);
  // And the server refuses the same split at that table.
  const out = server(built.sheet, 5, { door: "table", multiclassAllowed: false });
  assert.ok(out.problems.some((problem) => /turns multiclassing off/.test(problem)));
});

await test("a single class builds exactly as before", () => {
  const built = builder.build({ ...FIGHTER_ROGUE, extraClasses: [], expertisePicks: [], asiChoices: [{ mode: "plus2", ability: "str" }] });
  assert.equal(built.blocker, null, built.blocker?.message);
  assert.deepEqual(built.sheet.classes, []);
  assert.equal(built.sheet.hitDicePools, null);
  assert.equal(built.derived.multiclass, false);
  assert.deepEqual(built.derived.asiSlotLevels, [4]);
  const out = server(built.sheet, 5, { door: "table" });
  assert.equal(out.sheet.maxHp, built.derived.hp.maxHp);
});

await test("a second class owes its subclass and its skill on the class step", () => {
  const built = builder.build({
    ...FIGHTER_WIZARD,
    extraClasses: [{ classId: "wizard", subclass: "", level: 2, skills: [] }],
  });
  assert.equal(built.blocker?.target, "multiclass");
  assert.match(built.blocker.message, /wizard's path \(subclass\)/);
  const rogue = builder.build({ ...FIGHTER_ROGUE, extraClasses: [{ classId: "rogue", subclass: "", level: 2, skills: [] }], expertisePicks: [] });
  assert.equal(rogue.blocker?.target, "multiclass");
  assert.match(rogue.blocker.message, /rogue levels taught you/);
  // A score that misses a class's 13 is asked for on the Abilities step.
  const weak = builder.build({ ...FIGHTER_WIZARD, scores: { str: 15, dex: 12, con: 13, int: 8, wis: 10, cha: 14 } });
  const owed = builder.submit.abilitiesBlocks(weak.derived, weak.state);
  assert.ok(owed.some((entry) => /Wizard beside another class needs Intelligence 13/.test(entry.message)));
});

// ---- phase 2: more than one casting class ----

const { optionFeatureName } = await import("../src/lib/srd/options.ts");

// A rock gnome soldier, cleric 3 (Life Domain) and wizard 2 (Evocation):
// the cleric leads the builder's own spell fields, the wizard's lists are
// its own. Wisdom 15, Intelligence 14 + 2.
const CLERIC_WIZARD = {
  race: "rock_gnome",
  class: "cleric",
  background: "soldier",
  level: 5,
  scores: { str: 8, dex: 12, con: 13, int: 14, wis: 15, cha: 10 },
  subclass: "Life Domain",
  chosenSkills: ["history", "medicine"],
  // Cleric 3: three cantrips, Wisdom +2 and level 3 prepared.
  cantrips: ["Guidance", "Sacred Flame", "Spare the Dying"],
  spells: ["Guiding Bolt", "Shield of Faith", "Healing Word", "Sanctuary", "Command"],
  extraClasses: [{ classId: "wizard", subclass: "School of Evocation", level: 2, skills: [] }],
  casterSpells: {
    wizard: {
      cantrips: ["Fire Bolt", "Mage Hand", "Ray of Frost"],
      spells: ["Magic Missile", "Shield", "Sleep", "Burning Hands", "Detect Magic", "Mage Armor", "Thunderwave", "Feather Fall"],
      bookPrepared: ["Magic Missile", "Shield", "Sleep", "Mage Armor", "Detect Magic"],
    },
  },
};

// A tiefling soldier, warlock 2 (the Fiend) and sorcerer 3 (Wild Magic):
// pact slots apart from the sorcerer's own table. Charisma 15 + 2.
const WARLOCK_SORCERER = {
  race: "tiefling",
  class: "warlock",
  background: "soldier",
  level: 5,
  scores: { str: 8, dex: 13, con: 14, int: 10, wis: 12, cha: 15 },
  subclass: "The Fiend",
  chosenSkills: ["arcana", "deception"],
  cantrips: ["Eldritch Blast", "Minor Illusion"],
  spells: ["Hex", "Charm Person", "Witch Bolt"],
  optionPicks: [
    optionFeatureName("invocation", "Armor of Shadows"),
    optionFeatureName("invocation", "Eldritch Sight"),
    optionFeatureName("metamagic", "Careful Spell"),
    optionFeatureName("metamagic", "Quickened Spell"),
  ],
  extraClasses: [{ classId: "sorcerer", subclass: "Wild Magic", level: 3, skills: [] }],
  casterSpells: {
    sorcerer: {
      cantrips: ["Fire Bolt", "Light", "Mage Hand", "Prestidigitation"],
      spells: ["Magic Missile", "Shield", "Sleep", "Misty Step"],
      bookPrepared: [],
    },
  },
};

const casterOf = (sheet, id) => sheet.spellcasting.casters.find((caster) => caster.classId === id);
const slotMaxes = (slots) => Object.fromEntries(Object.entries(slots).filter(([, slot]) => slot.max > 0).map(([level, slot]) => [level, slot.max]));

await test("cleric 3 / wizard 2: each casting class's lists and counts, and the shared slots, are the server's", () => {
  const built = builder.build(CLERIC_WIZARD);
  assert.equal(built.blocker, null, built.blocker?.message);
  const { derived, sheet } = built;
  const desks = derived.casterDesks.filter((desk) => desk.casts);
  assert.deepEqual(desks.map((desk) => [desk.classId, desk.casterLevel, desk.lead]), [["cleric", 3, true], ["wizard", 2, false]]);
  const [clericDesk, wizardDesk] = desks;
  assert.equal(clericDesk.cantripAdvice, 3);
  assert.equal(clericDesk.spellAdvice.count, 5);
  assert.equal(wizardDesk.cantripAdvice, 3);
  assert.equal(wizardDesk.spellbookAdvice, 8);
  assert.equal(wizardDesk.spellAdvice.count, 5);
  // Each its own ability, DC and attack: Wisdom +2 and Intelligence +3.
  assert.equal(clericDesk.ability, "wis");
  assert.equal(wizardDesk.ability, "int");
  assert.equal(wizardDesk.spellSaveDc, 8 + 3 + 3);
  // Two Spellcasting classes share the multiclass table at caster level 5.
  assert.deepEqual(slotMaxes(derived.spellSlots), { 1: 4, 2: 3, 3: 2 });
  const out = server(sheet, 5);
  assert.deepEqual(out.problems, []);
  assert.deepEqual(slotMaxes(out.sheet.spellcasting.slots), slotMaxes(derived.spellSlots));
  assert.deepEqual(out.sheet.spellcasting.casters.map((caster) => [caster.classId, caster.ability]), [["cleric", "wis"], ["wizard", "int"]]);
  const cleric = casterOf(out.sheet, "cleric");
  // The domain's spells ride on top, free.
  for (const name of CLERIC_WIZARD.spells) assert.ok(cleric.prepared.includes(name), `the cleric prepares ${name}`);
  assert.ok(cleric.prepared.includes("Bless"), "Life Domain's bless is prepared");
  assert.deepEqual(sorted(cleric.cantrips), sorted(CLERIC_WIZARD.cantrips));
  const wizard = casterOf(out.sheet, "wizard");
  assert.deepEqual(sorted(wizard.cantrips), sorted(CLERIC_WIZARD.casterSpells.wizard.cantrips));
  assert.deepEqual(sorted(wizard.spellbook), sorted(CLERIC_WIZARD.casterSpells.wizard.spells));
  assert.deepEqual(sorted(wizard.prepared), sorted(CLERIC_WIZARD.casterSpells.wizard.bookPrepared));
  // What the builder sent is what the server kept, class by class.
  for (const id of ["cleric", "wizard"]) {
    const sent = casterOf(sheet, id);
    const kept = casterOf(out.sheet, id);
    assert.deepEqual(sorted(sent.prepared), sorted(kept.prepared), `${id} prepared`);
    assert.deepEqual(sorted(sent.cantrips), sorted(kept.cantrips), `${id} cantrips`);
  }
});

await test("warlock 2 / sorcerer 3: pact slots apart, the sorcerer's own table, each list judged", () => {
  const built = builder.build(WARLOCK_SORCERER);
  assert.equal(built.blocker, null, built.blocker?.message);
  const { derived, sheet } = built;
  const desks = derived.casterDesks.filter((desk) => desk.casts);
  assert.deepEqual(desks.map((desk) => desk.classId), ["warlock", "sorcerer"]);
  assert.equal(desks[0].spellAdvice.count, 3);
  assert.equal(desks[1].cantripAdvice, 4);
  assert.equal(desks[1].spellAdvice.count, 4);
  // One slot caster keeps its own table; Pact Magic sits apart.
  assert.deepEqual(slotMaxes(derived.spellSlots), { 1: 4, 2: 2 });
  assert.deepEqual(derived.pactSlots, { level: 1, max: 2, used: 0 });
  const out = server(sheet, 5);
  assert.deepEqual(out.problems, []);
  assert.deepEqual(slotMaxes(out.sheet.spellcasting.slots), slotMaxes(derived.spellSlots));
  assert.deepEqual(
    { level: out.sheet.spellcasting.pact.level, max: out.sheet.spellcasting.pact.max },
    { level: derived.pactSlots.level, max: derived.pactSlots.max },
  );
  assert.deepEqual(sorted(casterOf(out.sheet, "warlock").known.filter((name) => WARLOCK_SORCERER.spells.includes(name))), sorted(WARLOCK_SORCERER.spells));
  assert.deepEqual(sorted(casterOf(out.sheet, "sorcerer").known), sorted(WARLOCK_SORCERER.casterSpells.sorcerer.spells));
  assert.deepEqual(sorted(casterOf(out.sheet, "sorcerer").cantrips), sorted(WARLOCK_SORCERER.casterSpells.sorcerer.cantrips));
  // The tiefling's thaumaturgy rides with the first casting class, free.
  assert.ok(casterOf(out.sheet, "warlock").cantrips.includes("Thaumaturgy"));
});

await test("a wrong count in one casting class is held on the spell step, by its name", () => {
  const short = builder.build({
    ...CLERIC_WIZARD,
    casterSpells: { wizard: { ...CLERIC_WIZARD.casterSpells.wizard, spells: CLERIC_WIZARD.casterSpells.wizard.spells.slice(0, 7) } },
  });
  assert.equal(short.blocker?.target, "spells");
  assert.match(short.blocker.message, /^Wizard: Write 1 more spell in your spellbook\./);
  const over = builder.build({
    ...WARLOCK_SORCERER,
    casterSpells: { sorcerer: { ...WARLOCK_SORCERER.casterSpells.sorcerer, spells: [...WARLOCK_SORCERER.casterSpells.sorcerer.spells, "Burning Hands"] } },
  });
  assert.match(over.blocker?.message ?? "", /^Sorcerer: Remove 1 spell: the limit is 4/);
  // The lead's own count reads as it always has, with its class named once
  // there are two.
  const lead = builder.build({ ...CLERIC_WIZARD, spells: CLERIC_WIZARD.spells.slice(0, 4) });
  assert.match(lead.blocker?.message ?? "", /^Cleric: Pick 1 more spell/);
  // And the server refuses a list too long for its class.
  const tooMany = server(over.sheet, 5);
  assert.ok(tooMany.problems.length > 0, "the server refuses a fifth sorcerer spell");
});

await test("the lists follow their class when the class that leads changes", () => {
  const lead = { spells: ["Bless"], bookPrepared: [], cantrips: ["Guidance"] };
  const wizard = { spells: ["Shield"], bookPrepared: ["Shield"], cantrips: ["Fire Bolt"] };
  // The cleric is taken off: the wizard leads, with its own lists.
  assert.deepEqual(mc.rekeySpellLists(lead, { wizard }, "cleric", { lead: "wizard", others: [] }), { lead: wizard, others: {} });
  // A sorcerer joins behind: it starts empty, the lead's lists stand.
  assert.deepEqual(mc.rekeySpellLists(lead, { wizard }, "cleric", { lead: "cleric", others: ["wizard", "sorcerer"] }), {
    lead,
    others: { wizard, sorcerer: mc.NO_SPELL_LISTS },
  });
  // A paladin of 1st level casts nothing yet: the wizard beside it leads.
  const rows = (id) => classRow(id);
  assert.deepEqual(
    mc.castersOf([{ row: rows("paladin"), subclass: "", level: 1 }, { row: rows("wizard"), subclass: "", level: 2 }]),
    { lead: "wizard", others: ["paladin"] },
  );
  // A stored split with two casting classes opens with each one's lists.
  const stored = {
    class: "cleric",
    classes: [{ id: "cleric", subclass: "", level: 3 }, { id: "wizard", subclass: "", level: 2 }],
    spellcasting: {
      ability: "wis", slots: {}, known: [], prepared: ["Bless", "Shield"], cantrips: ["Guidance", "Fire Bolt"],
      casters: [
        { classId: "cleric", ability: "wis", known: [], prepared: ["Bless"], cantrips: ["Guidance"] },
        { classId: "wizard", ability: "int", known: [], prepared: ["Shield"], cantrips: ["Fire Bolt"], spellbook: ["Shield"] },
      ],
    },
  };
  assert.deepEqual(storedSpellLists(stored), {
    lead: { spells: ["Bless"], bookPrepared: ["Bless"], cantrips: ["Guidance"] },
    others: { wizard: { spells: ["Shield"], bookPrepared: ["Shield"], cantrips: ["Fire Bolt"] } },
    leadId: "cleric",
  });
  // A single caster loads as it always has.
  const single = { class: "wizard", classes: [], spellcasting: { ability: "int", slots: {}, known: [], prepared: ["Shield"], cantrips: ["Light"], spellbook: ["Shield", "Sleep"] } };
  assert.deepEqual(storedSpellLists(single), {
    lead: { spells: ["Shield", "Sleep"], bookPrepared: ["Shield"], cantrips: ["Light"] },
    others: {},
    leadId: "wizard",
  });
});

await test("the level table and the math table read each casting class", () => {
  const built = builder.build(CLERIC_WIZARD);
  const rows = levelProgressionRows(builderProgressionInput(built.state, built.derived, classRow("cleric")));
  assert.equal(rows[4].casters.length, 2);
  assert.deepEqual(rows[4].casters.map((caster) => [caster.name, caster.cantrips]), [["Cleric", 3], ["Wizard", 3]]);
  assert.equal(rows[4].casters[1].spells.spellbook, 8);
  assert.deepEqual(rows[4].slots, [{ level: 1, count: 4 }, { level: 2, count: 3 }, { level: 3, count: 2 }]);
  const sections = buildMathSections({ derived: built.derived, scores: built.state.scores, klass: classRow("cleric"), atTable: false });
  const spellRows = sections.find((section) => section.id === "spells").rows;
  assert.ok(spellRows.some((row) => row.id === "spell-dc-wizard" && row.value === "14"));
  assert.ok(spellRows.some((row) => row.id === "spell-dc-cleric"));
  assert.ok(spellRows.some((row) => row.id === "slots-3" && /multiclass table at caster level 5/.test(row.working)));
});

await test("one set of words names a split wherever a class and level are shown", async () => {
  const { classLevelWords, classWordsAfterLevel } = await import("../src/lib/characters/class-words.ts");
  const split = { class: "fighter", level: 5, classes: [{ id: "fighter", level: 3 }, { id: "rogue", level: 2 }] };
  assert.equal(classLevelWords(split), "fighter 3 / rogue 2");
  assert.equal(classLevelWords({ class: "fighter", level: 5, classes: [] }), "fighter 5");
  const title = (id) => id[0].toUpperCase() + id.slice(1);
  assert.equal(classWordsAfterLevel(split, title), "Fighter 3 / Rogue 2");
  assert.equal(classWordsAfterLevel({ class: "wizard", level: 4 }, title), "Wizard");
  assert.equal(mc.classSplitWords(split.classes, title), "Fighter 3 / Rogue 2");
  // Every card and row that names a seated or library hero's class reads it.
  for (const file of [
    "src/app/campaigns/[campaignId]/LobbyParty.tsx",
    "src/app/campaigns/[campaignId]/CinematicParts.tsx",
    "src/app/campaigns/[campaignId]/HeroChooser.tsx",
    "src/app/campaigns/[campaignId]/CharacterSheetDialog.tsx",
    "src/app/characters/page.tsx",
    "src/app/characters/[characterId]/page.tsx",
    "src/app/characters/[characterId]/ready/page.tsx",
  ]) {
    assert.match(read(file), /@\/lib\/characters\/class-words/, `${file} names a split with the shared words`);
  }
  assert.match(read("src/app/campaigns/[campaignId]/LobbyParty.tsx"), /title=\{classLevelWords\(sheet\)\}/, "the medallion's title names the split");
});

// ---- lists trimmed to their counts when levels move ----

const { createElement, useState } = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");
const { useBuilderState } = await import("../src/app/characters/builder/useBuilderState.ts");

// The real hook driven through the server renderer, as
// test-builder-undo.mjs does: each pass takes one step; a `null` step lets
// the render after a change settle.
function runBuilder(steps) {
  let pass = 0;
  let result = null;
  function Probe() {
    const state = useBuilderState({ races, classes, backgrounds });
    const [, bump] = useState(0);
    const at = pass;
    pass += 1;
    if (at < steps.length) {
      steps[at]?.(state);
      bump((count) => count + 1);
    } else {
      result = state;
    }
    return null;
  }
  renderToStaticMarkup(createElement(Probe));
  assert.ok(result, "the builder never settled");
  return result;
}

const WIZARD_BOOK = CLERIC_WIZARD.casterSpells.wizard;
// A rock gnome cleric 3 (Life Domain) / wizard 2 (Evocation), every list
// full: the cleric's three cantrips and five prepared, the wizard's three
// cantrips, eight in the book and five prepared.
const clericWizard = [
  (s) => {
    s.changeRace("rock_gnome");
    s.changeClass("cleric");
    s.changeLevel(5);
    s.setScores(CLERIC_WIZARD.scores);
  },
  (s) => s.changeSubclass("Life Domain"),
  (s) => s.addExtraClass("wizard"),
  null,
  (s) => s.changeExtraLevel(0, 2),
  null,
  (s) => s.changeExtraSubclass(0, "School of Evocation"),
  null,
  (s) => {
    s.setCantrips(CLERIC_WIZARD.cantrips);
    s.setSpells(CLERIC_WIZARD.spells);
    s.setCasterList("wizard", "cantrips", WIZARD_BOOK.cantrips);
    s.setCasterList("wizard", "spells", WIZARD_BOOK.spells);
    s.setCasterList("wizard", "bookPrepared", WIZARD_BOOK.bookPrepared);
  },
  null,
];
const splitOf = (s) => [s.classId, ...s.extraClasses.map((entry) => `${entry.classId} ${entry.level}`)];

await test("a level moved from the wizard to the cleric trims the wizard's book and prepared list, and Put it back returns both", () => {
  const before = runBuilder(clericWizard);
  assert.deepEqual(splitOf(before), ["cleric", "wizard 2"]);
  assert.deepEqual(before.casterSpells.wizard.spells, WIZARD_BOOK.spells);
  const moved = runBuilder([...clericWizard, (s) => s.changeExtraLevel(0, 1), null]);
  assert.deepEqual(splitOf(moved), ["cleric", "wizard 1"]);
  // A wizard 1's book holds six: the last two written go. Intelligence +3
  // and wizard level 1 prepare four: the last prepared goes.
  assert.deepEqual(moved.casterSpells.wizard.spells, WIZARD_BOOK.spells.slice(0, 6));
  assert.deepEqual(moved.casterSpells.wizard.bookPrepared, WIZARD_BOOK.bookPrepared.slice(0, 4));
  assert.deepEqual(moved.casterSpells.wizard.cantrips, WIZARD_BOOK.cantrips, "a wizard 1 still knows three cantrips");
  // A cleric 4 holds more than a cleric 3: nothing of its goes.
  assert.deepEqual(moved.spells, CLERIC_WIZARD.spells);
  // Said, with the class named, and kept to put back.
  const said = moved.dropped?.drops.map((drop) => `${drop.label}: ${drop.value}`) ?? [];
  assert.deepEqual(said, [
    "Wizard spell: Thunderwave",
    "Wizard spell: Feather Fall",
    "Wizard prepared: Detect Magic",
  ]);
  assert.equal(moved.undo?.because, "class");
  const back = runBuilder([...clericWizard, (s) => s.changeExtraLevel(0, 1), null, (s) => s.putBack(), null]);
  assert.deepEqual(splitOf(back), ["cleric", "wizard 2"]);
  assert.deepEqual(back.casterSpells.wizard, before.casterSpells.wizard);
  assert.deepEqual(back.spells, CLERIC_WIZARD.spells);
  // The server takes the trimmed sheet.
  const built = builder.build({
    ...CLERIC_WIZARD,
    extraClasses: moved.extraClasses,
    casterSpells: moved.casterSpells,
    // The cleric's 4th level brings an improvement.
    asiChoices: [{ mode: "plus2", ability: "wis" }],
  });
  const out = server(built.sheet, 5);
  assert.deepEqual(out.problems, []);
  assert.deepEqual(sorted(casterOf(out.sheet, "wizard").spellbook), sorted(WIZARD_BOOK.spells.slice(0, 6)));
});

await test("a level moved from the cleric to the wizard trims the cleric's prepared list", () => {
  const moved = runBuilder([...clericWizard, (s) => s.changeExtraLevel(0, 3), null]);
  assert.deepEqual(splitOf(moved), ["cleric", "wizard 3"]);
  // A cleric 2 with Wisdom +2 prepares four: the last picked goes. Its
  // domain's spells count for nothing and never go.
  assert.deepEqual(moved.spells, CLERIC_WIZARD.spells.slice(0, 4));
  assert.deepEqual(moved.dropped?.drops.map((drop) => `${drop.label}: ${drop.value}`), ["Cleric spell: Command"]);
  // The wizard 3's book takes more, so nothing of its goes.
  assert.deepEqual(moved.casterSpells.wizard.spells, WIZARD_BOOK.spells);
});

await test("removing a casting class sets its lists aside, and Put it back returns the class with them", () => {
  const removed = runBuilder([...clericWizard, (s) => s.removeExtraClass(0), null]);
  assert.deepEqual(splitOf(removed), ["cleric"]);
  assert.deepEqual(removed.casterSpells, {});
  const said = removed.dropped?.drops.filter((drop) => drop.label === "Wizard spell").map((drop) => drop.value) ?? [];
  assert.deepEqual(sorted(said), sorted([...WIZARD_BOOK.cantrips, ...WIZARD_BOOK.spells]));
  // The cleric 5's lists hold more: nothing of its goes.
  assert.deepEqual(removed.spells, CLERIC_WIZARD.spells);
  const back = runBuilder([...clericWizard, (s) => s.removeExtraClass(0), null, (s) => s.putBack(), null]);
  assert.deepEqual(splitOf(back), ["cleric", "wizard 2"]);
  assert.deepEqual(back.casterSpells.wizard.spells, WIZARD_BOOK.spells);
  // A lower total level that sheds the wizard does the same.
  const shed = runBuilder([...clericWizard, (s) => s.changeLevel(3), null]);
  assert.deepEqual(splitOf(shed), ["cleric"]);
  assert.ok(shed.dropped?.drops.some((drop) => drop.label === "Wizard spell" && drop.value === "Fire Bolt"));
  assert.equal(shed.undo?.because, "level");
});

await test("a single class's lower level trims its lists to the new counts, as a split does", () => {
  // A wizard 5 elf with a full book of fourteen and Intelligence +3 and 5
  // prepared (eight); at level 3 the book holds ten and six are prepared.
  const book = [
    "Magic Missile", "Shield", "Sleep", "Burning Hands", "Detect Magic", "Mage Armor", "Thunderwave",
    "Feather Fall", "Misty Step", "Web", "Shatter", "Invisibility", "Fireball", "Counterspell",
  ];
  const wizard = [
    (s) => {
      s.changeRace("high_elf");
      s.changeClass("wizard");
      s.changeLevel(5);
      s.setScores({ str: 8, dex: 14, con: 13, int: 15, wis: 12, cha: 10 });
    },
    null,
    (s) => {
      s.setCantrips(["Fire Bolt", "Light", "Mage Hand", "Ray of Frost"]);
      s.setSpells(book);
      s.setBookPrepared(book.slice(0, 8));
    },
    null,
  ];
  const lower = runBuilder([...wizard, (s) => s.changeLevel(3), null]);
  // The 3rd-level spells go by their level, then the book to ten, the last
  // written first; prepared to six from what the book still holds.
  assert.ok(!lower.spells.includes("Fireball") && !lower.spells.includes("Counterspell"));
  assert.deepEqual(lower.spells, book.slice(0, 10));
  assert.deepEqual(lower.bookPrepared, book.slice(0, 6));
  // A wizard 3 knows three cantrips: the last one goes.
  assert.deepEqual(lower.cantrips, ["Fire Bolt", "Light", "Mage Hand"]);
  const said = lower.dropped?.drops.map((drop) => `${drop.label}: ${drop.value}`) ?? [];
  assert.ok(said.includes("cantrip: Ray of Frost"), said.join("; "));
  assert.ok(said.includes("spell: Invisibility"), "a count drop has no class name with one caster");
  assert.equal(lower.undo?.because, "level");
  const back = runBuilder([...wizard, (s) => s.changeLevel(3), null, (s) => s.putBack(), null]);
  assert.deepEqual(back.spells, book);
  assert.deepEqual(back.bookPrepared, book.slice(0, 8));
  assert.deepEqual(back.cantrips, ["Fire Bolt", "Light", "Mage Hand", "Ray of Frost"]);
});

console.log(`${passed} passed`);
