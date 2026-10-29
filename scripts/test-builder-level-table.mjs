// Backlog F8: the level progression table. One row per level from 1 to the
// character's level, each saying what the level grants (proficiency bonus,
// features, the subclass pick, an Ability Score Improvement or feat, spell
// slots and the spells known or prepared), with the pick made there inline
// (src/app/characters/builder/levelProgression.ts). It is a real <table>
// with headers, inside a box of its own that scrolls sideways on a phone
// (LevelProgressionTable.tsx), and it shows on the builder's summary
// (steps/FinishStep.tsx) and in the library's level-up sheet
// (LevelUpSheet.tsx), with the level held now and the next one marked.
import assert from "node:assert/strict";
import fs from "node:fs";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { createElement } = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");
const { levelProgressionRows, progressionColumns, improvementWords, slotWords } = await import(
  "../src/app/characters/builder/levelProgression.ts"
);
const { LevelProgressionTable, builderProgressionInput } = await import(
  "../src/app/characters/builder/LevelProgressionTable.tsx"
);

// Windows CI checks out with CRLF.
const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

let passed = 0;
async function test(name, fn) {
  await fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

const brann = {
  classId: "fighter",
  subclass: "Champion",
  level: 11,
  baseAbilities: { str: 16, dex: 12, con: 15, int: 10, wis: 12, cha: 9 },
  asiSlotLevels: [4, 6, 8],
  asiChoices: [{ mode: "plus2", ability: "str" }, null, { mode: "feat", feat: "Alert" }],
  asiTakenInPlay: [false, false, false],
  styles: ["Defense", "Dueling"],
  current: 10,
  next: 11,
};

await test("A row per level from 1 to the character's, with the proficiency bonus the level gives", () => {
  const rows = levelProgressionRows(brann);
  assert.deepEqual(rows.map((row) => row.level), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  assert.deepEqual(rows.map((row) => row.proficiency), [2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4]);
});

await test("Features land on the level that grants them, the subclass's with the class's", () => {
  const rows = levelProgressionRows(brann);
  assert.ok(rows[0].features.some((name) => name.startsWith("Second Wind")));
  assert.ok(rows[2].features.includes("Improved Critical"), "the Champion's 3rd-level feature");
  assert.ok(rows[4].features.includes("Extra Attack"));
  assert.deepEqual(rows[3].features, [], "level 4 grants only its improvement");
});

await test("A fighting style slot carries the style picked for it, in the order the slots come", () => {
  const rows = levelProgressionRows(brann);
  assert.ok(rows[0].features.includes("Fighting Style (Defense)"), rows[0].features.join(", "));
  assert.ok(rows[9].features.includes("Additional Fighting Style (Dueling)"), rows[9].features.join(", "));
  const unpicked = levelProgressionRows({ ...brann, styles: [] });
  assert.ok(unpicked[0].features.includes("Fighting Style"));
});

await test("The subclass row names the pick, or says it is still to choose", () => {
  const rows = levelProgressionRows(brann);
  assert.deepEqual(rows[2].subclass, { pick: "Champion" });
  assert.equal(rows[1].subclass, null);
  assert.deepEqual(levelProgressionRows({ ...brann, subclass: "" })[2].subclass, { pick: null });
});

await test("Each improvement slot shows its pick in words, an open one as open and one taken in play as such", () => {
  const rows = levelProgressionRows({ ...brann, asiTakenInPlay: [false, true, false] });
  assert.deepEqual(rows[3].improvement, { pick: "+2 Strength", takenInPlay: false });
  assert.deepEqual(rows[5].improvement, { pick: null, takenInPlay: true });
  assert.deepEqual(rows[7].improvement, { pick: "Feat: Alert", takenInPlay: false });
  assert.equal(rows[4].improvement, null);
  assert.equal(levelProgressionRows(brann)[5].improvement.takenInPlay, false, "an open slot not taken in play stays open");
  assert.equal(improvementWords({ mode: "plus1x2", abilities: ["str", "con"] }), "+1 Strength, +1 Constitution");
  assert.equal(improvementWords({ mode: "feat", feat: "Resilient", ability: "con" }), "Feat: Resilient (+1 Constitution)");
});

await test("The level held now and the one being taken are marked", () => {
  const rows = levelProgressionRows(brann);
  assert.equal(rows[9].mark, "current");
  assert.equal(rows[10].mark, "next");
  assert.equal(rows.filter((row) => row.mark).length, 2);
  assert.ok(levelProgressionRows({ ...brann, current: undefined, next: undefined }).every((row) => row.mark === null));
});

await test("A non-caster has no spell columns; a caster's slots and counts follow the class tables", () => {
  assert.deepEqual(progressionColumns(levelProgressionRows(brann)), { subclass: true, casting: false, classes: false });
  const wizard = levelProgressionRows({
    classId: "wizard",
    subclass: "",
    level: 3,
    baseAbilities: { str: 8, dex: 14, con: 13, int: 16, wis: 12, cha: 10 },
    asiSlotLevels: [],
    asiChoices: [],
  });
  assert.deepEqual(progressionColumns(wizard), { subclass: true, casting: true, classes: false });
  assert.equal(slotWords(wizard[0].slots), "1st 2");
  assert.equal(slotWords(wizard[2].slots), "1st 4, 2nd 2");
  assert.equal(wizard[0].cantrips, 3);
  // A wizard prepares Intelligence modifier plus level, and keeps a book.
  assert.equal(wizard[2].spells.count, 6);
  assert.equal(wizard[2].spells.spellbook, 10);
});

await test("A prepared caster's count reads the casting score as it stood at each level", () => {
  const cleric = levelProgressionRows({
    classId: "cleric",
    subclass: "Life Domain",
    level: 5,
    baseAbilities: { str: 14, dex: 10, con: 14, int: 8, wis: 15, cha: 12 },
    asiSlotLevels: [4],
    asiChoices: [{ mode: "plus1x2", abilities: ["wis", "con"] }],
  });
  // Wisdom 15 (+2) before level 4, 16 (+3) from it.
  assert.equal(cleric[2].spells.count, 5);
  assert.equal(cleric[3].spells.count, 7);
  assert.equal(cleric[4].spells.count, 8);
});

await test("A paladin casts nothing at level 1, so that row has no slots", () => {
  const rows = levelProgressionRows({ classId: "paladin", subclass: "", level: 2, baseAbilities: null, asiSlotLevels: [], asiChoices: [] });
  assert.deepEqual(rows[0].slots, []);
  assert.equal(rows[0].spells, null);
  assert.equal(slotWords(rows[1].slots), "1st 2");
});

await test("The table renders as a <table> with column and row headers, inside its own scrolling box", () => {
  const markup = renderToStaticMarkup(
    createElement(LevelProgressionTable, { rows: levelProgressionRows(brann), who: "Brann" }),
  );
  assert.match(markup, /<table[^>]*data-level-table/);
  assert.match(markup, /<caption[^>]*>Brann&#x27;s levels, 1 to 11<\/caption>/);
  assert.equal((markup.match(/<th scope="col"/g) ?? []).length, 5, "Level, proficiency, features, subclass, improvement");
  assert.equal((markup.match(/<th scope="row"/g) ?? []).length, 11);
  // The box scrolls, never the page, and the keyboard can scroll it.
  assert.match(markup, /role="region"[^>]*tabindex="0"[^>]*data-level-table-scroll=""[^>]*overflow-x-auto/);
  // Positioned, so the screen-reader-only words in its cells (absolute) are
  // held inside the box: without it they widened the page on a phone.
  assert.match(markup, /data-level-table-scroll=""[^>]*class="relative /);
  assert.match(markup, /min-w-\[36rem\]/);
  // The marks are said in words, never by colour alone.
  assert.match(markup, /data-level-row="10" data-mark="current" aria-current="true"/);
  assert.match(markup, /data-level-row="11" data-mark="next"/);
  assert.match(markup, />New</);
  assert.match(markup, />Now</);
  assert.match(markup, /Feat: Alert/);
  assert.match(markup, /Still to choose/, "the open level 6 improvement");
  // Folded until asked for, by a named toggle that says it is folded.
  assert.match(markup, /<button type="button" aria-expanded="false" aria-controls="[^"]+" data-level-table-toggle=""[^>]*min-h-10/);
  assert.match(markup, />Show each level</);
  assert.match(markup, /hidden=""[^>]*role="region"/);
  const open = renderToStaticMarkup(
    createElement(LevelProgressionTable, { rows: levelProgressionRows(brann), who: "Brann", defaultOpen: true }),
  );
  assert.doesNotMatch(open, /hidden=""[^>]*role="region"/);
  // The sticky level column takes the theme's ramps, so it reads by day too.
  assert.doesNotMatch(read("src/app/characters/builder/LevelProgressionTable.tsx"), /bg-\[#/);
});

await test("The builder's input carries its improvement cards, subclass and style names", () => {
  const input = builderProgressionInput(
    { subclass: "Champion", stylePicks: ["defense", "dueling", "archery"] },
    {
      effectiveLevel: 10,
      asiBaseAbilities: brann.baseAbilities,
      asiSlotLevels: [4, 6, 8],
      activeAsiChoices: brann.asiChoices,
      asiTakenInPlay: [false, false, false],
      styleSlots: 2,
    },
    { id: "fighter" },
    { current: 9, next: 10 },
  );
  assert.deepEqual(input.styles, ["Defense", "Dueling"], "only as many styles as the slots hold");
  assert.equal(input.level, 10);
  assert.equal(input.next, 10);
});

await test("The builder's summary shows the table under the summary rows and the numbers", () => {
  const finish = read("src/app/characters/builder/steps/FinishStep.tsx");
  const summaryAt = finish.indexOf("<SummaryPanel rows={summary}");
  const tableAt = finish.indexOf("<BuilderLevelTable state={state} derived={derived} klass={klass} />");
  assert.ok(summaryAt > 0 && tableAt > summaryAt, "the table follows the summary");
  assert.ok(tableAt > finish.indexOf('title="Derived stats"'), "and the derived stats, so it never stands before them");
  assert.match(read("src/app/characters/builder/LevelProgressionTable.tsx"), /derived\.effectiveLevel <= 1/, "a first-level build has no table");
});

console.log(`\n${passed} passed`);
