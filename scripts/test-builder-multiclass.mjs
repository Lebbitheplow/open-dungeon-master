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
  // Phase 1: one casting class. Beside a cleric, a wizard is not yet offered.
  const cleric = mc.multiclassChoices({
    rows: classes,
    classList: [{ id: "cleric", subclass: "", level: 3 }],
    abilities: { str: 13, dex: 13, con: 13, int: 13, wis: 13, cha: 13 },
    rowOf,
  });
  assert.match(cleric.find((choice) => choice.row.id === "wizard").reason, /one spellcasting class for now, and your Cleric already casts/);
  assert.match(cleric.find((choice) => choice.row.id === "warlock").reason, /Not available yet/);
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

console.log(`${passed} passed`);
