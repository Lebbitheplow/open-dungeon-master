// The server's answer to "may this sheet hold these spells?", asked at
// creation and edit (POST/PUT /api/characters, the campaign sheet routes,
// companions/create) and at level-up.
//
// The rule this file guards: the 5e spell tables are enforced where the sheet
// is saved, not only where it is built. Before this the builder held every
// class to its counts and the server saved whatever arrived (issue #37).
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { spellListProblems, cantripCapOf } = await import("../src/lib/srd/spell-prep.ts");
const { suggestedCantripCount, suggestedSpellCount } = await import("../src/lib/content/mechanics.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

const abilities = { str: 10, dex: 14, con: 14, int: 16, wis: 16, cha: 16 };

function sheet(klass, level, casting, extra = {}) {
  return {
    class: klass,
    level,
    subclass: "",
    classes: [],
    abilities,
    spellcasting: casting
      ? { ability: casting.ability ?? "int", slots: {}, known: [], prepared: [], cantrips: [], ...casting }
      : null,
    ...extra,
  };
}

test("a level 1 sorcerer knows 4 cantrips and 2 spells, and no more", () => {
  const fine = sheet("sorcerer", 1, { ability: "cha", cantrips: ["Fire Bolt", "Light", "Mage Hand", "Prestidigitation"], known: ["Magic Missile", "Shield"] });
  assert.deepEqual(spellListProblems(fine), []);
  const spells = sheet("sorcerer", 1, { ability: "cha", cantrips: ["Fire Bolt"], known: ["Magic Missile", "Shield", "Sleep"] });
  assert.match(spellListProblems(spells)[0], /may hold 2 spells known; that list has 3/);
  const cantrips = sheet("sorcerer", 1, { ability: "cha", cantrips: ["Fire Bolt", "Light", "Mage Hand", "Prestidigitation", "Ray of Frost"], known: [] });
  assert.match(spellListProblems(cantrips)[0], /knows 4 cantrips; that list has 5/);
});

test("a level 1 cleric prepares Wisdom modifier + level, and the domain's spells are free", () => {
  // WIS 16 at level 1: four prepared. Life Domain adds Bless and Cure Wounds for free.
  const fine = sheet("cleric", 1, { ability: "wis", cantrips: ["Guidance", "Sacred Flame", "Thaumaturgy"], prepared: ["Bless", "Cure Wounds", "Healing Word", "Shield of Faith", "Guiding Bolt"] }, { subclass: "Life Domain" });
  assert.deepEqual(spellListProblems(fine), []);
  const over = sheet("cleric", 1, { ability: "wis", cantrips: ["Guidance"], prepared: ["Healing Word", "Shield of Faith", "Guiding Bolt", "Command", "Sanctuary"] });
  assert.match(spellListProblems(over)[0], /may hold 4 spells prepared; that list has 5/);
});

test("a wizard starts with six spells in the book at creation, any number after copying scrolls", () => {
  const book = ["Magic Missile", "Shield", "Sleep", "Mage Armor", "Detect Magic", "Find Familiar", "Burning Hands"];
  const created = sheet("wizard", 1, { cantrips: ["Fire Bolt", "Light", "Mage Hand"], prepared: ["Magic Missile"], spellbook: book });
  assert.match(spellListProblems(created)[0], /starts with 6 spells in the spellbook; that book has 7/);
  assert.deepEqual(spellListProblems(created, { bookAllowance: false }), []);
});

test("a spell above the level the slots reach is refused, and a warlock's Arcanum is not", () => {
  const wizard = sheet("wizard", 1, { cantrips: ["Fire Bolt", "Light", "Mage Hand"], prepared: ["Fireball"], spellbook: ["Fireball"] });
  assert.match(spellListProblems(wizard)[0], /Fireball is a level 3 spell; a level 1 wizard casts up to level 1/);
  const warlock = sheet("warlock", 11, { ability: "cha", cantrips: ["Eldritch Blast", "Minor Illusion", "Prestidigitation", "Chill Touch"], known: ["Hex", "Armor of Agathys", "Hold Person", "Counterspell", "Banishment", "Hold Monster", "Circle of Death", "Fear", "Fly", "Dimension Door", "Scrying"] });
  assert.deepEqual(spellListProblems(warlock), []);
});

test("a level 1 paladin has no slots yet, so a spell on the list is refused", () => {
  const paladin = sheet("paladin", 1, { ability: "cha", prepared: ["Cure Wounds"] });
  assert.match(spellListProblems(paladin)[0], /no spell slots yet, so Cure Wounds cannot be on the list/);
  assert.deepEqual(spellListProblems(sheet("paladin", 2, { ability: "cha", prepared: ["Cure Wounds", "Bless"] })), []);
});

test("a non-caster and a sheet without spellcasting raise nothing", () => {
  assert.deepEqual(spellListProblems(sheet("fighter", 5, null)), []);
  assert.deepEqual(spellListProblems(sheet("rogue", 1, { known: [], prepared: [] })), []);
});

test("an artificer has cantrip and prepared caps from level 1", () => {
  assert.equal(suggestedCantripCount("artificer", 1, "artificer"), 2);
  assert.equal(suggestedCantripCount("artificer", 10, "artificer"), 3);
  // INT 16 at level 1: 3 + floor(1/2) = 3.
  assert.deepEqual(suggestedSpellCount("artificer", 1, 3), { label: "spells prepared", count: 3 });
  assert.deepEqual(suggestedSpellCount("artificer", 5, 3), { label: "spells prepared", count: 5 });
  assert.equal(cantripCapOf({ classId: "artificer", level: 1 }), 2);
  const over = sheet("artificer", 1, { cantrips: ["Mending", "Guidance", "Light"], prepared: ["Cure Wounds"] });
  assert.match(spellListProblems(over)[0], /knows 2 cantrips; that list has 3/);
});

test("a multiclassed sheet checks each caster class at its own level", () => {
  const multi = sheet("wizard", 6, {
    casters: [
      { classId: "wizard", ability: "int", cantrips: ["Fire Bolt", "Light", "Mage Hand"], prepared: ["Magic Missile"], spellbook: ["Magic Missile", "Shield", "Sleep", "Mage Armor", "Detect Magic", "Find Familiar", "Misty Step", "Web", "Fireball", "Counterspell"] },
      { classId: "cleric", ability: "wis", cantrips: ["Guidance", "Sacred Flame", "Thaumaturgy", "Light"], prepared: ["Bless"] },
    ],
  }, { classes: [{ id: "wizard", subclass: "", level: 5 }, { id: "cleric", subclass: "", level: 1 }] });
  const problems = spellListProblems(multi, { bookAllowance: false });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /level 1 cleric knows 3 cantrips; that list has 4/);
});

console.log(`\ntest-spell-list-problems: ${passed} tests passed.`);
