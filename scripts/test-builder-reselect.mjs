// Two builder taps that said or did the wrong thing.
//
// A second tap on the class card already chosen threw away every pick that
// hangs off the class (skills, subclass, spells, expertise, styles, kit),
// as if a new class had been chosen; the race card did the same to the
// race's picks. Choosing what is already chosen is now no change.
//
// While a wizard writes the spellbook, a spell in the book reported
// aria-pressed false although a tap takes it out. The pressed state now
// follows what a tap toggles: being in the book while it is written, being
// prepared everywhere else (the sheet, the builder's prepare phase).
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { createElement, useState } = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");
const { useBuilderState } = await import("../src/app/characters/builder/useBuilderState.ts");
const { srdRaceOptions, srdClassOptions, srdBackgroundOptions } = await import(
  "../src/app/characters/builder/useBuilderOptions.ts"
);
const { SpellBook, tilePressed } = await import("../src/components/sheet/SpellBook.tsx");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

const races = srdRaceOptions();
const classes = srdClassOptions();
const backgrounds = srdBackgroundOptions();

// Drives the real hook through the server renderer: a state update made
// while the component renders runs it again, so each pass takes one step
// and the last pass reads the result. Each step also bumps a counter of its
// own, so a step that changes nothing (the point of a reselect) still gets
// the pass after it.
function runBuilder(steps) {
  let pass = 0;
  let result = null;
  function Probe() {
    const state = useBuilderState({ races, classes, backgrounds });
    const [, bump] = useState(0);
    const step = steps[pass];
    pass += 1;
    if (step) {
      step(state);
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

// A wizard elf with its class and race picks made.
const setUp = [
  (state) => {
    state.changeRace("elf");
    state.changeClass("wizard");
  },
  (state) => {
    state.setChosenSkills(["Arcana", "History"]);
    state.setCantrips(["Fire Bolt", "Light", "Mage Hand"]);
    state.setSpells(["Magic Missile", "Shield", "Sleep"]);
    state.setBookPrepared(["Magic Missile", "Shield"]);
    state.setRacialCantrips(["Prestidigitation"]);
  },
];

test("the set-up picks are held", () => {
  const state = runBuilder(setUp);
  assert.equal(state.classId, "wizard");
  assert.equal(state.raceId, "elf");
  assert.deepEqual(state.chosenSkills, ["Arcana", "History"]);
  assert.deepEqual(state.spells, ["Magic Missile", "Shield", "Sleep"]);
  assert.deepEqual(state.racialCantrips, ["Prestidigitation"]);
});

test("choosing the class already chosen keeps its skills, spells and prepared spells", () => {
  const state = runBuilder([...setUp, (s) => s.changeClass("wizard")]);
  assert.equal(state.classId, "wizard");
  assert.deepEqual(state.chosenSkills, ["Arcana", "History"]);
  assert.deepEqual(state.cantrips, ["Fire Bolt", "Light", "Mage Hand"]);
  assert.deepEqual(state.spells, ["Magic Missile", "Shield", "Sleep"]);
  assert.deepEqual(state.bookPrepared, ["Magic Missile", "Shield"]);
  assert.equal(state.dropped, null, "a reselect reported dropped picks");
});

test("choosing another class still clears the old class's picks", () => {
  const state = runBuilder([...setUp, (s) => s.changeClass("fighter")]);
  assert.equal(state.classId, "fighter");
  assert.deepEqual(state.chosenSkills, []);
  assert.deepEqual(state.spells, []);
  assert.deepEqual(state.bookPrepared, []);
});

test("choosing the race already chosen keeps its picks", () => {
  const state = runBuilder([...setUp, (s) => s.changeRace("elf")]);
  assert.equal(state.raceId, "elf");
  assert.deepEqual(state.racialCantrips, ["Prestidigitation"]);
  assert.deepEqual(state.spells, ["Magic Missile", "Shield", "Sleep"]);
});

test("choosing another race still clears the old race's picks", () => {
  const state = runBuilder([...setUp, (s) => s.changeRace("dwarf")]);
  assert.equal(state.raceId, "dwarf");
  assert.deepEqual(state.racialCantrips, []);
});

test("a spell in the book is pressed only while the book is being written", () => {
  assert.equal(tilePressed("inBook", true), true);
  assert.equal(tilePressed("inBook", false), false);
  assert.equal(tilePressed("inBook"), false, "the sheet's default is the prepare reading");
  for (const writingBook of [true, false]) {
    assert.equal(tilePressed("available", writingBook), false);
    assert.equal(tilePressed("ready", writingBook), true);
    assert.equal(tilePressed("pending", writingBook), true);
    assert.equal(tilePressed("granted", writingBook), true);
  }
});

// The rendered buttons, as a screen reader hears them.
function pressedByName(props) {
  const markup = renderToStaticMarkup(
    createElement(SpellBook, {
      maxLevel: 1,
      onTile() {},
      tiles: [
        { name: "Magic Missile", level: 1, state: "ready" },
        { name: "Sleep", level: 1, state: "inBook" },
        { name: "Burning Hands", level: 1, state: "available" },
      ],
      ...props,
    }),
  );
  const pressed = {};
  // The spell tiles only: the level row's pills are toggles of their own.
  for (const match of markup.matchAll(/<li class="spell-tile"[^>]*><button[^>]*aria-pressed="(true|false)"[^>]*title="([^"]*)"/g)) {
    pressed[match[2]] = match[1];
  }
  return pressed;
}

test("the builder's book-writing phase renders a spell in the book as pressed", () => {
  assert.deepEqual(pressedByName({ writingBook: true }), {
    Ready: "true",
    "In spellbook": "true",
    Available: "false",
  });
});

test("the sheet and the prepare phase render only prepared spells as pressed", () => {
  assert.deepEqual(pressedByName({}), {
    Ready: "true",
    "In spellbook": "false",
    Available: "false",
  });
});

console.log(`\n${passed} passed`);
