// The spell desk on the builder's spell step (backlog F13).
//
// The step had a name search and a tab per level, and nothing else a
// player planning a caster needs at hand: no way to ask for the rituals or
// the bonus-action spells, the book and the prepared list never in view
// together, a prepared cap said only as a count, and a full list that
// refused a new spell until one was taken out. The desk adds filters for
// school, ritual, concentration and casting time, both lists side by side,
// each cap as its sum ("Wizard level 3 + INT +3 = 6"), a swap in one action
// when a list is full, and the save DC, attack and slots on the step.
import assert from "node:assert/strict";
import fs from "node:fs";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { createElement } = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");
const { SpellBook } = await import("../src/components/sheet/SpellBook.tsx");
const filters = await import("../src/components/sheet/spellFilters.ts");
const desk = await import("../src/app/characters/builder/spellDesk.ts");
const { preparedCapLine, builderSpellAdvice, builderCasting } = await import("../src/app/characters/builder/casting.ts");

// Windows checkouts may hold CRLF line ends; the source checks read LF.
const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

test("each spell's school, ritual, concentration and casting time come from the bundled facts", () => {
  const fireball = filters.spellDeskFacts({ name: "Fireball" });
  assert.equal(fireball.school, "evocation");
  assert.equal(fireball.ritual, false);
  assert.equal(fireball.concentration, false);
  assert.equal(fireball.castingTime, "action");
  const detect = filters.spellDeskFacts({ name: "Detect Magic" });
  assert.equal(detect.ritual, true);
  assert.equal(detect.concentration, true);
  assert.equal(filters.spellDeskFacts({ name: "Shield" }).castingTime, "reaction");
  assert.equal(filters.spellDeskFacts({ name: "Misty Step" }).castingTime, "bonus");
  assert.equal(filters.spellDeskFacts({ name: "Identify" }).castingTime, "longer");
});

test("a tile's own row wins over the bundled facts", () => {
  const facts = filters.spellDeskFacts({
    name: "Fireball",
    data: { school: { name: "Necromancy" }, ritual: "yes", duration: "Concentration, up to 1 minute", casting_time: "1 bonus action" },
  });
  assert.deepEqual(facts, { school: "necromancy", ritual: true, concentration: true, castingTime: "bonus" });
  assert.equal(filters.spellDeskFacts({ name: "Fireball", concentration: true }).concentration, true);
});

test("the filters keep only what they ask for", () => {
  const facts = filters.spellDeskFacts({ name: "Detect Magic" });
  const none = filters.NO_SPELL_FILTER;
  assert.equal(filters.spellFilterActive(none), false);
  assert.equal(filters.matchesSpellFilter(facts, none), true);
  assert.equal(filters.matchesSpellFilter(facts, { ...none, ritual: true }), true);
  assert.equal(filters.matchesSpellFilter(facts, { ...none, concentration: "no" }), false);
  assert.equal(filters.matchesSpellFilter(facts, { ...none, concentration: "yes" }), true);
  assert.equal(filters.matchesSpellFilter(facts, { ...none, school: "evocation" }), false);
  assert.equal(filters.matchesSpellFilter(facts, { ...none, castingTime: "action" }), true);
  assert.equal(filters.matchesSpellFilter(filters.spellDeskFacts({ name: "Fireball" }), { ...none, ritual: true }), false);
  assert.equal(filters.spellFilterWords({ ...none, school: "evocation", ritual: true, concentration: "no" }), "evocation, ritual, no concentration");
});

test("only the values some spell on the page has are offered", () => {
  const options = filters.spellFilterOptions(["Fireball", "Shield", "Detect Magic"].map((name) => filters.spellDeskFacts({ name })));
  assert.deepEqual(options.schools, ["abjuration", "divination", "evocation"]);
  assert.deepEqual(options.castingTimes, ["action", "reaction"]);
  assert.equal(options.anyRitual, true);
  assert.equal(options.anyConcentration, true);
});

const tiles = [
  { name: "Magic Missile", level: 1, state: "ready" },
  { name: "Shield", level: 1, state: "available" },
  { name: "Detect Magic", level: 1, state: "available" },
];

test("the builder's book draws the filters as labelled native controls; the sheet's does not", () => {
  const markup = renderToStaticMarkup(createElement(SpellBook, { tiles, maxLevel: 1, onTile() {}, filters: true }));
  assert.ok(markup.includes('role="group" aria-label="Filter spells"'), "no labelled filter group");
  for (const label of ["School", "Casting time", "Concentration", "Rituals only"]) {
    assert.ok(new RegExp(`<label[^>]*>${label}<(select|/label)|<label[^>]*><input type="checkbox"[^>]*/>${label}</label>`).test(markup), `${label} is not a labelled control`);
  }
  assert.ok(!markup.includes("Clear filters"), "Clear filters shows with nothing to clear");
  const sheet = renderToStaticMarkup(createElement(SpellBook, { tiles, maxLevel: 1, onTile() {} }));
  assert.ok(!sheet.includes("Filter spells"), "the sheet grew the builder's filters");
  assert.ok(sheet.includes('aria-label="Find a spell"'), "the search box went");
});

test("a prompt from the picker is drawn above the tiles, and each tile names its spell", () => {
  const markup = renderToStaticMarkup(
    createElement(SpellBook, { tiles, maxLevel: 1, onTile() {}, prompt: createElement("div", { "data-probe": "" }) }),
  );
  assert.ok(markup.indexOf("data-probe") < markup.indexOf('data-spell="Magic Missile"'), "the prompt is not above the tiles");
});

test("the prepared cap is said as its sum", () => {
  assert.equal(preparedCapLine("Wizard", { ability: "int", mod: 3, level: 3, levelPart: 3 }, 6), "Wizard level 3 + INT +3 = 6");
  assert.equal(
    preparedCapLine("Paladin", { ability: "cha", mod: 3, level: 5, levelPart: 2 }, 5),
    "Paladin level 5, halved (2) + CHA +3 = 5",
  );
  assert.equal(preparedCapLine("Wizard", { ability: "int", mod: -1, level: 1, levelPart: 1 }, 1), "Wizard level 1 + INT -1 = 1 (never fewer than 1)");
});

test("a wizard's advice carries the parts of its sum", () => {
  const klass = { id: "wizard", spellAbility: "int", casterType: "full" };
  const abilities = { str: 8, dex: 14, con: 12, int: 16, wis: 10, cha: 10 };
  const advice = builderSpellAdvice(builderCasting(klass, "", 3), klass, "", 3, abilities);
  assert.equal(advice.count, 6);
  assert.deepEqual(advice.sum, { ability: "int", mod: 3, level: 3, levelPart: 3 });
  assert.equal(preparedCapLine("Wizard", advice.sum, advice.count), "Wizard level 3 + INT +3 = 6");
});

test("each cap the step holds says its working", () => {
  const lines = desk.capLines({
    className: "Wizard",
    level: 3,
    cantripCap: 3,
    spellbookCap: 10,
    spellCap: { label: "spells prepared", count: 6, sum: { ability: "int", mod: 3, level: 3, levelPart: 3 } },
    known: false,
  });
  assert.deepEqual(
    lines.map((line) => `${line.label}: ${line.line}`),
    ["Cantrips: 3, from the Wizard table at level 3", "Spellbook: 6 at level 1 + 2 a level after = 10", "Prepared: Wizard level 3 + INT +3 = 6"],
  );
  const bard = desk.capLines({ className: "Bard", level: 2, cantripCap: 2, spellbookCap: null, spellCap: { label: "spells known", count: 5 }, known: true });
  assert.equal(bard.at(-1).line, "5, from the Bard table at level 2");
  assert.equal(bard.at(-1).label, "Known");
});

test("the casting numbers are the sheet's, slots in order", () => {
  const numbers = desk.castingNumbers({ spellSaveDc: 13, spellAttack: 5, spellSlots: { 2: { max: 2 }, 1: { max: 4 }, 3: { max: 0 } } });
  assert.equal(numbers.dc, "13");
  assert.equal(numbers.attack, "+5");
  assert.deepEqual(numbers.slots.map((slot) => `${slot.label} ${slot.max}`), ["1st 4", "2nd 2"]);
  assert.deepEqual(desk.castingNumbers({ spellSaveDc: null, spellAttack: undefined, spellSlots: {} }), { dc: null, attack: null, slots: [] });
});

test("a swap trades one spell for another where it stood, and never a granted one", () => {
  assert.deepEqual(desk.swapInList(["Magic Missile", "Shield", "Sleep"], "shield", "Mage Armor"), ["Magic Missile", "Mage Armor", "Sleep"]);
  assert.deepEqual(desk.swapCandidates(["Bless", "Cure Wounds", "Shield of Faith"], (name) => name === "Bless"), ["Cure Wounds", "Shield of Faith"]);
  assert.equal(desk.swapQuestion({ kind: "prepared", name: "Sleep" }, "Prepared list full"), "Prepared list full. Swap Sleep in for:");
});

test("the step offers a swap on each full list, shows the desk and keeps the fill and limit notes", () => {
  const step = read("src/app/characters/builder/steps/SpellsGearStep.tsx");
  for (const kind of ["cantrip", "spell", "prepared"]) {
    assert.ok(step.includes(`if (offerSwap("${kind}", name)) {`), `a full ${kind} list does not offer a swap`);
  }
  assert.match(step, /role="group"\s+aria-label=\{question\}/, "the swap question is not a labelled group");
  assert.match(step, /event\.key === "Escape"/, "Escape does not call off the swap");
  assert.match(step, /swapFrom\.current\?\.focus\(\)/, "calling off the swap drops focus");
  assert.match(step, /<SpellDeskHeader/, "the desk header is not drawn");
  assert.match(step, /\n\s+filters\n/, "the step's book has no filters");
  assert.match(step, /const fill = fillSpells\(/, "the suggested fill went");
  assert.equal((step.match(/\$\{limitWhy\}/g) ?? []).length, 2, "a refusal lost its working");
  assert.match(step, /data-casting-numbers/);
  assert.match(step, /data-chosen-spells/);
});

console.log(`\n${passed} spell desk checks passed`);
