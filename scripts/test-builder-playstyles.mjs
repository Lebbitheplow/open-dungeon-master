// The builder's "In a fight, what's your job?" (src/app/characters/builder/
// playstyles.ts): every answer suggests classes the table offers, the usual
// starts first, a world's own classes by role, and never more than three.
// The same answers are the quick-build quiz's first question.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);
const { PLAYSTYLES, EASY_CLASSES, fillClassSkills, playstyleBackgrounds, playstyleSuggestions } = await import("../src/app/characters/builder/playstyles.ts");
const { classRoles } = await import("../src/lib/srd/class-roles.ts");

const core = ["barbarian", "bard", "cleric", "druid", "fighter", "monk", "paladin", "ranger", "rogue", "sorcerer", "warlock", "wizard"].map((id) => ({
  id,
  roles: classRoles({ id }).roles,
}));

for (const style of PLAYSTYLES) {
  const picks = playstyleSuggestions(style.id, core);
  assert.ok(picks.length > 0 && picks.length <= 3, `${style.id}: ${picks}`);
  assert.deepEqual(picks.slice(0, Math.min(3, style.first.length)), style.first.slice(0, 3), `${style.id} leads with its usual starts`);
}
assert.ok(playstyleSuggestions("tank", core).includes("fighter"));
assert.ok(playstyleSuggestions("healer", core).includes("cleric"));
assert.ok(playstyleSuggestions("support", core).includes("wizard"), "a caster shows under the job it does");
assert.ok(EASY_CLASSES.has("fighter") && !EASY_CLASSES.has("wizard"));

// A world with renamed or new classes: matched by role, never invented.
const world = [{ id: "marshal", roles: ["Tank", "Support"] }, { id: "hexblade", roles: ["DPS"] }];
assert.deepEqual(playstyleSuggestions("tank", world), ["marshal"]);
assert.deepEqual(playstyleSuggestions("healer", world), [], "nothing offered fits: the grid stays the answer");
// The first step's background hints: the SRD's ids, or a pack's by name.
const srd = ["acolyte", "criminal", "folk_hero", "sage", "soldier", "urchin"].map((id) => ({ id, name: id }));
assert.deepEqual(playstyleBackgrounds("tank", srd).map((entry) => entry.id), ["soldier", "folk_hero"]);
assert.deepEqual(playstyleBackgrounds("tank", [{ id: "folk-hero", name: "Folk Hero" }]).map((entry) => entry.id), ["folk-hero"]);
assert.deepEqual(playstyleBackgrounds("support", [{ id: "noble", name: "Noble" }]), [], "none offered: no hint");
for (const style of PLAYSTYLES) assert.ok(style.backgrounds.length > 0, `${style.id} names its backgrounds`);
// "Suggest the rest" keeps a deliberate pick, skips a granted skill, and
// fills only what is left.
const fighterFrom = ["acrobatics", "animal_handling", "athletics", "history", "insight", "intimidation", "perception", "survival"];
assert.deepEqual(fillClassSkills({ classId: "fighter", from: fighterFrom, count: 2, chosen: [], granted: new Set() }), ["athletics", "perception"]);
assert.deepEqual(fillClassSkills({ classId: "fighter", from: fighterFrom, count: 2, chosen: ["history"], granted: new Set() }), ["history", "athletics"]);
assert.deepEqual(fillClassSkills({ classId: "fighter", from: fighterFrom, count: 2, chosen: [], granted: new Set(["athletics"]) }), ["perception", "intimidation"]);
assert.deepEqual(fillClassSkills({ classId: "marshal", from: ["history", "insight"], count: 1, chosen: [], granted: new Set() }), ["history"], "a world's class takes its list's order");
console.log("test-builder-playstyles: ok");
