// SRD feature grants: creation-time population, idempotent regrant on level
// up, story/feat preservation, subclass matching, and custom-class fallback.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { classFeaturesFor, racialTraitsFor, populateFeatures, subclassLevelFor, srdSubclassName } =
  await import("../src/lib/srd/features.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

const names = (features) => features.map((feature) => feature.name);

test("level-1 fighter gets its starting features", () => {
  const granted = classFeaturesFor("fighter", "", 1);
  assert.deepEqual(names(granted), ["Fighting Style", "Second Wind"]);
  assert.ok(granted.every((feature) => feature.source === "class"));
});

test("higher levels accumulate features in level order", () => {
  const granted = classFeaturesFor("fighter", "", 5);
  assert.deepEqual(names(granted), [
    "Fighting Style",
    "Second Wind",
    "Action Surge (1 use)",
    "Martial Archetype",
    "Extra Attack",
  ]);
});

test("subclass features only when the subclass matches the SRD name", () => {
  assert.ok(names(classFeaturesFor("fighter", "Champion", 3)).includes("Improved Critical"));
  assert.ok(names(classFeaturesFor("fighter", "champion", 3)).includes("Improved Critical"));
  assert.ok(!names(classFeaturesFor("fighter", "Echo Knight", 3)).includes("Improved Critical"));
  assert.ok(!names(classFeaturesFor("fighter", "Champion", 2)).includes("Improved Critical"));
});

test("subclass matching tolerates partial content-pack names", () => {
  assert.ok(names(classFeaturesFor("wizard", "Evocation", 3)).includes("Evocation Savant"));
  assert.ok(names(classFeaturesFor("cleric", "Life", 1)).includes("Disciple of Life"));
  assert.ok(!names(classFeaturesFor("wizard", "War", 3)).includes("Evocation Savant"));
});

test("race ids tolerate content-pack slugs", () => {
  assert.ok(names(racialTraitsFor("half-elf")).length > 0);
  assert.deepEqual(names(racialTraitsFor("Half-Elf")), names(racialTraitsFor("half_elf")));
});

test("racial traits come from races.json", () => {
  const traits = racialTraitsFor("hill_dwarf");
  assert.ok(names(traits).includes("Darkvision 60 ft"));
  assert.ok(traits.every((feature) => feature.source === "race"));
  assert.deepEqual(racialTraitsFor("modron"), []);
});

test("populateFeatures grants class + race for a fresh sheet", () => {
  const features = populateFeatures([], "barbarian", "", "hill_dwarf", 1);
  assert.ok(names(features).includes("Rage"));
  assert.ok(names(features).includes("Darkvision 60 ft"));
});

test("regrant at a higher level keeps story features and adds new grants", () => {
  const atOne = populateFeatures([], "fighter", "", "hill_dwarf", 1);
  const withStory = [...atOne, { name: "Mark of the Raven Queen", source: "story" }];
  const atFive = populateFeatures(withStory, "fighter", "", "hill_dwarf", 5);
  assert.ok(names(atFive).includes("Extra Attack"));
  assert.ok(names(atFive).includes("Mark of the Raven Queen"));
  // Idempotent: regranting at the same level changes nothing.
  assert.deepEqual(populateFeatures(atFive, "fighter", "", "hill_dwarf", 5), atFive);
});

test("story duplicate of an SRD grant collapses to the SRD entry", () => {
  const features = populateFeatures(
    [{ name: "rage", source: "story" }],
    "barbarian",
    "",
    "half_orc",
    1,
  );
  const rages = features.filter((feature) => feature.name.toLowerCase() === "rage");
  assert.equal(rages.length, 1);
  assert.equal(rages[0].source, "class");
});

test("custom class degrades to race + story features", () => {
  const features = populateFeatures(
    [{ name: "Chronomancy", source: "story" }],
    "timeweaver",
    "Moment Sage",
    "high_elf",
    7,
  );
  assert.ok(names(features).includes("Chronomancy"));
  assert.ok(features.every((feature) => feature.source !== "class"));
});

test("subclass pick levels", () => {
  assert.equal(subclassLevelFor("fighter"), 3);
  assert.equal(subclassLevelFor("cleric"), 1);
  assert.equal(subclassLevelFor("wizard"), 2);
  assert.equal(subclassLevelFor("druid"), 2);
  assert.equal(subclassLevelFor("timeweaver"), null);
});

test("srd subclass names resolve", () => {
  assert.equal(srdSubclassName("fighter"), "Champion");
  assert.equal(srdSubclassName("warlock"), "The Fiend");
  assert.equal(srdSubclassName("timeweaver"), null);
});

console.log(`test-features: ${passed} tests passed.`);
