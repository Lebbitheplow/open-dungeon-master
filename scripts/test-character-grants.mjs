// Creation-time grants that used to be silently dropped: racial skills and
// tools, choice-based racial bonuses, background features/tools/equipment,
// and class tool proficiencies.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { populateFeatures } = await import("../src/lib/srd/features.ts");
const { SRD_BACKGROUNDS, SRD_CLASSES, SRD_RACES, sizeForRace, speedFor } = await import(
  "../src/lib/srd/index.ts"
);
const { CUSTOM_BACKGROUNDS, backgroundFeatureFor } = await import(
  "../src/lib/backgrounds/index.ts"
);
const { CUSTOM_CLASSES } = await import("../src/lib/classes/index.ts");
const { suggestedCantripCount } = await import("../src/lib/content/mechanics.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

const race = (id) => SRD_RACES.find((entry) => entry.id === id);

test("races that grant a skill in prose now carry it structurally", () => {
  assert.deepEqual(race("high_elf").skills, ["perception"]);
  assert.deepEqual(race("half_orc").skills, ["intimidation"]);
});

test("half-elf exposes both its choice grants", () => {
  assert.deepEqual(race("half_elf").asiChoice, { count: 2, amount: 1 });
  assert.deepEqual(race("half_elf").skillChoice, { count: 2 });
});

test("high elf offers a wizard cantrip, hill dwarf a tool choice", () => {
  assert.deepEqual(race("high_elf").cantripChoice, { list: "wizard", count: 1 });
  assert.equal(race("hill_dwarf").toolChoice.count, 1);
  assert.ok(race("hill_dwarf").toolChoice.from.includes("smith's tools"));
  assert.deepEqual(race("rock_gnome").tools, ["tinker's tools"]);
});

test("every SRD and custom class defines tool proficiencies", () => {
  for (const klass of [...SRD_CLASSES, ...CUSTOM_CLASSES]) {
    assert.ok(Array.isArray(klass.tools), `${klass.id} is missing tools`);
  }
  const rogue = SRD_CLASSES.find((entry) => entry.id === "rogue");
  assert.deepEqual(rogue.tools, ["thieves' tools"]);
  const netrunner = CUSTOM_CLASSES.find((entry) => entry.id === "netrunner");
  assert.ok(netrunner.tools.length > 0);
});

test("every background carries tools, languages and starting equipment", () => {
  for (const background of [...SRD_BACKGROUNDS, ...CUSTOM_BACKGROUNDS]) {
    assert.ok(Array.isArray(background.tools), `${background.id} is missing tools`);
    assert.equal(
      typeof background.languages,
      "number",
      `${background.id} is missing languages`,
    );
    assert.ok(
      Array.isArray(background.equipment) && background.equipment.length > 0,
      `${background.id} is missing equipment`,
    );
  }
});

test("background features resolve for both SRD and catalog entries", () => {
  assert.deepEqual(backgroundFeatureFor("acolyte"), {
    name: "Shelter of the Faithful",
    background: "Acolyte",
  });
  assert.deepEqual(backgroundFeatureFor("corpo_dropout"), {
    name: "Severance Package",
    background: "Corpo Dropout",
  });
  assert.equal(backgroundFeatureFor("not_a_background"), null);
  assert.equal(backgroundFeatureFor(""), null);
});

test("a background feature survives regrants at level up", () => {
  const atOne = populateFeatures(
    [{ name: "Shelter of the Faithful (Acolyte)", source: "background" }],
    "cleric",
    "",
    "high_elf",
    1,
  );
  const names = (list) => list.map((feature) => feature.name);
  assert.ok(names(atOne).includes("Shelter of the Faithful (Acolyte)"));
  const atFive = populateFeatures(atOne, "cleric", "Life Domain", "high_elf", 5);
  assert.ok(
    names(atFive).includes("Shelter of the Faithful (Acolyte)"),
    "background feature must not be stripped by the boot resync",
  );
});

test("cantrip advice matches the SRD tables and custom caster fallback", () => {
  assert.equal(suggestedCantripCount("wizard", 1), 3);
  assert.equal(suggestedCantripCount("wizard", 4), 4);
  assert.equal(suggestedCantripCount("bard", 1), 2);
  assert.equal(suggestedCantripCount("fighter", 1), null);
  // Custom classes have no table; they follow their caster type.
  assert.equal(suggestedCantripCount("netrunner", 1, "full"), 2);
  assert.equal(suggestedCantripCount("netrunner", 10, "full"), 4);
  assert.equal(suggestedCantripCount("street_samurai", 5, "none"), null);
});

test("the subrace variants carry their structural grants", () => {
  const byId = Object.fromEntries(SRD_RACES.map((race) => [race.id, race]));
  assert.deepEqual(byId.mountain_dwarf.armor, ["light", "medium"]);
  assert.ok(byId.wood_elf.weapons.includes("longbows"));
  assert.equal(byId.wood_elf.speed, 35);
  assert.ok(byId.drow.weapons.includes("hand crossbows"));
  assert.deepEqual(byId.variant_human.asiChoice, { count: 2, amount: 1 });
  assert.deepEqual(byId.variant_human.skillChoice, { count: 1 });
  assert.equal(byId.deep_gnome.languages.includes("Undercommon"), true);
});

test("sizeForRace: Small races are Small, everything else (and unknowns) Medium", () => {
  assert.equal(sizeForRace("stout_halfling"), "Small");
  assert.equal(sizeForRace("forest_gnome"), "Small");
  assert.equal(sizeForRace("goblin"), "Small");
  assert.equal(sizeForRace("mountain_dwarf"), "Medium");
  // Content-pack slugs normalize; homebrew defaults to Medium.
  assert.equal(sizeForRace("Lightfoot-Halfling"), "Small");
  assert.equal(sizeForRace("dragonkin homebrew"), "Medium");
});

test("speedFor gates class speed bonuses on what is worn", () => {
  const monk = (equipment) => ({
    class: "monk",
    level: 10,
    speed: 30,
    abilities: { str: 10, dex: 14, con: 12, int: 10, wis: 14, cha: 10 },
    proficiencies: { armor: [] },
    equipment,
    features: [{ name: "Unarmored Movement" }],
  });
  assert.equal(speedFor(monk([])), 50);
  // Any armor or a shield switches Unarmored Movement off.
  assert.equal(speedFor(monk([{ name: "Leather", equipped: true }])), 30);
  assert.equal(speedFor(monk([{ name: "Shield", equipped: true }])), 30);

  const barbarian = (equipment) => ({
    class: "barbarian",
    level: 5,
    speed: 30,
    abilities: { str: 16, dex: 14, con: 16, int: 8, wis: 10, cha: 10 },
    proficiencies: { armor: ["light", "medium", "heavy", "shields"] },
    equipment,
    features: [{ name: "Fast Movement" }],
  });
  // Fast Movement survives medium armor, dies in heavy.
  assert.equal(speedFor(barbarian([{ name: "Scale Mail", equipped: true }])), 40);
  assert.equal(speedFor(barbarian([{ name: "Chain Mail", equipped: true }])), 30);
});

test("heavy armor below its Strength requirement costs 10 feet", () => {
  const weakling = {
    class: "fighter",
    level: 1,
    speed: 30,
    abilities: { str: 10, dex: 10, con: 12, int: 10, wis: 10, cha: 10 },
    proficiencies: { armor: ["heavy"] },
    equipment: [{ name: "Plate", equipped: true }],
    features: [],
  };
  assert.equal(speedFor(weakling), 20);
  assert.equal(speedFor({ ...weakling, abilities: { ...weakling.abilities, str: 15 } }), 30);
});

console.log(`\ntest-character-grants: ${passed} tests passed.`);
