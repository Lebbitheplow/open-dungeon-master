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
const { thirdCasterSchoolProblem } = await import("../src/lib/srd/third-caster.ts");
const { bundledSpellSchool } = await import("../src/lib/srd/spell-facts.ts");
const { escapeIsOwned, OWNS_ESCAPE } = await import("../src/lib/owned-escape.ts");

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
  assert.equal(filters.spellFilterWords({ ...none, school: "evocation", ritual: true, concentration: "no" }), "Evocation, ritual, no concentration");
});

test("a school is written capitalised in code, not left to CSS a native list never sees", () => {
  assert.equal(filters.schoolLabel("evocation"), "Evocation");
  assert.equal(filters.schoolLabel("conjuration"), "Conjuration");
  const pickers = filters.spellFilterPickers(filters.spellFilterOptions(["Fireball", "Shield", "Detect Magic"].map((name) => filters.spellDeskFacts({ name }))));
  const school = pickers.find((picker) => picker.key === "school");
  assert.deepEqual(
    school.options.map((option) => option.label),
    ["School: any", "School: Abjuration", "School: Divination", "School: Evocation"],
  );
  assert.deepEqual(pickers.find((picker) => picker.key === "castingTime").options.map((option) => option.value), ["any", "action", "reaction"]);
  assert.deepEqual(pickers.find((picker) => picker.key === "concentration").options.map((option) => option.label), [
    "Concentration: any",
    "Concentration: needs it",
    "Concentration: not needed",
  ]);
  // One school or one casting time on the page narrows nothing: no picker.
  const lone = filters.spellFilterPickers(filters.spellFilterOptions([filters.spellDeskFacts({ name: "Fireball" })]));
  assert.deepEqual(lone.map((picker) => picker.key), []);
  assert.deepEqual(filters.withSpellFilterPick(filters.NO_SPELL_FILTER, "castingTime", "reaction").castingTime, "reaction");
  assert.deepEqual(filters.withSpellFilterPick({ ...filters.NO_SPELL_FILTER, school: "evocation" }, "school", "any"), filters.NO_SPELL_FILTER);
});

test("a filter value the page no longer offers is dropped, never on behind an 'any' or a missing picker", () => {
  const facts = (names) => filters.spellFilterOptions(names.map((name) => filters.spellDeskFacts({ name })));
  const chosen = { school: "abjuration", castingTime: "reaction", concentration: "yes", ritual: true };
  // A wizard's whole list: every value is on offer, so the filter stands.
  const all = facts(["Fireball", "Shield", "Detect Magic", "Identify"]);
  assert.deepEqual(filters.liveSpellFilter(chosen, all), chosen);
  // Preparing from a book with no reaction spell and no abjuration: those
  // two go; concentration and ritual stay while some spell has them.
  const book = facts(["Fireball", "Detect Magic", "Identify"]);
  assert.deepEqual(filters.liveSpellFilter(chosen, book), { school: "", castingTime: "", concentration: "yes", ritual: true });
  // A page with one school only draws no school picker, so none is held.
  assert.equal(filters.liveSpellFilter({ ...chosen, school: "evocation" }, facts(["Fireball", "Magic Missile"])).school, "");
  // No ritual and no concentration on the page: both are dropped.
  assert.deepEqual(filters.liveSpellFilter(chosen, facts(["Fireball", "Shield"])), { school: "abjuration", castingTime: "reaction", concentration: "", ritual: false });
  assert.equal(filters.sameSpellFilter(chosen, { ...chosen }), true);
  assert.equal(filters.sameSpellFilter(chosen, { ...chosen, ritual: false }), false);
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

test("the builder's book draws the filters as the kit's pickers and a finger-sized checkbox; the sheet's does not", () => {
  const markup = renderToStaticMarkup(createElement(SpellBook, { tiles, maxLevel: 1, onTile() {}, filters: true }));
  assert.ok(markup.includes('role="group" aria-label="Filter spells"'), "no labelled filter group");
  // The kit's Select, as the builder's class and lineage filters and its
  // level picker use: 40 px under a finger (kit-select-sm), named by what
  // it shows.
  for (const label of ["School: any", "Casting time: any", "Concentration: any"]) {
    assert.ok(new RegExp(`<button type="button" aria-label="${label}"[^>]*class="kit-select kit-select-sm"`).test(markup), `${label} is not the kit's picker`);
    assert.ok(markup.includes(`>${label}</span>`), `${label} does not show its choice`);
  }
  assert.ok(!markup.includes("<select"), "a native select is back");
  assert.ok(!markup.includes("capitalize"), "a school is capitalised by CSS");
  assert.ok(/<label class="pk-tap [^"]*"><input type="checkbox"[^>]*\/>Rituals only<\/label>/.test(markup), "Rituals only is not a finger-sized label");
  assert.ok(!markup.includes("Clear filters"), "Clear filters shows with nothing to clear");
  const book = read("src/components/sheet/SpellBook.tsx");
  assert.match(book, /className=\{cn\(ui\.btnSmall, "pk-tap"\)\}>\s*Clear filters/, "Clear filters is not a finger-sized kit button");
  assert.match(book, /const live = liveSpellFilter\(desk, options\);/, "the book filters by values the page no longer offers");
  assert.match(book, /matchesSpellFilter\([^\n]*, live\)/, "the tiles are matched against the stale filter");
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

// An Eldritch Knight at 3rd level: abjuration and evocation, and one spell
// from any school (src/lib/srd/third-caster.ts), judged as the step does.
const knight = (list) => (into, out) =>
  thirdCasterSchoolProblem({
    classId: "fighter",
    subclass: "Eldritch Knight",
    level: 3,
    spells: [...list.filter((name) => name !== out), into].map((name) => ({ name, school: bundledSpellSchool(name) })),
  });

test("a third caster is offered only the spells whose leaving lets the new one in", () => {
  const list = ["Shield", "Magic Missile", "Find Familiar"];
  // Find Familiar holds the one pick from any school: only it can make room
  // for Silent Image; Shield or Magic Missile going would leave two outside.
  const offSchool = desk.swapChoices({ list, into: "Silent Image", locked: () => false, problem: knight(list) });
  assert.deepEqual(offSchool, { candidates: ["Find Familiar"], ruledOut: false });
  // An evocation spell may take any of the three places.
  const inSchool = desk.swapChoices({ list, into: "Burning Hands", locked: () => false, problem: knight(list) });
  assert.deepEqual(inSchool.candidates, list);
  // The one spell that could go is not the player's to trade: the rule, not
  // the count, is what refuses, and the step says the rule.
  const held = desk.swapChoices({ list, into: "Silent Image", locked: (name) => name === "Find Familiar", problem: knight(list) });
  assert.deepEqual(held, { candidates: [], ruledOut: true });
  // Nothing of the player's to trade at all: the count refuses, as before.
  assert.deepEqual(desk.swapChoices({ list, into: "Silent Image", locked: () => true, problem: knight(list) }), { candidates: [], ruledOut: false });
  // No rule (every other caster): every pick of the player's may go.
  assert.deepEqual(desk.swapChoices({ list, into: "Silent Image", locked: () => false }).candidates, list);
});

test("Escape on the swap question is the question's, inside a dialog around the builder too", () => {
  const saved = globalThis.Element;
  class FakeElement {
    constructor(owned) {
      this.owned = owned;
    }
    closest(selector) {
      return selector === `[${OWNS_ESCAPE}]` && this.owned ? this : null;
    }
  }
  globalThis.Element = FakeElement;
  try {
    assert.equal(escapeIsOwned(new FakeElement(true)), true);
    assert.equal(escapeIsOwned(new FakeElement(false)), false);
    assert.equal(escapeIsOwned(null), false);
  } finally {
    globalThis.Element = saved;
  }
  const step = read("src/app/characters/builder/steps/SpellsGearStep.tsx");
  assert.match(step, /data-spell-swap=""\s+\{\.\.\.\{ \[OWNS_ESCAPE\]: "" \}\}/, "the swap question does not keep its Escape");
  const dialog = read("src/app/campaigns/[campaignId]/CompanionBuilderDialog.tsx");
  assert.match(
    dialog,
    /onEscapeKeyDown=\{\(event\) => \{\s+if \(escapeIsOwned\(event\.target\)\) \{\s+event\.preventDefault\(\);/,
    "the companion builder's dialog closes on the swap question's Escape",
  );
});

test("the swap question and its buttons read in the day theme and are finger-sized", () => {
  const step = read("src/app/characters/builder/steps/SpellsGearStep.tsx");
  const prompt = step.slice(step.indexOf("function SwapPrompt("));
  // The day theme turns stone and amber to ink on cream; sky it leaves pale.
  assert.ok(!/sky-/.test(prompt), "the swap question uses a colour the day theme leaves pale");
  assert.equal((prompt.match(/className=\{cn\(ui\.btnSmall, "pk-tap[^"]*"\)\}/g) ?? []).length, 2, "a swap button is not a finger-sized kit button");
});

test("the step offers a swap on each full list, shows the desk and keeps the fill and limit notes", () => {
  const step = read("src/app/characters/builder/steps/SpellsGearStep.tsx");
  for (const kind of ["cantrip", "spell", "prepared"]) {
    assert.ok(step.includes(`if (offerSwap("${kind}", name)) {`), `a full ${kind} list does not offer a swap`);
  }
  assert.match(step, /role="group"\s+aria-label=\{question\}/, "the swap question is not a labelled group");
  assert.match(step, /event\.key === "Escape"/, "Escape does not call off the swap");
  // Focus goes back to the tile by its spell: a tap on a phone never
  // focused the tile, so whatever held focus then is no way back.
  assert.match(step, /function cancelSwap\(\) \{\s+if \(swap\) \{\s+focusTile\(swap\.name\);/, "calling off the swap does not focus the tile by name");
  assert.ok(!step.includes("document.activeElement"), "the swap remembers focus instead of the tile");
  // A third caster's swap is offered only where the two schools allow it.
  assert.match(step, /problem: listRule\.third \? offSchool : undefined/, "the school rule does not narrow the swap");
  assert.match(step, /ruledOut \? "Outside your two schools" : listFullText/, "a tile the schools rule out still offers a swap");
  assert.match(step, /<SpellDeskHeader/, "the desk header is not drawn");
  assert.match(step, /\n\s+filters\n/, "the step's book has no filters");
  assert.match(step, /const fill = fillSpells\(/, "the suggested fill went");
  assert.equal((step.match(/\$\{limitWhy\}/g) ?? []).length, 2, "a refusal lost its working");
  assert.match(step, /data-casting-numbers/);
  assert.match(step, /data-chosen-spells/);
});

console.log(`\n${passed} spell desk checks passed`);
