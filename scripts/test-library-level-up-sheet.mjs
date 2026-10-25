// Backlog F7: "Level up" on a library character opens a sheet of only what
// the new level brings (hit points, new features, the subclass when due,
// the improvement or feat, class picks, new spells), with Choose for me
// filling the empty picks, instead of the whole builder one level up
// (src/app/characters/builder/LevelUpSheet.tsx, levelUpSections.ts). The
// sheet runs on the builder's own state and saves the sheet the builder
// would, through the same PATCH and rules check an edit uses. The clicks
// are walked in scripts/browser/scenarios/33-library-level-up.mjs.
import assert from "node:assert/strict";
import fs from "node:fs";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { levelProgressionRows } = await import("../src/app/characters/builder/levelProgression.ts");
const { levelUpSections, castingGrows, splitOwed, SHEET_TARGETS } = await import(
  "../src/app/characters/builder/levelUpSections.ts"
);

// Windows CI checks out with CRLF.
const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

let passed = 0;
async function test(name, fn) {
  await fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

const scores = { str: 16, dex: 12, con: 15, int: 10, wis: 14, cha: 9 };
function sections({ classId, subclass = "", storedSubclass = subclass, held, slots = [], owed = [], casts = false }) {
  const rows = levelProgressionRows({
    classId,
    subclass,
    level: held + 1,
    baseAbilities: scores,
    asiSlotLevels: slots,
    asiChoices: slots.map(() => null),
  });
  return levelUpSections({
    classId,
    subclass,
    storedSubclass,
    heldLevel: held,
    nextLevel: held + 1,
    asiSlotLevels: slots,
    casts,
    heldRow: rows[held - 1],
    nextRow: rows[held],
    owed: new Set(owed),
  });
}

await test("A fighter reaching 4 is asked for the improvement and nothing else", () => {
  assert.deepEqual(sections({ classId: "fighter", subclass: "Champion", held: 3, slots: [4], owed: ["asi"] }), {
    subclass: false,
    asi: true,
    classPicks: false,
    spells: false,
  });
});

await test("The improvement stays on the sheet once it is picked, so the choice can be changed", () => {
  assert.equal(sections({ classId: "fighter", subclass: "Champion", held: 3, slots: [4], owed: [] }).asi, true);
});

await test("A fighter reaching 3 chooses its subclass, and keeps the picker while choosing", () => {
  assert.equal(sections({ classId: "fighter", held: 2, owed: ["subclass"] }).subclass, true);
  assert.equal(sections({ classId: "fighter", subclass: "Champion", storedSubclass: "", held: 2 }).subclass, true);
  assert.equal(sections({ classId: "fighter", subclass: "Champion", held: 4 }).subclass, false, "a subclass held is not asked again");
});

await test("A level that adds a fighting style, or expertise, shows the class picks", () => {
  assert.equal(sections({ classId: "fighter", subclass: "Champion", held: 9 }).classPicks, true, "Champion's Additional Fighting Style at 10");
  assert.equal(sections({ classId: "rogue", held: 5 }).classPicks, true, "a rogue's second expertise at 6");
  assert.equal(sections({ classId: "rogue", held: 6 }).classPicks, false);
  assert.equal(sections({ classId: "warlock", held: 4, owed: ["options"] }).classPicks, true, "an invocation slot owed");
  // Read off the tables too, so the picker stays while the pick is made.
  assert.equal(sections({ classId: "warlock", held: 4 }).classPicks, true, "a warlock's third invocation at 5, already picked");
  assert.equal(sections({ classId: "sorcerer", held: 9 }).classPicks, true, "a sorcerer's third metamagic at 10, already picked");
  assert.equal(sections({ classId: "warlock", held: 5 }).classPicks, false, "no invocation at 6");
});

await test("The table reads a level with no spells yet as none, not as 0 spells known", () => {
  const rows = levelProgressionRows({ classId: "ranger", subclass: "", level: 2, baseAbilities: scores, asiSlotLevels: [], asiChoices: [] });
  assert.equal(rows[0].spells, null);
  assert.equal(rows[1].spells?.count, 2);
});

await test("A caster's spells show when the level changes what it holds, never for a level that changes nothing", () => {
  assert.equal(sections({ classId: "cleric", subclass: "Life Domain", held: 1, casts: true }).spells, true);
  assert.equal(sections({ classId: "wizard", held: 4, casts: true }).spells, true, "a wizard's book grows every level");
  assert.equal(sections({ classId: "fighter", subclass: "Champion", held: 3 }).spells, false);
  // A sorcerer 1 to 2 gains a spell known and slots.
  const rows = levelProgressionRows({ classId: "sorcerer", subclass: "", level: 2, baseAbilities: scores, asiSlotLevels: [], asiChoices: [] });
  assert.equal(castingGrows(rows[0], rows[1]), true);
  assert.equal(castingGrows(rows[1], rows[1]), false);
});

await test("The sheet keeps its own picks and sends the rest to the whole build", () => {
  const owed = [
    { target: "asi", label: "Ability score improvement", message: "Choose what your hero gains at level 4." },
    { target: "tools", label: "Tools", message: "Pick 1 more gaming set." },
  ];
  const split = splitOwed(owed);
  assert.deepEqual(split.here.map((pick) => pick.target), ["asi"]);
  assert.deepEqual(split.elsewhere.map((pick) => pick.target), ["tools"]);
  assert.deepEqual([...SHEET_TARGETS], ["subclass", "asi", "styles", "expertise", "options", "spells"]);
});

await test("Level up opens the sheet; Edit the whole build opens the full builder one level up", () => {
  const page = read("src/app/characters/[characterId]/edit/page.tsx");
  assert.ok(page.includes('const wholeBuild = search.get("whole") === "1";'));
  assert.ok(
    page.includes("const slimSheet = Boolean(nextLevel) && !wholeBuild && (character?.sheet.classes ?? []).length <= 1;"),
    "the sheet is for a single class, and not when the whole build was asked for",
  );
  assert.ok(page.includes("<LevelUpSheet"));
  assert.ok(page.includes("wholeBuildHref={`/characters/${characterId}/edit?levelUp=1&whole=1`}"));
  // Saved through the same handler, so the same PATCH and rules check.
  assert.match(page, /<LevelUpSheet[\s\S]*?onSubmit=\{\(result\) => void save\(result\)\}/);
  assert.match(page, /<CharacterBuilder[\s\S]*?startLevel=\{nextLevel \?\? undefined\}/, "the whole build still opens one level up");
});

await test("The sheet builds the result the builder would and fills only its own empty picks", () => {
  const sheet = read("src/app/characters/builder/LevelUpSheet.tsx");
  assert.ok(sheet.includes("useBuilderState({ initial, initialFeatDescs, initialLevel, startLevel: nextLevel, races, classes, backgrounds })"));
  assert.ok(sheet.includes("const check = validateBuilder(input);"));
  assert.ok(sheet.includes("onSubmit(buildBuilderResult(input));"));
  assert.ok(sheet.includes("fill.start({ only: [...SHEET_TARGETS] });"), "Choose for me runs the builder's fill on the sheet's picks");
  assert.ok(sheet.includes("Choose for me"));
  assert.ok(sheet.includes("Edit the whole build"));
  assert.ok(sheet.includes("<LevelProgressionTable rows={rows}"), "the level table, current and next marked");
  assert.ok(sheet.includes("{ current: initialLevel, next: nextLevel }"));
});

await test("The character page still offers Level up to a single class only", () => {
  const page = read("src/app/characters/[characterId]/page.tsx");
  assert.ok(page.includes("character.level < 20 && (character.sheet?.classes ?? []).length <= 1"));
  assert.ok(page.includes("href={`/characters/${characterId}/edit?levelUp=1`}"));
});

console.log(`\n${passed} passed`);
