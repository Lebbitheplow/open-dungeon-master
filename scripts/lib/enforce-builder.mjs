// The character builder, driven without a browser, for the creation suites
// (scripts/test-enforce-abilities.mjs and its siblings).
//
// The builder computes a sheet in two steps: useBuilderDerived turns the
// fields a player filled in into abilities, proficiencies, hit points, gear
// and armor class, and submit.ts checks the result and shapes the payload the
// routes receive. Both are the real modules. useBuilderDerived is a React
// hook only because it memoises; here its useMemo is answered by a dispatcher
// that simply runs the function, so a test reads exactly the numbers the
// wizard would have shown.
//
// Import AFTER the alias loader is registered (enforce-world.mjs does it, or
// register("./lib/register-alias.mjs", import.meta.url) in a pure suite).
import React from "react";

const INTERNALS = "__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE";

function withoutReact(fn) {
  const internals = React[INTERNALS];
  if (!internals) {
    throw new Error("enforce-builder: this React has no client internals to stand in for");
  }
  const before = internals.H;
  internals.H = { useMemo: (compute) => compute() };
  try {
    return fn();
  } finally {
    internals.H = before;
  }
}

// The standard array placed in the order given: the first ability named gets
// the 15, the last the 8.
export const STANDARD_ARRAY = [15, 14, 13, 12, 10, 8];
export function standardScores(order = ["str", "dex", "con", "int", "wis", "cha"]) {
  return Object.fromEntries(order.map((ability, index) => [ability, STANDARD_ARRAY[index]]));
}

export async function openBuilder() {
  const src = (file) => import(new URL(`../../src/${file}`, import.meta.url).href);
  const options = await src("app/characters/builder/useBuilderOptions.ts");
  const { useBuilderDerived } = await src("app/characters/builder/useBuilderDerived.ts");
  const submit = await src("app/characters/builder/submit.ts");
  const { splitToolGrants } = await src("lib/srd/tool-choices.ts");

  // The first tools of each open grant that no other grant already names.
  function firstToolPicks(grants) {
    const { fixed, choices } = splitToolGrants(grants);
    const taken = new Set(fixed.map((tool) => tool.toLowerCase()));
    const picks = [];
    for (const choice of choices) {
      picks.push(...choice.from.filter((tool) => !taken.has(tool) && !picks.includes(tool)).slice(0, choice.count));
    }
    return picks;
  }

  const races = options.srdRaceOptions();
  const classes = options.srdClassOptions();
  const backgrounds = options.srdBackgroundOptions();

  // Every field useBuilderState holds, at the value a fresh builder opens
  // with; a test overrides the ones its rule is about.
  function stateOf(fields = {}) {
    return {
      name: "Test Hero",
      alignment: "N",
      gender: "",
      appearance: "",
      backstory: "",
      portrait: null,
      level: 1,
      method: "standard",
      scores: standardScores(),
      rollPool: null,
      racialAsi: [],
      racialSkills: [],
      racialTool: "",
      racialAncestry: "",
      toolPicks: [],
      repeatSkills: [],
      racialCantrip: "",
      backgroundSkills: [],
      bonusLanguages: [],
      asiChoices: [],
      asiRecorded: 0,
      asiReachedLevel: 0,
      chosenSkills: [],
      expertisePicks: [],
      stylePicks: [],
      optionPicks: [],
      subclass: "",
      spells: [],
      bookPrepared: [],
      cantrips: [],
      spellWarningAck: true,
      equipment: [],
      removedAutoNames: [],
      keepsStoredGear: false,
      feats: [],
      gold: 0,
      hpOverride: null,
      acOverride: null,
      ...fields,
    };
  }

  // Build a character the way the wizard does. `race`, `class` and
  // `background` are ids from the bundled lists, or whole option rows (a
  // content-pack race). Returns the blocker the final check raised (null when
  // the sheet may be submitted), the derived numbers, and the payload.
  function build({ race, class: classId, background, ...fields }) {
    const raceRow = typeof race === "string" ? races.find((entry) => entry.id === race) : race;
    const klass = typeof classId === "string" ? classes.find((entry) => entry.id === classId) : classId;
    const backgroundRow =
      typeof background === "string" ? backgrounds.find((entry) => entry.id === background) : background;
    // Rolled scores are a placement of the six totals thrown: a case that
    // names rolled scores and no pool is given the pool those scores are.
    const thrown =
      fields.method === "roll" && fields.rollPool === undefined && fields.scores
        ? { rollPool: Object.values(fields.scores).map((total) => ({ total, roll: null })) }
        : {};
    // The builder leaves an open tool grant ("three musical instruments") to
    // the player and waits for the pick. A case that names no picks makes the
    // player's plainest ones, the first tools of each list; a case about the
    // pick itself passes toolPicks (an empty list to pick nothing).
    const picked =
      fields.toolPicks === undefined && klass && backgroundRow
        ? { toolPicks: firstToolPicks([...(klass.tools ?? []), ...(backgroundRow.tools ?? [])]) }
        : {};
    const state = stateOf({ ...thrown, ...picked, ...fields });
    const derived = withoutReact(() =>
      useBuilderDerived({ state, race: raceRow, klass, background: backgroundRow }),
    );
    const input = { state, derived, race: raceRow, klass, background: backgroundRow };
    const blocker = submit.validateBuilder(input);
    const result = derived.preview && raceRow && klass && backgroundRow ? submit.buildBuilderResult(input) : null;
    return { state, derived, blocker, result, sheet: result?.sheet ?? null, level: result?.level ?? null };
  }

  return { races, classes, backgrounds, stateOf, build, submit };
}
