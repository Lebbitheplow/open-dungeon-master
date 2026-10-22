// A class made in the workshop is a class: the builder offers it to the
// table it was made for, the creation check holds a character to its
// numbers, a level-up grants its features and the spell slots its casting
// gives, a workshop subclass can sit under it, and a bundle carries it with
// the pregen that holds it (src/lib/homebrew/class-data.ts,
// src/lib/classes/workshop-registry.ts). Before, the workshop made items,
// spells, feats, backgrounds, species, subclasses of the twelve SRD classes
// and hazards, and no class at all.
import assert from "node:assert/strict";
import { openCreation, LEGAL_FIGHTER, PORTRAIT } from "./lib/enforce-creation.mjs";
import { suite } from "./lib/enforce-harness.mjs";

const { test, finish } = suite("test-workshop-classes");

const { findClass, spellSlotsFor } = await import("../src/lib/srd/index.ts");
const { classFeaturesFor, subclassLevelFor } = await import("../src/lib/srd/features.ts");
const { workshopClassId, normalizeClassData } = await import("../src/lib/homebrew/class-data.ts");
const { workshopClassDef } = await import("../src/lib/classes/workshop-registry.ts");
const { classFeatureDescription } = await import("../src/lib/classes/feature-text.ts");
const { subclassExtrasForTable } = await import("../src/lib/db/subclass-extras.ts");
const { bundledClassTable } = await import("../src/lib/workshop/class-catalog.ts");
const { draftFromCatalog } = await import("../src/app/workshop/homebrew/draft.ts");
const { classFindings } = await import("../src/lib/rulesets/validate-options.ts");
const { portableSheet, landedSheet } = await import("../src/lib/db/workshop-bundle-shelf.ts");
const { syncWorkshopClasses } = await import("../src/lib/db/homebrew.ts");

const table = await openCreation({ campaign: { maxPlayers: 6 } });
const { world } = table;
const homebrew = await world.route("homebrew");
const entryRoute = await world.route("homebrew/[id]");

// A half caster from the wizard's list, a d10, Strength and Intelligence.
const SPELLBLADE = {
  desc: "A warrior who folds a wizard's spells into the swing of a blade.",
  hitDie: 10,
  saves: ["str", "int"],
  skillChoices: { count: 2, from: ["arcana", "athletics", "history", "perception"] },
  armor: ["light", "medium"],
  weapons: ["simple", "martial"],
  tools: [],
  casterType: "half",
  spellListFrom: "wizard",
  spellAbility: "int",
  subclassLevel: 3,
  levels: {
    1: [{ n: "Arcane Strike", d: "Once a turn, a weapon hit deals an extra 1d8 force damage." }],
    4: [{ n: "Ability Score Improvement", d: "Raise one ability score by 2, or two by 1, or take a feat." }],
    5: [{ n: "Extra Attack", d: "Attack twice when you take the Attack action." }],
  },
};

async function brew(kind, name, data) {
  world.signIn(world.owner);
  const response = await homebrew.POST(new Request("http://test/", { method: "POST", body: JSON.stringify({ kind, name, data }) }));
  return { status: response.status, body: await response.json() };
}

const made = await brew("class", "Spellblade", SPELLBLADE);
const classId = made.body.entry ? workshopClassId(made.body.entry.id) : "";

await test("A class kept in the workshop is a class to the engines at once.", () => {
  assert.equal(made.status, 201, JSON.stringify(made.body));
  const klass = findClass(classId);
  assert.ok(klass, "findClass does not know the workshop class");
  assert.deepEqual([klass.name, klass.hitDie, klass.casterType, klass.spellAbility], ["Spellblade", 10, "half", "int"]);
  assert.equal(subclassLevelFor(classId), 3);
  const names = classFeaturesFor(classId, "", 5).map((feature) => feature.name);
  assert.deepEqual(names, ["Arcane Strike", "Ability Score Improvement", "Extra Attack"]);
  assert.equal(classFeatureDescription(classId, "Arcane Strike"), "Once a turn, a weapon hit deals an extra 1d8 force damage.");
});

await test("Its casting gives a half caster's slots: none at 1st level, four 1st and two 2nd at 5th.", () => {
  assert.deepEqual(spellSlotsFor(classId, 1), {});
  assert.deepEqual(spellSlotsFor(classId, 5), { 1: 4, 2: 2 });
});

await test("The workshop refuses a class that is not one: a single save, or more skill picks than skills.", async () => {
  const oneSave = await brew("class", "Lopsided", { ...SPELLBLADE, saves: ["str"] });
  assert.equal(oneSave.status, 400, JSON.stringify(oneSave.body));
  assert.match(oneSave.body.error ?? "", /two saving throws/);
  assert.ok("error" in normalizeClassData({ ...SPELLBLADE, skillChoices: { count: 5, from: ["arcana"] } }));
});

await test("A player at the DM's table makes a Spellblade, held to its numbers.", async () => {
  const sheet = {
    ...LEGAL_FIGHTER,
    name: "Veyla",
    class: classId,
    portrait: PORTRAIT,
    maxHp: 10 + 2,
    hitDice: { die: "d10", total: 1, spent: 0 },
    proficiencies: {
      ...LEGAL_FIGHTER.proficiencies,
      saves: ["str", "int"],
      skills: ["athletics", "intimidation", "arcana", "history"],
      armor: ["light", "medium"],
      weapons: ["simple", "martial"],
    },
    ac: 14,
    equipment: [{ name: "Longsword", qty: 1 }, { name: "Scale Mail", qty: 1 }],
    features: [],
  };
  const made = await table.atTable(sheet);
  assert.equal(made.status, 201, made.error ?? "");
  assert.equal(made.sheet.class, classId);
  assert.ok(made.sheet.features.some((feature) => feature.name === "Arcane Strike"), made.sheet.features.map((feature) => feature.name).join(", "));
  // Proficient in the class's two saves, whatever the request said.
  const wrong = await table.atTable({ ...sheet, proficiencies: { ...sheet.proficiencies, saves: ["str", "con"] } });
  assert.ok(wrong.status !== 201 || [...wrong.sheet.proficiencies.saves].sort().join() === "int,str", `a Spellblade kept the saves it asked for: ${JSON.stringify(wrong.sheet?.proficiencies.saves)}`);
});

await test("A level change grants the class's next features.", () => {
  const hero = world.addHero({ name: "Corvin", class: classId, level: 1 });
  world.patch(hero.id, { level: 5 });
  const held = world.sheet(hero.id).features.map((feature) => feature.name);
  assert.ok(held.includes("Extra Attack"), held.join(", "));
});

await test("A workshop subclass sits under a workshop class and grants its features.", async () => {
  const sub = await brew("archetype", "Order of Ash", { desc: "", classSlug: classId, levels: { 3: [{ n: "Ashen Ward", d: "Resistance to fire damage." }] } });
  assert.equal(sub.status, 201, JSON.stringify(sub.body));
  const extras = subclassExtrasForTable(world.campaignId, world.owner.id);
  const names = classFeaturesFor(classId, "Order of Ash", 3, extras).map((feature) => feature.name);
  assert.ok(names.includes("Ashen Ward"), names.join(", "));
});

await test("The campaign snapshot sends the table's workshop classes to the browser.", async () => {
  world.signIn(world.owner);
  const route = await world.route("campaigns/[campaignId]");
  const response = await route.GET(new Request("http://test/"), { params: Promise.resolve({ campaignId: world.campaignId }) });
  const body = await response.json();
  assert.ok((body.classes ?? []).some((def) => def.klass.id === classId), "the snapshot carries no workshop classes");
});

await test("Start from a class: the wizard's numbers and its features with their words.", () => {
  const wizard = bundledClassTable("wizard");
  assert.deepEqual([wizard.hitDie, wizard.casterType, wizard.spellListFrom, wizard.spellAbility], [6, "full", "wizard", "int"]);
  assert.ok(wizard.levels["1"].some((row) => row.n === "Arcane Recovery" && row.d), JSON.stringify(wizard.levels["1"]));
  const draft = draftFromCatalog("class", { name: "Wizard", data: { desc: "### Spellcasting\n\nAs a student of arcane magic..." }, table: wizard });
  assert.equal(draft.name, "Wizard Variant");
  // The class's own line, not the pack's write-up of every feature.
  assert.equal(draft.data.desc, wizard.desc);
  assert.doesNotMatch(String(draft.data.desc), /###/);
  const kept = normalizeClassData(draft.data);
  assert.ok("data" in kept);
  // Weapons by name and the druid's nonmetal shields survive the copy.
  assert.ok(kept.data.weapons.includes("daggers"), JSON.stringify(kept.data.weapons));
  const druid = normalizeClassData(bundledClassTable("druid"));
  assert.ok("data" in druid && druid.data.armor.includes("shields (nonmetal)"), JSON.stringify(druid));
});

await test("A bundle writes the class by name and lands it under the new id.", () => {
  const entry = made.body.entry;
  const portable = portableSheet({ ...LEGAL_FIGHTER, class: classId }, new Map([[entry.id, entry]]));
  assert.equal(portable.class, "homebrew:@class:Spellblade");
  const landed = landedSheet(portable, { entryFor: (kind, name) => (kind === "class" && name === "Spellblade" ? "new-id" : null), renames: new Map() });
  assert.equal(landed.class, workshopClassId("new-id"));
});

await test("The workshop's findings measure a class against the SRD's.", () => {
  const findings = classFindings({ ...SPELLBLADE, casterType: "full", hitDie: 12, saves: ["dex", "con"] });
  assert.ok(findings.some((finding) => /full caster with a d12/.test(finding.text)), JSON.stringify(findings));
  assert.ok(findings.some((finding) => /saves that come up most/.test(finding.text)), JSON.stringify(findings));
});

await test("Renaming the class reaches the engines; a restart reads it back from the database.", async () => {
  world.signIn(world.owner);
  const response = await entryRoute.PATCH(
    new Request("http://test/", { method: "PATCH", body: JSON.stringify({ name: "Hexblade Knight", data: SPELLBLADE }) }),
    { params: Promise.resolve({ id: made.body.entry.id }) },
  );
  assert.equal(response.status, 200, JSON.stringify(await response.json()));
  assert.equal(findClass(classId).name, "Hexblade Knight");
  syncWorkshopClasses();
  assert.ok(workshopClassDef(classId), "a sync from the database lost the class");
});

world.close();
finish();
