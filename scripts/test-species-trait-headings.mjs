// A species's traits as the table reads them (src/lib/content/mechanics.ts
// traitHeading): each paragraph's heading on its own. The parser used to
// switch the whole text into heading mode when any paragraph opened with
// "***Name.***" or "**_Name._**", so a hand-typed "**Breath Weapon.**" beside
// a trait added from the published list was dropped, the breath never
// granted and nothing said. Every way a person marks a trait reads now, a
// caption with no full stop and a bulleted option still do not, and the
// published rows read exactly as before.
import assert from "node:assert/strict";
import fs from "node:fs";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { raceMechanics, traitHeading } = await import("../src/lib/content/mechanics.ts");
const { heldTraitNames, traitParagraphs, unreadResistances, unreadTraitLines, withTrait } = await import("../src/lib/workshop/species-traits.ts");
const { speciesHoldsTrait } = await import("../src/lib/srd/race-id.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

const ANCESTRY = "**_Draconic Ancestry._** You have draconic ancestry. Choose one type of dragon from the Draconic Ancestry table.";
const BREATH = "You can use your action to exhale destructive energy.";
const FORMS = [
  `***Breath Weapon.*** ${BREATH}`,
  `**Breath Weapon.** ${BREATH}`,
  `**Breath Weapon**. ${BREATH}`,
  `_**Breath Weapon.**_ ${BREATH}`,
  `__Breath Weapon.__ ${BREATH}`,
];

test("every way of marking a trait reads beside one added from the published list, in either order", () => {
  for (const form of FORMS) {
    assert.deepEqual(raceMechanics({ traits: `${ANCESTRY}\n\n${form}` }).traitNames, ["Draconic Ancestry", "Breath Weapon"], form);
    assert.deepEqual(raceMechanics({ traits: `${form}\n\n${ANCESTRY}` }).traitNames, ["Breath Weapon", "Draconic Ancestry"], form);
  }
  assert.deepEqual(traitHeading(FORMS[1]), { name: "Breath Weapon", rest: BREATH });
});

test("a bold caption with no full stop and a bulleted option are no traits", () => {
  const traits = `${ANCESTRY}\n\n**Draconic Ancestry**\n\n| Dragon | Damage Type |\n|---|---|\n| Black | Acid |\n\n**_Alien Biology._** Choose one of the following:\n* **Alien Appendage.** You grow a tail.\n- **Alien Eyes.** You see far.`;
  const read = raceMechanics({ traits });
  assert.deepEqual(read.traitNames, ["Draconic Ancestry", "Alien Biology"]);
  assert.deepEqual(read.choiceTraitNames, ["Alien Biology"]);
  assert.equal(traitHeading("**Draconic Ancestry**"), null);
});

test("the expanded pack's one trait a line reads as before", () => {
  assert.deepEqual(raceMechanics({ traits: "Darkvision 60 ft\nStonecunning" }).traitNames, ["Darkvision 60 ft", "Stonecunning"]);
});

test("the bundled race fixtures keep their names and choices", () => {
  const here = (name) => new URL(`./fixtures/${name}`, import.meta.url);
  const srd = JSON.parse(fs.readFileSync(here("srd-race-rows.json"), "utf8")).rows.map((row) => raceMechanics(row.data));
  assert.equal(srd.length, 13);
  assert.equal(srd.reduce((sum, read) => sum + read.traitNames.length, 0), 28);
  assert.equal(srd.reduce((sum, read) => sum + read.choiceTraitNames.length, 0), 0);
  const pack = JSON.parse(fs.readFileSync(here("open5e-pack-rows.json"), "utf8")).races.map((row) => raceMechanics(row.data));
  assert.equal(pack.length, 28);
  assert.equal(pack.reduce((sum, read) => sum + read.traitNames.length, 0), 77);
  assert.equal(pack.reduce((sum, read) => sum + read.choiceTraitNames.length, 0), 5);
});

test("a trait paragraph is its own after one written another way, and its resistance is laid at its name", () => {
  const traits = "**_Marsh Stride._** Difficult terrain in wetlands costs you no extra movement.\n\n**Ember Blood.** You have resistance to fire damage.";
  assert.deepEqual([...traitParagraphs(traits).keys()], ["Marsh Stride", "Ember Blood"]);
  assert.equal(traitParagraphs(traits).get("Marsh Stride"), "Difficult terrain in wetlands costs you no extra movement.");
  assert.deepEqual(unreadResistances(traits), [{ trait: "Ember Blood", types: ["fire"] }]);
});

test("a hand-typed trait is held: Add a published trait neither repeats it nor hides it", () => {
  const typed = `**Breath Weapon.** ${BREATH}`;
  assert.equal(withTrait(typed, { name: "Breath Weapon", text: BREATH }), typed);
  const both = withTrait(typed, { name: "Draconic Ancestry", text: "You have draconic ancestry." });
  assert.deepEqual(heldTraitNames(both), ["Breath Weapon", "Draconic Ancestry"]);
  const rules = { traitNames: heldTraitNames(both) };
  assert.ok(speciesHoldsTrait(rules, "breath weapon"));
  assert.ok(speciesHoldsTrait(rules, "draconic ancestry"));
});

test("a paragraph marked another way is named as unread, and a read one is not", () => {
  const traits = `${ANCESTRY}\n\n**Breath Weapon:** ${BREATH}\n\n*Scales.* Your scales are hard.\n\nKeen Smell. You smell well.\n\nYour ancestry sets the damage.`;
  assert.deepEqual(unreadTraitLines(traits).map((hit) => hit.name), ["Breath Weapon", "Scales", "Keen Smell"]);
  assert.deepEqual(unreadTraitLines(`${ANCESTRY}\n\n${FORMS[1]}`), []);
  // With no trait marked at all, a plain sentence is the expanded pack's line.
  assert.deepEqual(unreadTraitLines("Keen Smell. You smell well."), []);
});

test("a typed text keeps its plain trait lines beside a bold one", () => {
  // A homebrew species written one trait per line, with one trait put in
  // bold later: every line was a trait before the per-paragraph reading,
  // and still is (the review of WA-06).
  const plain = "Darkvision. You can see in dim light.\n\n**Fey Ancestry.** You have advantage against being charmed.\n\nTrance. You don't need to sleep.";
  assert.deepEqual(raceMechanics({ traits: plain }).traitNames, ["Darkvision", "Fey Ancestry", "Trance"]);
  const expanded = "Darkvision 60 ft\nStonecunning\n**Marsh Stride.** Marsh costs you no extra movement.";
  assert.deepEqual(raceMechanics({ traits: expanded }).traitNames, ["Darkvision 60 ft", "Stonecunning", "Marsh Stride"]);
  // A trait's own words that go on are not traits.
  const words = "**Marsh Stride.** Marsh costs you no extra movement.\n\nYou can use this trait once per long rest.";
  assert.deepEqual(raceMechanics({ traits: words }).traitNames, ["Marsh Stride"]);
  // A pack's text keeps to its headings.
  const pack = "***Darkvision.*** You see.\n\nYou can see in dim light within 60 feet.";
  assert.deepEqual(raceMechanics({ traits: pack }).traitNames, ["Darkvision"]);
});

console.log(`\ntest-species-trait-headings: ${passed} tests passed.`);
