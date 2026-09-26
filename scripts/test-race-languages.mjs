// What a race's Languages trait grants, read from the content pack's prose.
//
// The rule this file guards: only the sentence that says what the character
// can speak counts. The flavor after it (which script Orc is written in,
// whose curses humans borrow) is not a grant. Reading names out of that
// flavor is how a Human came to speak Common, Dwarvish, Elvish and Orc, and
// a Half-Orc and a Gnome to speak Dwarvish (issue #37).
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { parseRaceLanguages, raceMechanics } = await import("../src/lib/content/mechanics.ts");
const { packRaceOptions } = await import("../src/lib/content/race-options.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

// The Open5e (wotc-srd) trait texts, verbatim.
const HUMAN =
  "**_Languages._** You can speak, read, and write Common and one extra language of your choice. Humans typically learn the languages of other peoples they deal with, including obscure dialects. They are fond of sprinkling their speech with words borrowed from other tongues: Orc curses, Elvish musical expressions, Dwarvish military phrases, and so on.";
const HALF_ORC =
  "**_Languages._** You can speak, read, and write Common and Orc. Orc is a harsh, grating language with hard consonants. It has no script of its own but is written in the Dwarvish script.";
const GNOME =
  "**_Languages._** You can speak, read, and write Common and Gnomish. The Gnomish language, which uses the Dwarvish script, is renowned for its technical treatises and its catalogs of knowledge about the natural world.";
const HALF_ELF =
  "**_Languages._** You can speak, read, and write Common, Elvish, and one extra language of your choice.";
// Tome of Heroes.
const DERRO = "***Languages.*** You can speak, read, and write Dwarvish and your choice of Common or Undercommon.";
const ERINA = "***Languages.*** You can speak Erina and either Common or Sylvan.";
const SATARRE =
  "***Languages.*** You can speak, read, and write Common and one of the following: Abyssal, Infernal, or Void Speech. Void Speech is a language of dark gods and ancient blasphemies, and the mere sound of its sibilant tones makes many other creatures quite uncomfortable.";
const GEARFORGED =
  "***Languages.*** You can speak, read, and write Common, Machine Speech (a whistling, clicking language that's incomprehensible to non-gearforged), and a language associated with your Race Chassis.";
const SHADE = "***Languages.*** You can speak, read, and write Common and one other language spoken by your Living Origin.";

test("a human speaks Common and picks one more; the flavor sentence grants nothing", () => {
  assert.deepEqual(parseRaceLanguages(HUMAN), { languages: ["Common"], bonusLanguages: 1 });
});

test("a script mentioned in the flavor is not a language known", () => {
  assert.deepEqual(parseRaceLanguages(HALF_ORC), { languages: ["Common", "Orc"], bonusLanguages: 0 });
  assert.deepEqual(parseRaceLanguages(GNOME), { languages: ["Common", "Gnomish"], bonusLanguages: 0 });
});

test("a list before the free pick is read whole", () => {
  assert.deepEqual(parseRaceLanguages(HALF_ELF), { languages: ["Common", "Elvish"], bonusLanguages: 1 });
});

test("'your choice of X or Y' and 'either X or Y' are one pick from a short list", () => {
  assert.deepEqual(parseRaceLanguages(DERRO), {
    languages: ["Dwarvish"],
    bonusLanguages: 1,
    languageChoice: { count: 1, from: ["Common", "Undercommon"] },
  });
  assert.deepEqual(parseRaceLanguages(ERINA), {
    languages: ["Erina"],
    bonusLanguages: 1,
    languageChoice: { count: 1, from: ["Common", "Sylvan"] },
  });
});

test("'one of the following' lists the choices and the sentence after it is flavor", () => {
  assert.deepEqual(parseRaceLanguages(SATARRE), {
    languages: ["Common"],
    bonusLanguages: 1,
    languageChoice: { count: 1, from: ["Abyssal", "Infernal", "Void Speech"] },
  });
});

test("a tongue outside the standard list survives, a parenthetical does not", () => {
  assert.deepEqual(parseRaceLanguages(GEARFORGED), {
    languages: ["Common", "Machine Speech"],
    bonusLanguages: 1,
  });
  assert.deepEqual(parseRaceLanguages(SHADE), { languages: ["Common"], bonusLanguages: 1 });
});

test("the expanded pack's plain lists still read as lists", () => {
  assert.deepEqual(parseRaceLanguages("Common, Auran"), { languages: ["Common", "Auran"], bonusLanguages: 0 });
  assert.deepEqual(raceMechanics({ languages: ["Common", "Dwarvish"], bonusLanguages: 1 }).languages, ["Common", "Dwarvish"]);
  assert.equal(raceMechanics({ languages: ["Common", "Elvish", "one of your choice"] }).bonusLanguages, 1);
});

test("a 2024 species keeps its speed from the trait list and shows trait names", () => {
  const goliath = raceMechanics({
    traits: [
      { name: "Size", desc: "Medium (about 7-8 feet tall)", type: "SIZE" },
      { name: "Speed", desc: "35 feet", type: "SPEED" },
      { name: "Giant Ancestry", desc: "You are descended from Giants.", type: null },
      { name: "Powerful Build", desc: "You have Advantage...", type: null },
    ],
  });
  assert.equal(goliath.speed, 35);
  assert.equal(goliath.traitsSummary, "Giant Ancestry · Powerful Build");
  assert.ok(!goliath.traitsSummary.includes("[object Object]"));
});

test("a subrace row folds in its parent's speed, languages and ability bumps", () => {
  const options = packRaceOptions([
    { slug: "dwarf", name: "Dwarf", data: { asi: [{ attributes: ["Constitution"], value: 2 }], speed: { walk: 25 }, languages: "You can speak, read, and write Common and Dwarvish." } },
    { slug: "toh-grim", name: "Grim Dwarf", data: { asi: [{ attributes: ["Wisdom"], value: 1 }], traits: "**_Grim._** You are grim.", parent_slug: "dwarf" } },
  ]);
  const grim = options.find((entry) => entry.id === "toh-grim");
  assert.deepEqual(grim.asi, { con: 2, wis: 1 });
  assert.equal(grim.speed, 25);
  assert.deepEqual(grim.languages, ["Common", "Dwarvish"]);
  assert.equal(grim.traitsSummary, "Grim");
});

test("a pack row the bundled SRD knows takes its grants from the SRD, keeping the pack's prose", () => {
  const [hillDwarf, highElf, variantHuman] = packRaceOptions([
    { slug: "hill-dwarf", name: "Hill Dwarf", data: { asi: [{ attributes: ["Wisdom"], value: 1 }], traits: "**_Dwarven Toughness._** Your hit point maximum increases by 1.", parent_slug: "dwarf" } },
    { slug: "high-elf", name: "High Elf", data: { asi: [{ attributes: ["Intelligence"], value: 1 }], parent_slug: "elf" } },
    { slug: "variant-human", name: "Human (Variant)", data: { asi: {}, speed: 30, languages: "Common" } },
  ]);
  assert.deepEqual(hillDwarf.asi, { con: 2, wis: 1 });
  assert.equal(hillDwarf.speed, 25);
  assert.deepEqual(hillDwarf.languages, ["Common", "Dwarvish"]);
  assert.equal(hillDwarf.toolChoice.count, 1);
  assert.equal(hillDwarf.traitsSummary, "Dwarven Toughness");
  assert.deepEqual(highElf.skills, ["perception"]);
  assert.equal(highElf.cantripChoice.list, "wizard");
  assert.equal(highElf.bonusLanguages, 1);
  assert.equal(variantHuman.bonusLanguages, 1);
  assert.equal(variantHuman.skillChoice.count, 1);
});

console.log(`\ntest-race-languages: ${passed} tests passed.`);
