// Undo for build experiments (backlog F12).
//
// Changing class or race threw away every pick that hung off the old one
// (skills, subclass, spells, prepared spells, the race's own picks), and a
// level or subclass change set aside what no longer fitted, with no way
// back but making each pick again. The builder now keeps the fields as they
// stood just before such a change, and "Put it back" returns the old choice
// with all its picks together. One level of undo: another pick in the new
// choice, or leaving the step, ends it.
import assert from "node:assert/strict";
import fs from "node:fs";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { createElement, useState } = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");
const { useBuilderState } = await import("../src/app/characters/builder/useBuilderState.ts");
const { undoMessage, putBackMessage, undoOutcome } = await import("../src/app/characters/builder/buildUndo.ts");
const { UndoChangeBar } = await import("../src/app/characters/builder/UndoChangeBar.tsx");
const { srdRaceOptions, srdClassOptions, srdBackgroundOptions } = await import(
  "../src/app/characters/builder/useBuilderOptions.ts"
);

// Windows checkouts may hold CRLF line ends; the source checks read LF.
const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

const races = srdRaceOptions();
const classes = srdClassOptions();
const backgrounds = srdBackgroundOptions();

// Drives the real hook through the server renderer, as
// test-builder-reselect.mjs does: a state update made while the component
// renders runs it again, so each pass takes one step. A pass whose step is
// `null` changes nothing, so the render after a change can settle.
function runBuilder(steps) {
  let pass = 0;
  let result = null;
  function Probe() {
    const state = useBuilderState({ races, classes, backgrounds });
    const [, bump] = useState(0);
    const at = pass;
    pass += 1;
    if (at < steps.length) {
      steps[at]?.(state);
      bump((count) => count + 1);
    } else {
      result = state;
    }
    return null;
  }
  renderToStaticMarkup(createElement(Probe));
  assert.ok(result, "the builder never settled");
  return result;
}

// A level 3 wizard elf with its class and race picks made.
const setUp = [
  (state) => {
    state.changeRace("high_elf");
    state.changeClass("wizard");
    state.changeLevel(3);
  },
  (state) => {
    state.setChosenSkills(["Arcana", "History"]);
    state.setCantrips(["Fire Bolt", "Light", "Mage Hand"]);
    state.setSpells(["Magic Missile", "Shield", "Misty Step"]);
    state.setBookPrepared(["Magic Missile", "Misty Step"]);
    state.setRacialCantrip("Prestidigitation");
  },
  null,
];

test("the first class and race picks offer nothing to put back", () => {
  const state = runBuilder(setUp);
  assert.equal(state.classId, "wizard");
  assert.equal(state.undo, null);
});

test("a class change is kept to put back, naming both classes", () => {
  const state = runBuilder([...setUp, (s) => s.changeClass("fighter"), null]);
  assert.equal(state.classId, "fighter");
  assert.deepEqual(state.spells, []);
  assert.ok(state.undo, "no undo after a class change");
  assert.equal(state.undo.because, "class");
  assert.equal(state.undo.from, "Wizard");
  assert.equal(state.undo.to, "Fighter");
});

test("Put it back returns the class and every pick that hung off it", () => {
  const state = runBuilder([...setUp, (s) => s.changeClass("fighter"), null, (s) => s.putBack(), null]);
  assert.equal(state.classId, "wizard");
  assert.deepEqual(state.chosenSkills, ["Arcana", "History"]);
  assert.deepEqual(state.cantrips, ["Fire Bolt", "Light", "Mage Hand"]);
  assert.deepEqual(state.spells, ["Magic Missile", "Shield", "Misty Step"]);
  assert.deepEqual(state.bookPrepared, ["Magic Missile", "Misty Step"]);
  assert.equal(state.undo, null, "the undo outlived its use");
});

test("Put it back returns the race and the race's own picks", () => {
  const state = runBuilder([...setUp, (s) => s.changeRace("hill_dwarf"), null]);
  assert.equal(state.racialCantrip, "");
  assert.equal(state.undo?.because, "race");
  const back = runBuilder([...setUp, (s) => s.changeRace("hill_dwarf"), null, (s) => s.putBack(), null]);
  assert.equal(back.raceId, "high_elf");
  assert.equal(back.racialCantrip, "Prestidigitation");
  assert.deepEqual(back.spells, ["Magic Missile", "Shield", "Misty Step"]);
});

test("another pick in the new choice ends the undo", () => {
  const state = runBuilder([...setUp, (s) => s.changeClass("fighter"), null, (s) => s.setChosenSkills(["Athletics"]), null]);
  assert.equal(state.classId, "fighter");
  assert.equal(state.undo, null);
});

test("only one level: a second change replaces the first", () => {
  const state = runBuilder([...setUp, (s) => s.changeClass("fighter"), null, (s) => s.changeClass("rogue"), null]);
  assert.equal(state.undo?.from, "Fighter");
  assert.equal(state.undo?.to, "Rogue");
});

test("a level change that sets spells aside can be put back", () => {
  const state = runBuilder([...setUp, (s) => s.changeLevel(1), null]);
  assert.equal(state.level, 1);
  assert.ok(!state.spells.includes("Misty Step"), "the 2nd-level spell stayed at level 1");
  assert.equal(state.undo?.because, "level");
  assert.equal(state.undo?.from, "level 3");
  const back = runBuilder([...setUp, (s) => s.changeLevel(1), null, (s) => s.putBack(), null]);
  assert.equal(back.level, 3);
  assert.deepEqual(back.spells, ["Magic Missile", "Shield", "Misty Step"]);
  assert.deepEqual(back.bookPrepared, ["Magic Missile", "Misty Step"]);
  assert.equal(back.dropped, null, "the dropped notice of the change outlived the put back");
});

test("a level change that loses nothing offers no undo", () => {
  const state = runBuilder([...setUp, (s) => s.changeLevel(4), null]);
  assert.equal(state.level, 4);
  assert.equal(state.undo, null);
});

test("a subclass change is kept to put back", () => {
  const state = runBuilder([
    ...setUp,
    (s) => s.changeSubclass("School of Evocation"),
    null,
    (s) => s.changeSubclass("School of Divination"),
    null,
  ]);
  assert.equal(state.undo?.because, "subclass");
  assert.equal(state.undo?.from, "School of Evocation");
});

test("the message says what changed and what comes back", () => {
  assert.equal(
    undoMessage({ because: "class", from: "Wizard", to: "Fighter" }),
    "Changed class from Wizard to Fighter. Put it back to return to Wizard with the picks that went with it.",
  );
  assert.ok(undoMessage({ because: "race", from: "Elf", to: "Dwarf" }).startsWith("Changed ancestry from Elf"));
  assert.equal(putBackMessage({ from: "Wizard" }), "Put back Wizard and its picks.");
});

test("the undo records the fields once, then ends on any difference", () => {
  const undo = { after: null };
  assert.equal(undoOutcome(undo, "{}"), "record");
  assert.equal(undoOutcome({ after: "{}" }, "{}"), "keep");
  assert.equal(undoOutcome({ after: "{}" }, '{"name":"x"}'), "clear");
});

test("the bar is a plain button named by its words, and takes no focus", () => {
  const markup = renderToStaticMarkup(
    createElement(UndoChangeBar, { undo: { because: "class", from: "Wizard", to: "Fighter" }, onPutBack() {} }),
  );
  assert.ok(/<button type="button"[^>]*aria-describedby=/.test(markup), "the button is not described by the message");
  assert.ok(markup.includes("Put it back"));
  assert.ok(!markup.includes("autofocus") && !markup.includes("autoFocus"));
  assert.ok(!markup.includes('role="alert"'), "the bar interrupts a screen reader");
  // Finger-sized on a phone, and in colours the day theme turns to ink on
  // cream (stone and amber; sky stays pale on parchment).
  assert.ok(/<button type="button"[^>]*class="[^"]*\bpk-tap\b/.test(markup), "Put it back is not finger-sized on a phone");
  assert.ok(!/sky-/.test(markup), "the bar uses a colour the day theme leaves pale");
  assert.ok(/data-build-undo=""[^>]*class="[^"]*\btext-amber-100\b/.test(markup), "the bar is not drawn as the builder's other notices");
});

test("the builder says the undo in a live region it keeps mounted, and ends it when the step changes", () => {
  const source = read("src/app/characters/builder/CharacterBuilder.tsx");
  assert.ok(/<p role="status" data-build-undo-said=""/.test(source), "no mounted live region for the undo");
  assert.ok(source.includes("undoAt.step !== step") && source.includes("state.clearUndo()"), "leaving the step keeps the undo");
  for (const key of ["identity", "ancestry", "calling", "abilities", "spells-gear"]) {
    assert.ok(source.includes(`undoBar("${key}")`), `the ${key} step shows no undo bar`);
  }
});

console.log(`\n${passed} builder undo checks passed`);
