// The builder's feat pickers judge prerequisites the way the save does.
//
// Any feat could be picked in the builder, and its requirement was only
// read when the server refused the save. The pickers now read each feat
// through the evaluator the server uses (checkPrerequisite in
// src/lib/srd/legality/features.ts) and write the verdict out in words: a
// plainly unmet requirement cannot be picked, one waiting on a choice not
// yet made stays pickable with its note, and a picked feat a later choice
// breaks is flagged at Continue and left on the sheet.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { createElement, useState } = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");
const { useBuilderState } = await import("../src/app/characters/builder/useBuilderState.ts");
const { useBuilderDerived } = await import("../src/app/characters/builder/useBuilderDerived.ts");
const { srdRaceOptions, srdClassOptions, srdBackgroundOptions } = await import(
  "../src/app/characters/builder/useBuilderOptions.ts"
);
const { builderFeatCandidate, builderFeatJudge, judgeEntry, unmetFeatMessage } = await import(
  "../src/app/characters/builder/featPrereqs.ts"
);
const { abilitiesBlocker, ancestryBlocker } = await import("../src/app/characters/builder/submit.ts");
const { SelectedPrerequisite } = await import("../src/app/characters/builder/AsiFeatEditor.tsx");
const { checkPrerequisite, judgeFeats, unmetPrerequisite } = await import("../src/lib/srd/legality/features.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

const races = srdRaceOptions();
const classes = srdClassOptions();
const backgrounds = srdBackgroundOptions();

// Drives the real hooks through the server renderer, one step a pass (as
// test-builder-reselect.mjs does), and hands back the state, the derived
// numbers and the judge the builder gives its pickers after the last step.
function runBuilder(steps) {
  let pass = 0;
  let result = null;
  function Probe() {
    const state = useBuilderState({ races, classes, backgrounds });
    const race = races.find((entry) => entry.id === state.raceId);
    const klass = classes.find((entry) => entry.id === state.classId);
    const background = backgrounds.find((entry) => entry.id === state.backgroundId) ?? backgrounds[0];
    const derived = useBuilderDerived({ state, race, klass, background });
    const [, bump] = useState(0);
    const step = steps[pass];
    pass += 1;
    if (step) {
      step(state);
      bump((count) => count + 1);
    } else {
      const facts = { state, derived, race, klass, background };
      result = { ...facts, judge: builderFeatJudge(facts, {}) };
    }
    return null;
  }
  renderToStaticMarkup(createElement(Probe));
  assert.ok(result, "the builder never settled");
  return result;
}

const SCORES = { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 };
const row = (name) => ({ name, data: {} });

// A variant human fighter: the race picks a feat a step before the scores.
const variantHuman = [
  (state) => {
    state.changeRace("variant_human");
    state.changeClass("fighter");
  },
];
const withScores = (scores) => [
  ...variantHuman,
  (state) => {
    state.setScores(scores);
    state.setRacialAsi(["str", "con"]);
  },
];

test("the set-up is a variant human fighter", () => {
  const { race, klass } = runBuilder(variantHuman);
  assert.equal(race?.id, "variant_human");
  assert.equal(klass?.id, "fighter");
});

test("a met requirement says the score it read", () => {
  const { judge } = runBuilder(withScores(SCORES));
  const check = judge.check("Dexterity 13 or higher");
  assert.equal(check.state, "met");
  assert.equal(check.requirements[0].note, "Dexterity 13, you have 14");
  assert.deepEqual(judgeEntry(judge, row("Defensive Duelist")), { blocked: false, note: "Dexterity 13, you have 14" });
});

test("a plainly unmet requirement cannot be picked, and says why", () => {
  const { judge } = runBuilder(withScores(SCORES));
  const verdict = judgeEntry(judge, row("Inspiring Leader"));
  assert.deepEqual(verdict, { blocked: true, note: "Needs Charisma 13, you have 8" });
  // Training the class gives, judged the same way.
  assert.equal(judge.check("Proficiency with heavy armor").state, "met");
  assert.equal(judgeEntry(judge, row("Elven Accuracy"))?.blocked, true);
  assert.equal(judgeEntry(judge, row("War Caster"))?.note, "Needs the ability to cast at least one spell");
});

test("a requirement on a score not yet assigned waits, and stays pickable", () => {
  const { judge } = runBuilder(variantHuman);
  const verdict = judgeEntry(judge, row("Defensive Duelist"));
  assert.deepEqual(verdict, { blocked: false, note: "Waiting on Dexterity" });
  assert.equal(judge.check("Intelligence or Wisdom 13 or higher").requirements[0].note, "Waiting on Intelligence or Wisdom");
});

test("a requirement on a class not yet chosen waits", () => {
  const { judge } = runBuilder([(state) => state.changeRace("variant_human")]);
  assert.deepEqual(judgeEntry(judge, row("Heavy Armor Master")), { blocked: false, note: "Waiting on your class" });
});

test("a racial bonus not yet placed can still meet a score, so the feat waits", () => {
  const { judge } = runBuilder([
    ...variantHuman,
    (state) => state.setScores({ ...SCORES, cha: 12 }),
  ]);
  const check = judge.check("Charisma 13 or higher");
  assert.equal(check.state, "waiting");
  assert.match(check.requirements[0].note, /^Charisma 13, you have 12: waiting/);
});

test("a requirement only the table can check is noted and does not block", () => {
  const { judge } = runBuilder(withScores(SCORES));
  const check = judge.check("Wisdom 13 or higher and the Ki class feature");
  assert.equal(check.state, "unmet");
  assert.deepEqual(
    check.requirements.map((entry) => entry.state),
    ["unmet", "unchecked"],
  );
  assert.equal(judge.check("The Ki class feature").state, "met");
  assert.equal(judge.check("The Ki class feature").requirements[0].note, "The Ki class feature: the table checks this");
});

test("a picked feat is rechecked when a score it depends on changes, flagged and kept", () => {
  // The ancestry step's other picks made, so its gate reaches the feat.
  const picked = [
    ...withScores(SCORES),
    (state) => {
      state.setFeats(["Skulker"]);
      state.setBonusLanguages(["Elvish", "Dwarvish", "Giant"]);
      state.setRacialSkills(["perception"]);
    },
  ];
  const before = runBuilder(picked);
  assert.equal(before.judge.checkFeat("Skulker")?.state, "met");
  assert.equal(ancestryBlocker(before.state, before.race, before.background, before.derived, before.judge), null);

  const after = runBuilder([...picked, (state) => state.setScores({ ...SCORES, dex: 10, wis: 14 })]);
  assert.deepEqual(after.state.feats, ["Skulker"], "the feat is not silently removed");
  const check = after.judge.checkFeat("Skulker");
  assert.equal(check?.state, "unmet");
  assert.equal(check?.requirements[0].note, "Needs Dexterity 13, you have 10");
  const blocked = ancestryBlocker(after.state, after.race, after.background, after.derived, after.judge);
  assert.equal(blocked?.target, "racialFeat");
  assert.equal(blocked?.message, "Skulker: Needs Dexterity 13, you have 10. Pick another feat, or change what it depends on.");
  assert.equal(unmetFeatMessage(after.judge, ["Alert"]), null, "a feat with no prerequisite is never flagged");
  // An edit does not judge a feat the stored character already held, as
  // the server does not.
  const { state, derived, race, klass, background } = after;
  const editJudge = builderFeatJudge({ state, derived, race, klass, background }, {}, ["Skulker"]);
  assert.equal(editJudge.checkFeat("Skulker"), null);

  // On the card, in words.
  const card = renderToStaticMarkup(createElement(SelectedPrerequisite, { id: "note", check }));
  assert.match(card, /id="note"/);
  assert.match(card, /Requirement not met: Needs Dexterity 13, you have 10/);
});

test("a feat held before an edit, taken off, can be put back from the pickers, as the save allows; a new one is still judged", () => {
  // A stored variant human fighter holding Skulker, its Dexterity now 8.
  const low = { str: 15, dex: 8, con: 13, int: 12, wis: 14, cha: 10 };
  const fighter4 = [...withScores(low), (state) => state.changeLevel(4)];
  // Skulker taken off the card: the race's feat slot is open again.
  const { state, derived, race, klass, background } = runBuilder(fighter4);
  assert.deepEqual(state.feats, []);
  const facts = { state, derived, race, klass, background };
  const editJudge = builderFeatJudge(facts, {}, ["Skulker", "Defensive Duelist"]);
  const fresh = builderFeatJudge(facts, {});
  for (const [name, needs] of [["Skulker", "Dexterity 13"], ["Defensive Duelist", "Dexterity 13"]]) {
    // Search and browse both read judgeEntry; the race's picker and an
    // improvement's (forSlot).
    for (const forSlot of [false, true]) {
      assert.equal(judgeEntry(editJudge, row(name), forSlot), null, `${name} held: offered again${forSlot ? " for an improvement" : ""}`);
      assert.deepEqual(judgeEntry(fresh, row(name), forSlot), { blocked: true, note: `Needs ${needs}, you have 8` }, `${name} new: still refused`);
    }
  }
  // A feat the character never held is judged on the edit too: Charisma 10
  // and the open improvement's +2 still fall short of 13.
  assert.equal(judgeEntry(editJudge, row("Inspiring Leader"))?.blocked, true);
  assert.equal(judgeEntry(editJudge, row("Elven Accuracy"))?.blocked, true);
  assert.equal(editJudge.held("skulker "), true, "held is read by name, as the save reads it");

  // The save agrees: held, nothing to answer; new, refused.
  const who = builderFeatCandidate(facts).who;
  const featOf = () => ({ name: "Skulker", prerequisite: "Dexterity 13 or higher", desc: "" });
  const server = (held) => judgeFeats({ sent: ["Skulker"], recorded: [], held, racialFeats: 1, unrecordedSlots: 0, featOf, who }).problems;
  assert.deepEqual(server(["Skulker"]), []);
  assert.equal(server([]).length, 1);
});

test("an improvement's feat is rechecked at the Abilities step's Continue", () => {
  const fighter4 = [
    ...withScores({ str: 15, dex: 14, con: 13, int: 10, wis: 8, cha: 12 }),
    (state) => state.changeLevel(4),
    (state) => state.setFeats(["Alert"]),
  ];
  const open = runBuilder(fighter4);
  assert.equal(open.derived.asiSlotLevels.length, 1);
  // The open improvement cannot both be the feat and raise Charisma for it.
  assert.equal(judgeEntry(open.judge, row("Inspiring Leader"), true)?.blocked, true);
  // The racial feat beside it can wait on that improvement's +2.
  assert.equal(judgeEntry(open.judge, row("Inspiring Leader"))?.blocked, false);

  const taken = runBuilder([...fighter4, (state) => state.setAsiChoices([{ mode: "feat", feat: "Defensive Duelist" }])]);
  assert.equal(abilitiesBlocker(taken.derived, taken.state, taken.judge), null);
  const lowered = runBuilder([
    ...fighter4,
    (state) => state.setAsiChoices([{ mode: "feat", feat: "Defensive Duelist" }]),
    (state) => state.setScores({ str: 15, dex: 8, con: 13, int: 10, wis: 14, cha: 12 }),
  ]);
  assert.deepEqual(lowered.state.asiChoices, [{ mode: "feat", feat: "Defensive Duelist" }]);
  const blocked = abilitiesBlocker(lowered.derived, lowered.state, lowered.judge);
  assert.equal(blocked?.target, "asi");
  assert.match(blocked?.message ?? "", /^Defensive Duelist: Needs Dexterity 13, you have 8\./);
});

test("the server's check is the same evaluator, so the two agree", () => {
  const who = {
    abilities: { str: 15, dex: 12, con: 13, int: 12, wis: 10, cha: 8 },
    armor: ["light", "medium", "heavy", "shields"],
    casts: false,
    raceId: "variant_human",
    raceName: "Variant Human",
    skills: ["athletics"],
    level: 4,
  };
  for (const prerequisite of [
    "Dexterity 13 or higher",
    "Strength 13 or higher",
    "Proficiency with heavy armor",
    "The ability to cast at least one spell",
    "Elf or half-elf",
    "Proficiency in Stealth",
    "8th level or higher",
    "Wisdom 13 or higher and the Ki class feature",
    "N/A",
  ]) {
    const check = checkPrerequisite(prerequisite, who);
    assert.equal(unmetPrerequisite(prerequisite, who) !== null, check.state === "unmet", prerequisite);
    assert.notEqual(check.state, "waiting", "the server never waits");
  }
  assert.equal(unmetPrerequisite("Requires Dexterity 13 or higher.", who), "Dexterity 13 or higher");
});

console.log(`\n${passed} passed`);
