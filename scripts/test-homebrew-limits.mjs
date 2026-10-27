// What a homebrew entry holds more of than it keeps (src/lib/homebrew/
// limits.ts): a class's ninth feature at a level, a subclass's seventh
// always-prepared spell, a species's seventh skill, a kit's eighty-first
// line. The normalizers used to cut each without a word, so a save quietly
// lost what its author wrote; now each is named by its field, the editor
// says so before the save, and the routes refuse it. A spell is named whole
// wherever it is cast from, up to the 80 letters its own name keeps.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { featureCounts, homebrewLimitProblems } = await import("../src/lib/homebrew/limits.ts");
const { normalizeHomebrewData } = await import("../src/lib/homebrew/gear.ts");
const { checkMonsterDraft } = await import("../src/lib/bestiary/monster-draft.ts");
const { draftFindings } = await import("../src/app/workshop/homebrew/draft.ts");
const { blankClassData } = await import("../src/lib/homebrew/class-data.ts");
const { ALL_CLASSES } = await import("../src/lib/srd/index.ts");
const { bundledClassTable } = await import("../src/lib/workshop/class-catalog.ts");
const { archetypeMechanicsOf } = await import("../src/lib/workshop/catalog-mechanics.ts");
const { classFeatureCatalog } = await import("../src/lib/workshop/class-feature-catalog.ts");
const { FEATURE_CLASSES, subclassFeatureCatalog } = await import("../src/lib/workshop/feature-catalog.ts");
const { subclassNamesFor } = await import("../src/lib/srd/features.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

const features = (count, prefix = "Feature") => Array.from({ length: count }, (_, at) => ({ n: `${prefix} ${at + 1}`, d: "Words." }));
const spells = (count) => Array.from({ length: count }, (_, at) => `Spell ${at + 1}`);
const classWith = (patch) => ({ ...blankClassData(), ...patch });

test("nine features at one level of a class are named, not shortened; eight are kept", () => {
  const nine = homebrewLimitProblems("class", classWith({ levels: { 3: features(9) } }));
  assert.equal(nine.length, 1);
  assert.equal(nine[0].field, "levels.3");
  assert.match(nine[0].text, /Level 3 has 9 features/);
  assert.deepEqual(homebrewLimitProblems("class", classWith({ levels: { 3: features(8) } })), []);
});

test('"3" and "3.0" are one level, and a feature with no name is not one', () => {
  const levels = { 3: features(5), "3.0": features(4, "Other"), 4: [...features(8), { n: "  ", d: "x" }] };
  assert.deepEqual([...featureCounts(levels)].sort(), [[3, 9], [4, 8]]);
  assert.deepEqual(homebrewLimitProblems("class", classWith({ levels })).map((problem) => problem.field), ["levels.3"]);
});

test("a subclass with nine features and seven spells at level 3 has both named", () => {
  const problems = homebrewLimitProblems("archetype", { classSlug: "fighter", levels: { 3: features(9) }, spells: { 3: spells(7) } });
  assert.deepEqual(problems.map((problem) => problem.field), ["levels.3", "spells.3"]);
  assert.match(problems[1].text, /Level 3 has 7 always-prepared spells/);
});

test("a class's ninth tool, a species's and a background's seventh skill and a kit's 81st line are each named", () => {
  const tools = homebrewLimitProblems("class", classWith({ tools: Array.from({ length: 9 }, (_, at) => `Tool ${at}`) }));
  assert.deepEqual(tools.map((problem) => problem.field), ["tools"]);
  const weapons = homebrewLimitProblems("class", classWith({ weapons: Array.from({ length: 25 }, (_, at) => `weapon ${at}`) }));
  assert.match(weapons[0].text, /tick simple or martial/);
  const skills = ["acrobatics", "arcana", "athletics", "deception", "history", "insight", "stealth"];
  assert.deepEqual(homebrewLimitProblems("race", { skills }).map((problem) => problem.field), ["skills"]);
  assert.deepEqual(homebrewLimitProblems("background", { grants: { skills } }).map((problem) => problem.field), ["grants.skills"]);
  const kit = Array.from({ length: 81 }, () => "Torch");
  assert.deepEqual(homebrewLimitProblems("background", { grants: { skills: [], equipment: kit } }).map((problem) => problem.field), ["grants.equipment"]);
  assert.deepEqual(homebrewLimitProblems("background", { grants: { skills: skills.slice(0, 6), equipment: kit.slice(0, 80) } }), []);
});

test("species traits and a description longer than they keep are named", () => {
  assert.deepEqual(homebrewLimitProblems("race", { traits: "x".repeat(6_001) }).map((problem) => problem.field), ["traits"]);
  const long = homebrewLimitProblems("item", { desc: "x".repeat(20_214) });
  assert.equal(long[0].field, "desc");
  assert.match(long[0].text, /20,214 characters/);
  // The longest published entry, the Figurine of Wondrous Power at 15,816, fits.
  assert.deepEqual(homebrewLimitProblems("item", { desc: "x".repeat(15_816) }), []);
});

test("a 75-letter spell name stays whole on a subclass, an item and a monster", () => {
  const name = `${"Ember".repeat(14)} Bolt`;
  assert.equal(name.length, 75);
  assert.deepEqual(homebrewLimitProblems("archetype", { classSlug: "cleric", levels: {}, spells: { 1: [name] } }), []);
  const subclass = normalizeHomebrewData("archetype", { classSlug: "cleric", levels: {}, spells: { 1: [name] } }, "Domain");
  assert.deepEqual(subclass.data.spells, { 1: [name] });
  const item = normalizeHomebrewData("item", { desc: "A wand.", itemKind: "magic_item", rarity: "rare", spells: [{ spell: name, charges: 1, level: 1 }] }, "Wand");
  assert.ok("data" in item, JSON.stringify(item));
  assert.equal(item.data.spells[0].spell, name);
  const monster = checkMonsterDraft({ name: "Hexer", ac: 12, maxHp: 20, cr: 1, attacks: [{ name: "Claw", toHit: 3, damage: "1d6+1", damageType: "slashing" }], spells: [name] });
  assert.ok("draft" in monster, JSON.stringify(monster));
  assert.deepEqual(monster.draft.stats.spells, [name]);
  const over = homebrewLimitProblems("archetype", { classSlug: "cleric", levels: {}, spells: { 1: [`${name}${"s".repeat(6)}`] } });
  assert.deepEqual(over.map((problem) => problem.field), ["spells.1"]);
});

test("every published class and subclass table fits what an entry keeps", () => {
  const atLevel = new Map();
  for (const entry of [...classFeatureCatalog(), ...subclassFeatureCatalog()]) {
    const key = `${entry.classId}/${entry.subclass}`;
    const levels = atLevel.get(key) ?? {};
    (levels[entry.level] ??= []).push({ n: entry.name, d: entry.text });
    atLevel.set(key, levels);
  }
  assert.ok(atLevel.size > 12);
  for (const [key, levels] of atLevel) {
    for (const [level, count] of featureCounts(levels)) assert.ok(count <= 8, `${key} has ${count} features at ${level}`);
  }
  for (const klass of ALL_CLASSES) {
    const table = bundledClassTable(klass.id);
    if (table) assert.deepEqual(homebrewLimitProblems("class", table), [], klass.id);
  }
  for (const classId of FEATURE_CLASSES) {
    for (const subclass of subclassNamesFor(classId)) {
      const table = archetypeMechanicsOf({ name: subclass, source: "bundled", data: { desc: "" } }, classId);
      if (table) assert.deepEqual(homebrewLimitProblems("archetype", table), [], `${classId}/${subclass}`);
    }
  }
});

test("the editor refuses the nine-feature class before it is sent", () => {
  const findings = draftFindings({ kind: "class", name: "Spellblade", data: classWith({ levels: { 3: features(9) } }) }, {});
  const errors = findings.filter((finding) => finding.level === "error");
  assert.equal(errors.length, 1);
  assert.match(errors[0].text, /Level 3 has 9 features/);
  assert.ok(!draftFindings({ kind: "class", name: "Spellblade", data: classWith({ levels: { 3: features(8) } }) }, {}).some((finding) => finding.level === "error"));
});

console.log(`\ntest-homebrew-limits: ${passed} tests passed.`);
