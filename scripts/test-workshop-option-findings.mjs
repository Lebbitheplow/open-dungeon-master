// The workshop's checker for character options and hazards
// (src/lib/rulesets/validate-options.ts, shown under the homebrew editor by
// src/app/workshop/homebrew/draft.ts): every SRD race passes without a
// warning, and an option that breaks an SRD norm is told which and by how
// much. Findings, not refusals: the DM may mean it.
import assert from "node:assert/strict";
import fs from "node:fs";
import { register } from "node:module";
register("./lib/register-alias.mjs", import.meta.url);

const { draftFindings } = await import("../src/app/workshop/homebrew/draft.ts");
const { resistanceTrait, withTrait } = await import("../src/lib/workshop/species-traits.ts");
let passed = 0;
const test = (name, fn) => {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
};
const warns = (findings) => findings.filter((finding) => finding.level === "warn" || finding.level === "error").map((finding) => finding.text);
const check = (kind, data, name = "Test") => draftFindings({ kind, name, data }, {});

const races = JSON.parse(fs.readFileSync(new URL("./fixtures/srd-race-rows.json", import.meta.url), "utf8")).rows;

test("every SRD race and subrace passes without a warning", () => {
  for (const row of races) {
    assert.deepEqual(warns(check("race", row.data, row.name)), [], `${row.name} drew a warning`);
  }
});

test("a species that raises a score by 3, or walks 50 feet, or is Large, is told so", () => {
  const giant = check("race", { name: "Giantkin", asi: [{ attributes: ["Strength"], value: 3 }], speed: { walk: 50 }, size: "Large", desc: "" });
  assert.ok(warns(giant).some((text) => /by 3/.test(text)));
  assert.ok(warns(giant).some((text) => /Large/.test(text)));
  assert.ok(giant.some((finding) => /Walks 50 feet/.test(finding.text)));
});

test("a background with the SRD's two skills, two tools or languages and a feature is clean; three skills are not", () => {
  const acolyte = { skill_proficiencies: "Insight, Religion", languages: "Two of your choice", feature: "Shelter of the Faithful", grants: { purse: 15 } };
  assert.deepEqual(warns(check("background", acolyte)), []);
  const greedy = { ...acolyte, skill_proficiencies: "Insight, Religion, Stealth" };
  assert.ok(warns(check("background", greedy)).some((text) => /3 skills/.test(text)));
});

test("a feat that raises a score by 2 is told an SRD feat raises it by 1; one that runs as an SRD feat says so", () => {
  assert.ok(warns(check("feat", { desc: "Increase your Strength score by 2, to a maximum of 20." })).some((text) => /raises it by 1/.test(text)));
  assert.ok(check("feat", { desc: "", runsAs: "Alert" }).some((finding) => finding.level === "note" && /Runs at the table as Alert/.test(finding.text)));
  assert.ok(warns(check("feat", { desc: "" })).some((text) => /grants nothing/.test(text)));
});

test("a subclass feature before the class takes its subclass is never granted, and an empty subclass grants nothing", () => {
  const early = check("archetype", { classSlug: "fighter", levels: { 1: [{ name: "Too Soon", desc: "x" }], 3: [{ name: "Fine", desc: "x" }] } });
  assert.ok(warns(early).some((text) => /before 3rd level/.test(text)));
  assert.ok(warns(check("archetype", { classSlug: "wizard", levels: {} })).some((text) => /No features/.test(text)));
});

test("a trap past the SRD's deadly band, a poison that costs nothing, a disease of three exhaustion levels", () => {
  assert.ok(warns(check("hazard", { hazardKind: "trap", trap: { save: { ability: "dex", dc: 24 }, damage: { dice: "4d10", type: "fire" } } })).some((text) => /DC 24/.test(text)));
  assert.ok(check("hazard", { hazardKind: "trap", trap: { save: { ability: "dex", dc: 13 } } }).some((finding) => /dangerous \(12 to 15\)/.test(finding.text)));
  assert.ok(warns(check("hazard", { hazardKind: "poison", poison: { dc: 12 } })).some((text) => /costs nothing/.test(text)));
  assert.ok(warns(check("hazard", { hazardKind: "disease", disease: { exhaustion: 3, rest: true } })).some((text) => /3 levels of exhaustion/.test(text)));
});

test("a homebrew feat is told what the builder grants from its words, or that it grants nothing", () => {
  const nimble = check("feat", { desc: "Increase your Dexterity by 1, to a maximum of 20. You gain proficiency in the Stealth skill." });
  assert.ok(nimble.some((finding) => /From its words the builder grants: \+1 to Dexterity; proficiency in Stealth\./.test(finding.text)), JSON.stringify(nimble));
  const linguist = check("feat", { desc: "You learn two languages of your choice." });
  assert.ok(linguist.some((finding) => /two languages of the player's choice/.test(finding.text)));
  const flavour = check("feat", { desc: "When you score a critical hit, you laugh loudly." });
  assert.ok(flavour.some((finding) => /Nothing in its words is a grant/.test(finding.text)));
  assert.ok(!check("feat", { desc: "When you score a critical hit, you laugh loudly.", runsAs: "Savage Attacker" }).some((finding) => /Nothing in its words/.test(finding.text)), "a feat that runs as a published one was told it grants nothing");
});

test("a species trait that resists by its words but not its name is told the table will not read it", () => {
  const ember = { asi: [{ attributes: ["Strength"], value: 2 }, { attributes: ["Charisma"], value: 1 }], speed: { walk: 30 }, traits: "**_Ember Blood._** You have resistance to fire damage." };
  assert.ok(warns(check("race", ember)).some((text) => /Ember Blood says it resists fire damage/.test(text)));
  const picked = { ...ember, traits: withTrait(ember.traits, resistanceTrait("fire")) };
  assert.deepEqual(warns(check("race", picked)), [], "the picked Fire Resistance still drew the warning");
});

test("a species paragraph that reads like a trait the table does not see is named, once each", () => {
  const base = { asi: [{ attributes: ["Strength"], value: 2 }, { attributes: ["Charisma"], value: 1 }], speed: { walk: 30 } };
  const ancestry = "**_Draconic Ancestry._** You have draconic ancestry.";
  for (const line of ["**Breath Weapon:** You exhale fire.", "*Breath Weapon.* You exhale fire.", "Breath Weapon. You exhale fire."]) {
    const unread = warns(check("race", { ...base, traits: `${ancestry}\n\n${line}` })).filter((text) => /reads like a trait/.test(text));
    assert.equal(unread.length, 1, line);
    assert.match(unread[0], /"Breath Weapon" reads like a trait, but the table does not see it as one: begin its paragraph with the name in bold and a full stop, as \*\*Breath Weapon\.\*\*/);
  }
  assert.deepEqual(warns(check("race", { ...base, traits: `${ancestry}\n\n**Breath Weapon.** You exhale fire.` })), []);
});

console.log(`test-workshop-option-findings: ${passed} passed`);
