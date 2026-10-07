// What a feat grants beyond its ability point, read from its text and
// applied to the sheet's training (src/lib/srd/feat-grants.ts, issue #125):
// Linguist's three languages, Heavily Armored's armor, Skill Expert's skill
// and expertise, Weapon Master's four weapons, Tavern Brawler's improvised
// weapons, Chef's cook's utensils.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { applyFeatGrants, featGrantSpec, featGrantsAnything, featPicksOwed, withoutFeatPicks } = await import("../src/lib/srd/feat-grants.ts");
const { authoredFeatDesc } = await import("../src/lib/srd/feat-effects.ts");
const authored = (await import("../src/lib/srd/authored-feats.json", { with: { type: "json" } })).default.feats;

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

const spec = (name) => featGrantSpec(authoredFeatDesc(name));
const base = { saves: ["str", "con"], skills: ["athletics", "perception"], expertise: [], languages: ["Common", "Elvish"], tools: [], armor: ["light", "medium", "shields"], weapons: ["simple", "martial"] };

test("the authored feats' grants are read from their text", () => {
  assert.equal(spec("Linguist").languages, 3);
  assert.equal(spec("Skill Expert").skills, 1);
  assert.equal(spec("Skill Expert").expertise, 1);
  assert.deepEqual(spec("Heavily Armored").armor, ["heavy"]);
  assert.deepEqual(spec("Moderately Armored").armor, ["medium", "shields"]);
  assert.deepEqual(spec("Lightly Armored").armor, ["light"]);
  assert.equal(spec("Weapon Master").weapons, 4);
  assert.deepEqual(spec("Tavern Brawler").fixedWeapons, ["improvised weapons"]);
  assert.deepEqual(spec("Chef").fixedTools, ["cook's utensils"]);
  assert.deepEqual(spec("Gunner").fixedWeapons, ["firearms"]);
  // Resilient's save and the half-feat points are another module's.
  assert.equal(featGrantsAnything(spec("Resilient")), false);
  assert.equal(featGrantsAnything(spec("Alert")), false);
  assert.equal(featGrantsAnything(spec("Tough")), false);
  // Every authored feat whose text names a grant of these kinds is read as one.
  const granting = authored.filter((feat) => /learn (one|two|three) languages|proficiency (in|with) (one|two|three|four) (skill|weapon)|expertise in one skill|proficiency with (light|medium|heavy) armor/i.test(feat.desc));
  for (const feat of granting) {
    assert.ok(featGrantsAnything(featGrantSpec(feat.desc)), `${feat.name} grants nothing: ${feat.desc}`);
  }
  assert.ok(granting.length >= 6, `only ${granting.length} granting feats found`);
});

test("a content pack's wording reads the same", () => {
  const skilled = featGrantSpec("You gain proficiency in any combination of three skills or tools of your choice.");
  assert.equal(skilled.skills, 3);
  const prodigy = featGrantSpec("You gain proficiency in one skill of your choice, proficiency with one tool of your choice, and fluency in one language of your choice. Choose one skill in which you have proficiency. You gain expertise with that skill.");
  assert.equal(prodigy.skills, 1);
  assert.equal(prodigy.tools, 1);
  assert.equal(prodigy.languages, 1);
  assert.equal(prodigy.expertise, 1);
  const artisan = featGrantSpec("You gain proficiency with one type of artisan's tools of your choice.");
  assert.equal(artisan.tools, 1);
  assert.ok(artisan.toolsFrom.includes("smith's tools") && !artisan.toolsFrom.includes("lute"));
});

test("what a feat still waits for is said in one sentence", () => {
  assert.equal(featPicksOwed("Linguist", spec("Linguist"), undefined), "Linguist: pick 3 languages.");
  assert.equal(featPicksOwed("Linguist", spec("Linguist"), { languages: ["Dwarvish", ""] }), "Linguist: pick 2 languages.");
  assert.equal(featPicksOwed("Linguist", spec("Linguist"), { languages: ["Dwarvish", "Giant", "Orc"] }), null);
  assert.equal(featPicksOwed("Skill Expert", spec("Skill Expert"), { skills: ["stealth"] }), "Skill Expert: pick expertise in 1 skill.");
  assert.equal(featPicksOwed("Heavily Armored", spec("Heavily Armored"), undefined), null);
});

test("the grants land on the sheet's training: fixed ones always, picks as recorded", () => {
  const feats = (...names) => names.map((name) => ({ name, desc: authoredFeatDesc(name) }));
  const linguist = applyFeatGrants({ proficiencies: base, feats: feats("Linguist"), choices: { linguist: { languages: ["Dwarvish", "Giant", "Orc"] } }, strict: true });
  assert.deepEqual(linguist.problems, []);
  assert.deepEqual(linguist.proficiencies.languages, ["Common", "Elvish", "Dwarvish", "Giant", "Orc"]);
  const armored = applyFeatGrants({ proficiencies: base, feats: feats("Heavily Armored", "Tavern Brawler", "Chef"), choices: {}, strict: true });
  assert.deepEqual(armored.problems, []);
  assert.deepEqual(armored.proficiencies.armor, ["light", "medium", "shields", "heavy"]);
  assert.deepEqual(armored.proficiencies.weapons, ["simple", "martial", "improvised weapons"]);
  assert.deepEqual(armored.proficiencies.tools, ["cook's utensils"]);
  const expert = applyFeatGrants({ proficiencies: base, feats: feats("Skill Expert"), choices: { "skill expert": { skills: ["stealth"], expertise: ["stealth"] } }, strict: true });
  assert.deepEqual(expert.problems, []);
  assert.deepEqual(expert.proficiencies.skills, ["athletics", "perception", "stealth"]);
  assert.deepEqual(expert.proficiencies.expertise, ["stealth"]);
  const master = applyFeatGrants({ proficiencies: base, feats: feats("Weapon Master"), choices: { "weapon master": { weapons: ["Longsword", "whip", "Net", "Blowgun"] } }, strict: true });
  assert.deepEqual(master.problems, []);
  assert.deepEqual(master.proficiencies.weapons, ["simple", "martial", "Longsword", "Whip", "Net", "Blowgun"]);
  // A feat with no text, or no grant, changes nothing.
  const quiet = applyFeatGrants({ proficiencies: base, feats: [{ name: "Alert", desc: authoredFeatDesc("Alert") }, { name: "Unknown Feat", desc: "" }], choices: {}, strict: true });
  assert.deepEqual(quiet.problems, []);
  assert.deepEqual(quiet.proficiencies, base);
});

test("held strictly, a pick is new to the character, one the feat offers, and all of them are made", () => {
  const feats = [{ name: "Linguist", desc: authoredFeatDesc("Linguist") }];
  const missing = applyFeatGrants({ proficiencies: base, feats, choices: {}, strict: true });
  assert.deepEqual(missing.problems, ["Linguist: pick 3 languages."]);
  assert.deepEqual(missing.proficiencies.languages, base.languages);
  const known = applyFeatGrants({ proficiencies: base, feats, choices: { linguist: { languages: ["Elvish", "Giant", "Orc"] } }, strict: true });
  assert.equal(known.problems.length, 1);
  assert.match(known.problems[0], /already speaks Elvish/);
  const expert = [{ name: "Skill Expert", desc: authoredFeatDesc("Skill Expert") }];
  const held = applyFeatGrants({ proficiencies: base, feats: expert, choices: { "skill expert": { skills: ["athletics"], expertise: ["athletics"] } }, strict: true });
  assert.match(held.problems[0], /already proficient in athletics/);
  const notSkill = applyFeatGrants({ proficiencies: base, feats: expert, choices: { "skill expert": { skills: ["juggling"], expertise: ["perception"] } }, strict: true });
  assert.match(notSkill.problems[0], /not a skill/);
  assert.deepEqual(notSkill.proficiencies.expertise, ["perception"]);
  const master = [{ name: "Weapon Master", desc: authoredFeatDesc("Weapon Master") }];
  const offTable = applyFeatGrants({ proficiencies: base, feats: master, choices: { "weapon master": { weapons: ["Lightsaber", "Longsword", "Whip", "Net"] } }, strict: true });
  assert.match(offTable.problems[0], /not a weapon on the table/);
  // Not strict: what fits is applied, nothing is said.
  const lenient = applyFeatGrants({ proficiencies: base, feats, choices: { linguist: { languages: ["Elvish", "Giant"] } }, strict: false });
  assert.deepEqual(lenient.problems, []);
  assert.deepEqual(lenient.proficiencies.languages, ["Common", "Elvish", "Giant"]);
});

test("an edit starts from the training without the old picks, so re-picking replaces rather than piles on", () => {
  const stored = { ...base, languages: ["Common", "Elvish", "Dwarvish", "Giant", "Orc"], skills: ["athletics", "perception", "stealth"], expertise: ["stealth"] };
  const stripped = withoutFeatPicks(stored, { linguist: { languages: ["Dwarvish", "Giant", "Orc"] }, "skill expert": { skills: ["stealth"], expertise: ["stealth"] } });
  assert.deepEqual(stripped.languages, ["Common", "Elvish"]);
  assert.deepEqual(stripped.skills, ["athletics", "perception"]);
  assert.deepEqual(stripped.expertise, []);
  assert.deepEqual(withoutFeatPicks(stored, undefined), stored);
});

console.log(`\ntest-feat-grants: ${passed} tests passed.`);
