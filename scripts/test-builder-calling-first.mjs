// Backlog F4: the builder asks how you want to play first and the name
// last. The class step leads with the playstyle question, "Help me build",
// the setting's notices and the level; the background sits beside the
// ancestry with every open tool grant; the name, gender, alignment, looks
// and story are the last step before the summary, and nothing before it
// waits on a name. A draft kept on the device under the old order resumes
// on the same step, not a shifted one. The clicks are walked in
// scripts/browser/scenarios (builder-draft, builder-jump-ahead and others).
import assert from "node:assert/strict";
import fs from "node:fs";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

// Windows CI checks out with CRLF.
const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const submit = await import("../src/app/characters/builder/submit.ts");
const { draftStepKey } = await import("../src/app/characters/builder/builderDraft.ts");

let passed = 0;
async function test(name, fn) {
  await fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

const builder = read("src/app/characters/builder/CharacterBuilder.tsx");
const stepOf = (key) => {
  const start = builder.indexOf(`      key: "${key}",`);
  assert.ok(start >= 0, `no ${key} step`);
  const next = builder.indexOf("\n    {\n      key: ", start + 1);
  return builder.slice(start, next < 0 ? undefined : next);
};

await test("the steps run class, ancestry, abilities, spells and gear, hero, finish", () => {
  assert.match(builder, /const STEP_ORDER = \["calling", "ancestry", "abilities", "spells-gear", "identity", "finish"\];/);
  const keys = [...builder.matchAll(/^ {6}key: "([^"]+)",\n {6}label:/gm)].map((match) => match[1]);
  assert.deepEqual(keys, ["calling", "ancestry", "abilities", "spells-gear", "identity", "finish"], "the wizard's steps follow STEP_ORDER");
  // An edit still opens on the summary, the last step.
  assert.match(builder, /useState\(initial \? STEP_ORDER\.length - 1 : 0\)/);
});

await test("the first step asks how you want to play, with Help me build, the notices and the level", () => {
  const calling = stepOf("calling");
  assert.match(calling, /question: quizVoice === "party" \? "What does the party need\?" : "In a fight, what's your job\?"/);
  assert.match(calling, /onHelpMeBuild: \(role\) => setQuiz\(\{ role \}\)/);
  assert.match(calling, /notices=\{<ContentNotices pack=\{pack\} packInstalled=\{packInstalled\} \/>\}/);
  assert.match(calling, /levelField=\{<LevelField state=\{state\} fixedLevel=\{fixedLevel\} levelNote=\{levelNote\}/);
  const step = read("src/app/characters/builder/steps/CallingStep.tsx");
  assert.match(step, /onHelpMeBuild=\{playstyle\?\.onHelpMeBuild\}/);
  assert.ok(step.indexOf("{levelField}") > step.indexOf('<Field label="Class"') && step.indexOf("{levelField}") < step.indexOf("{offersSubclass ? ("), "the level sits under the class, above the subclass it decides");
  const level = read("src/app/characters/builder/steps/CallingSetup.tsx");
  assert.match(level, /state\.changeLevel\(Number\(next\)\)/);
  assert.match(level, /levelNote \? \(/, "the door's note is said beside the level");
});

await test("the background sits beside the ancestry, with every open tool grant", () => {
  const ancestry = stepOf("ancestry");
  assert.match(ancestry, /<BackgroundPanel/);
  assert.match(ancestry, /<ToolGrantPanels/);
  assert.match(builder, /ancestry: \[\n\s+\.\.\.ancestryBlocks\(state, race, background, derived, featJudge\),\n\s+\.\.\.backgroundBlocks\(state, background, derived\),\n\s+\]/);
  for (const target of ["background", "backgroundSkills", "tools"]) {
    assert.match(builder, new RegExp(`\\n  ${target}: "ancestry",`), `${target} is asked on the ancestry step`);
  }
  const choices = read("src/app/characters/builder/steps/ClassChoices.tsx");
  const classChoices = choices.slice(choices.indexOf("export function ClassChoices"), choices.indexOf("export function ToolGrantPanels"));
  assert.doesNotMatch(classChoices, /toolGrants/, "the class step no longer draws the tool panels");
  const identity = read("src/app/characters/builder/steps/IdentityStep.tsx");
  assert.doesNotMatch(identity, /OptionPicker[^\n]*backgroundGroups|changeBackground|changeLevel/, "the identity step asks neither the background nor the level");
});

await test("nothing before the identity step needs a name", () => {
  assert.deepEqual(submit.identityBlocks({ name: "" }).map((block) => block.target), ["name"]);
  assert.deepEqual(submit.identityBlocks({ name: "Wren" }), []);
  // The other steps' gates never ask for the name.
  const nameless = { name: "", backgroundSkills: [], bonusLanguages: [], racialAsi: [], racialSkills: [], feats: [], repeatSkills: [] };
  const soldier = { id: "soldier", name: "Soldier", skills: [] };
  const human = { id: "human", name: "Human", skills: [], asi: {} };
  for (const blocks of [
    submit.backgroundBlocks(nameless, soldier, { toolGrants: { choices: [], left: [] } }),
    submit.ancestryBlocks(nameless, human, soldier),
    submit.callingBlocks(undefined),
    submit.abilitiesBlocks({ abilities: null }),
  ]) {
    assert.ok(blocks.every((block) => block.target !== "name"));
  }
  // The summary's Save waits on the earliest step's pick, the name last.
  assert.match(builder, /const firstOwed = blockers\.calling \?\? blockers\.ancestry \?\? blockers\.abilities \?\? blockers\.spells \?\? blockers\.identity;/);
  const source = read("src/app/characters/builder/submit.ts");
  assert.match(source, /gearBlocker\(derived\) \?\?\n\s+identityBlocker\(state\);/, "the final check asks for the name last");
  // Until the name is given, the hero is "Your hero".
  assert.match(builder, /title=\{state\.name\.trim\(\) \|\| "Your hero"\}/);
});

await test("the name, gender, alignment, looks and story are the last step before the summary", () => {
  const identity = stepOf("identity");
  assert.match(identity, /label: "Hero",\n\s+title: "Name your hero and tell their story",/);
  assert.match(identity, /alignmentGroups=\{pickers\.alignmentGroups\}/);
  assert.match(identity, /onUploadPortrait=\{\(\) => setCropping\(true\)\}/);
  const step = read("src/app/characters/builder/steps/IdentityStep.tsx");
  for (const field of ['aria-label="Name"', 'label="Gender"', "<AttractionPicker", '<span id={alignmentId}>Alignment</span>', '<Field label="Appearance"', 'aria-label="Backstory"']) {
    assert.ok(step.includes(field), `the identity step holds ${field}`);
  }
  // Who plays them changes nothing earlier, so the toggle stays on Finish.
  const finish = stepOf("finish");
  assert.match(finish, /role=\{role\}/);
  assert.doesNotMatch(finish, /alignmentGroups|paintsPortraits/);
});

await test("a kept draft resumes on its step by key, an old one on the same step it was left", () => {
  assert.equal(draftStepKey({ v: 2, step: "abilities" }), "abilities");
  assert.equal(draftStepKey({ v: 2, step: 3 }), null, "a version 2 draft names its step");
  // Version 1 counted identity, ancestry, calling, abilities, spells-gear, finish.
  assert.equal(draftStepKey({ v: 1, step: 1 }), "ancestry");
  assert.equal(draftStepKey({ v: 1, step: 2 }), "calling");
  assert.equal(draftStepKey({ v: 1, step: 3 }), "abilities");
  assert.equal(draftStepKey({ v: 1, step: 4 }), "spells-gear");
  assert.equal(draftStepKey({ v: 1, step: 5 }), "finish");
  assert.equal(draftStepKey({ v: 1, step: 9 }), "finish", "a step past the end is the last");
  // An old draft left on its first step had finished nothing: it starts at
  // the new first step, its name kept for the step that asks it.
  assert.equal(draftStepKey({ v: 1, step: 0 }), "calling");
  assert.equal(draftStepKey({ v: 3, step: "calling" }), null, "an unknown version is dropped");
  assert.match(builder, /writeBuilderDraft\(draftAt, STEP_ORDER\[step\] \?\? STEP_ORDER\[0\], JSON\.parse\(draftJson\)\)/);
  assert.match(builder, /return Math\.max\(0, STEP_ORDER\.indexOf\(draft\.step\)\);/);
  assert.match(builder, /setStep\(draftStepIndex\(draftOffer\)\);/);
  assert.match(builder, /left on step \{draftStepIndex\(draftOffer\) \+ 1\} of \{steps\.length\}/);
});

console.log(`test-builder-calling-first: ${passed} passed`);
