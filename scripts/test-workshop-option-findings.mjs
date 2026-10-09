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

console.log(`test-workshop-option-findings: ${passed} passed`);
