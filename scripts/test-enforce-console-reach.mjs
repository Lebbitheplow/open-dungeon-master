// Every adjudication the DM console offers, run the way the console runs
// it: a person in the DM seat of a human-run table, the form filled with a
// value of each field's own kind, the answer read as the console reads it.
//
// The catalog (src/lib/dm/invoke-catalog.ts) promises that whatever the
// engine can do, the person running the table can reach. The guard test
// scripts/test-invoke-catalog.mjs holds the NAMES in both directions. This
// suite holds the FORMS: an entry whose fields, filled as the console fills
// them, cannot get past its handler's own argument check is a door painted
// on a wall, and so is one whose handler throws.
//
// Three answers come back from a call, and only the third is a finding:
//   ok                 the engine did it;
//   a rules refusal    the engine said no in the fiction (not their turn,
//                      out of reach, no slot left, nothing to buy): the
//                      console reached the rules;
//   an argument fault  the handler could not read what the form sent
//                      (src/lib/dm/tool-errors.ts, the "retry" kind), or it
//                      threw.
//
// Each entry is run twice: at a table with a fight on, the acting hero on
// the board beside an enemy, and at a quiet table with no fight, which is
// where the console lives most of the time. An entry that says it needs an
// encounter is expected to refuse the quiet table in words.
//
// The values a field is filled with are the plainest of its kind: the first
// option of a select, the field's minimum for a number, a hero or enemy at
// the table for a picker, and for free text a word the entry's own
// placeholder suggests, or one from the table below where the placeholder
// gives none. A value a handler calls unknown is not the form's fault, so
// the entries whose free text names a specific thing (a spell, an item, a
// feature) are given one the hero really has.
import assert from "node:assert/strict";
import fs from "node:fs";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";
import { cleric } from "./lib/enforce-spells.mjs";

const { ADJUDICATIONS, consoleAdjudications } = await import("../src/lib/dm/invoke-catalog.ts");
const { classifyToolError } = await import("../src/lib/dm/tool-errors.ts");
const { setDmMode } = await import("../src/lib/db/campaigns.ts");
const { invokeEngine } = await import("../src/lib/dm/invoke.ts");

const { test, gap, finish } = suite("test-enforce-console-reach");

// ---- the values a form is filled with ----

// Free text by field name, when the placeholder gives nothing usable.
const TEXT = {
  class: "fighter",
  race: "human",
  background: "soldier",
  monster: "goblin",
  againstMonster: "goblin",
  creature: "goblin",
  spell: "Bless",
  spellName: "Bless",
  item: "Dagger",
  itemName: "Dagger",
  name: "Marla the Fence",
  title: "The Night the Bridge Fell",
  feature: "Second Wind",
  resource: "Second Wind",
  location: "The Old Mill",
  place: "The Old Mill",
  npc: "Marla the Fence",
  faction: "The Dockside Guild",
  quest: "Find the harbourmaster's key",
  objective: "Find the harbourmaster's key",
  condition: "poisoned",
  reason: "the test asks",
  summary: "A plain line for the table.",
  note: "A plain line for the table.",
  text: "A plain line for the table.",
  content: "A plain line for the table.",
  description: "A plain line for the table.",
  prompt: "A plain line for the table.",
  question: "What do you do?",
  label: "A label",
  event: "The bridge fell.",
  fact: "The bridge fell.",
  query: "bridge",
  language: "Common",
  skill: "athletics",
  ability: "str",
  target: "Marla the Fence",
  shop: "The Rusty Anchor",
  settlement: "Harrowmere",
  track: "tavern",
  mood: "tense",
  weather: "rain",
  coins: "10 gp",
  value: "10 gp",
  expression: "1d6",
  dice: "1d6",
};

// Spells by entry, for the fields that must name one the cleric can cast.
const SPELL_BY_ENTRY = {
  cast_at_enemy: "Sacred Flame",
  cast_at_player: "Sacred Flame",
  cast_buff: "Bless",
  use_spell_slot: "Bless",
  learn_spell: "Shield of Faith",
  heal: "Cure Wounds",
  aoe_damage: "Fireball",
};

const NUMBER = { dc: 12, amount: 1, hours: 1, minutes: 10, days: 1, feet: 5, x: 1, y: 1, gold: 1, xp: 50, level: 1, count: 1, rounds: 2 };

function clamp(value, min, max) {
  let out = value;
  if (typeof min === "number") out = Math.max(min, out);
  if (typeof max === "number") out = Math.min(max, out);
  return out;
}

// Which hero a character picker names: the cleric for anything that casts,
// the fighter for everything else; a healer field names the cleric.
function heroFor(entry, field, table) {
  const casting = /cast|spell|slot|heal|learn|concentrat/.test(entry.name) || /caster|healer/i.test(field.name);
  if (/target/i.test(field.name) && !/caster|healer/i.test(field.name)) {
    return table.fighter.id;
  }
  return casting ? table.cleric.id : table.fighter.id;
}

function valueFor(entry, field, table) {
  const name = field.name;
  switch (field.kind) {
    case "character":
      return heroFor(entry, field, table);
    case "characters":
      return [table.fighter.id, table.cleric.id];
    case "enemy":
      // A second enemy picker names another creature than the first.
      return /second|other/i.test(name) ? (table.enemies()[1]?.id ?? table.enemy()?.id) : table.enemy()?.id;
    case "enemies":
      return table.enemies().map((enemy) => enemy.id);
    case "combatant":
      return /second|other/i.test(name)
        ? (table.enemies()[1]?.id ?? table.cleric.id)
        : /target/i.test(name)
          ? (table.enemy()?.id ?? table.cleric.id)
          : table.fighter.id;
    case "shares":
      return [{ characterId: table.fighter.id, share: "full" }];
    case "hitDice":
      return [{ characterId: table.fighter.id, dice: 1 }];
    case "list":
      return [TEXT[name] ?? "Bless"];
    case "boolean":
      return field.default ?? true;
    case "number":
      return clamp(NUMBER[name] ?? field.min ?? 1, field.min, field.max);
    case "select":
      return field.options?.[0]?.value ?? "";
    case "dice":
      return "1d6";
    case "longtext":
      return name === "enemies" ? "goblin x1" : "A plain line of text for the table, two sentences long. It says nothing that matters.";
    case "text": {
      if (SPELL_BY_ENTRY[entry.name] && /spell/i.test(name)) {
        return SPELL_BY_ENTRY[entry.name];
      }
      if (TEXT[name] !== undefined) {
        return TEXT[name];
      }
      const hint = field.placeholder?.split(/[\n,|]/)[0]?.trim();
      return hint && hint.length <= 40 ? hint : "A plain line for the table.";
    }
    default:
      return "A plain line for the table.";
  }
}

// The form as the console sends it: every field filled, except an enemy
// picker with nobody to pick (an empty picker sends nothing).
function argsFor(entry, table) {
  const args = {};
  for (const field of entry.fields) {
    const value = valueFor(entry, field, table);
    if ((field.kind === "enemy" && !value) || (field.kind === "enemies" && value.length === 0)) {
      continue;
    }
    args[field.name] = value;
  }
  return args;
}

// An entry the console cannot submit at a quiet table: a required enemy
// picker with nobody in it.
const needsEnemy = (entry) => entry.fields.some((field) => field.required && (field.kind === "enemy" || field.kind === "enemies"));

// ---- the tables ----

async function table({ fight }) {
  const world = await openWorld({ campaign: { maxPlayers: 8, startingLevel: 5 } });
  // The DM seat holds no party slot, so the heroes belong to other players.
  const fighter = world.addHero({
    user: world.addUser(),
    name: "Brom",
    class: "fighter",
    level: 5,
    abilities: { str: 16, dex: 14, con: 14 },
    maxHp: 44,
    proficiencies: { ...TRAINED, saves: ["str", "con"], skills: ["athletics", "perception"] },
    equipment: [
      { name: "Longsword", qty: 1, equipped: true },
      { name: "Shield", qty: 1, equipped: true },
      { name: "Chain Mail", qty: 1, equipped: true },
      { name: "Dagger", qty: 2 },
      { name: "Potion of Healing", qty: 1 },
    ],
    gold: 50,
    features: [
      { name: "Second Wind", source: "class" },
      { name: "Action Surge", source: "class" },
      { name: "Extra Attack", source: "class" },
      { name: "Fighting Style: Defense", source: "choice" },
    ],
  });
  const priest = world.addHero({ user: world.addUser(), name: "Sera", maxHp: 33, gold: 50, ...cleric(5) });
  assert.ok(setDmMode(world.campaignId, "human", world.owner.id)?.dmUserId, "the owner takes the DM seat");
  const kit = await combatKit(world);
  if (fight) {
    await kit.fight(2, { heroFaces: { [fighter.id]: 19, [priest.id]: 17 }, enemyFace: 5 });
    const [first] = world.enemies();
    kit.place(fighter.id, 5, 5);
    kit.place(priest.id, 4, 5);
    kit.place(first.id, 5, 6);
  }
  return {
    world,
    kit,
    fighter,
    cleric: priest,
    enemy: () => world.enemies().find((enemy) => enemy.status !== "dead") ?? world.enemies()[0] ?? null,
    enemies: () => world.enemies(),
    invoke: (name, args) =>
      invokeEngine(world.campaign(), { kind: "human", userId: world.owner.id }, { name, args }),
  };
}

// Entries that change the staging for every entry after them run last, in
// this order, so the fight is there for the ones that need it.
const LATE = [
  "dismiss_pet", "dismiss_companion", "enemy_flees", "end_scene", "end_turn",
  "remove_item", "move_party", "travel", "pass_time", "take_rest", "teleport_token",
  "end_encounter", "start_encounter",
];
const ordered = [
  ...ADJUDICATIONS.filter((entry) => !LATE.includes(entry.name)),
  ...LATE.map((name) => ADJUDICATIONS.find((entry) => entry.name === name)).filter(Boolean),
];

// ---- the catalog itself ----

await test("every adjudication is rendered by the console: its category is one of the tabs, and no name is listed twice", () => {
  const shown = new Set(consoleAdjudications().flatMap((group) => group.entries.map((entry) => entry.name)));
  for (const entry of ADJUDICATIONS) {
    assert.ok(shown.has(entry.name), `${entry.name} (category ${entry.category}) is in no console tab`);
  }
  const names = ADJUDICATIONS.map((entry) => entry.name);
  assert.equal(new Set(names).size, names.length, "a name is listed twice");
});

await test("every field has a kind the console can render, every select has options, and no required field is a boolean", () => {
  const kinds = new Set(["character", "characters", "enemy", "enemies", "combatant", "shares", "hitDice", "list", "text", "longtext", "number", "boolean", "select", "dice"]);
  for (const entry of ADJUDICATIONS) {
    const seen = new Set();
    for (const field of entry.fields) {
      assert.ok(kinds.has(field.kind), `${entry.name}.${field.name}: kind ${field.kind}`);
      assert.ok(!seen.has(field.name), `${entry.name}: field ${field.name} twice`);
      seen.add(field.name);
      if (field.kind === "select") {
        assert.ok((field.options?.length ?? 0) > 0 || field.other, `${entry.name}.${field.name}: a select with nothing to pick`);
      }
      if (field.kind === "number" && field.min !== undefined && field.max !== undefined) {
        assert.ok(field.min <= field.max, `${entry.name}.${field.name}: min above max`);
      }
    }
  }
});

// ---- every entry, filled and run ----

// Findings this suite has already recorded, by entry name and table. A
// gap here is an entry whose console form the handler could not read; the
// rule is the catalog's own promise. Severity "medium": the person running
// the table cannot do what the engine can, and nothing tells them why but
// the handler's own wording.
// What this suite found on 2026-10-08, each fixed the same day and held
// below as a test: an NPC reaction modifier at the form's minimum built the
// expression "2d6+-10" (social-tools.ts); aoe_damage and use_reaction were
// offered with no fight running and refused for want of one (needsEncounter
// unset); and set_effect, "A lasting effect", could not be run by anyone:
// the console's field/mode/value were folded into `modifiers` and the
// required `field` then reported missing, and the model's `modifiers` alone
// failed the same check (invoke.ts normalizeArgs, catalog-types.ts
// checkArgs). The existing suites passed only by sending both shapes.
const KNOWN = {};

const CATALOG = "src/lib/dm/invoke-catalog.ts (consoleAdjudications), the entry's handler";

// A refusal that names a thing the table has not got yet (no location, no
// scene, no fight) is the engine answering in words: the console showed the
// door and the room behind it is empty. Counted as reached, except where the
// entry claims no fight is needed and the handler wants one (see below).
const PRECONDITION = /^No current location\b|^No structured scene is running\b/;
const NO_FIGHT = /no (active )?encounter|no fight|not in combat|fight is running|no battle|in a fight/i;

const outcomes = [];

async function runEntry(entry, staged, label) {
  const args = argsFor(entry, staged);
  let outcome;
  try {
    outcome = await staged.invoke(entry.name, args);
  } catch (error) {
    throw new Error(`${entry.name} threw on the console's own form: ${String(error?.message ?? error).split("\n")[0]}`);
  }
  const error = outcome.ok ? "" : String(outcome.error ?? "");
  outcomes.push(`${label} ${entry.name}: ${outcome.ok ? "ok" : error}`);
  if (outcome.ok) {
    return "ok";
  }
  const kind = classifyToolError(error);
  if (label === "quiet" && NO_FIGHT.test(error)) {
    assert.ok(entry.needsEncounter, `${entry.name} is offered with no fight running (needsEncounter unset) and refuses for want of one: "${error}"`);
    return "refused-no-fight";
  }
  if (PRECONDITION.test(error)) {
    return `refused: ${error}`;
  }
  if (kind === "retry") {
    throw new Error(`${entry.name} could not read the console's form: "${error}" (args ${JSON.stringify(args).slice(0, 300)})`);
  }
  return `refused: ${error}`;
}

for (const [label, fight] of [["fight", true], ["quiet", false]]) {
  const staged = await table({ fight });
  for (const entry of ordered) {
    if (label === "quiet" && needsEnemy(entry)) {
      // The console cannot send this form with nobody to pick.
      continue;
    }
    const name = `${label}: ${entry.name}`;
    const known = KNOWN[name];
    const run = async () => {
      if (!staged.world.encounter() && (entry.needsEncounter || /^(end_turn|enemy_attack|pc_attack)$/.test(entry.name)) && label === "fight") {
        // An earlier entry ended the fight: stage another so this one is
        // asked the question it is about.
        await staged.kit.fight(1, { heroFaces: { [staged.fighter.id]: 19, [staged.cleric.id]: 17 }, enemyFace: 5 });
        const [first] = staged.world.enemies();
        staged.kit.place(staged.fighter.id, 5, 5);
        staged.kit.place(staged.cleric.id, 4, 5);
        staged.kit.place(first.id, 5, 6);
      }
      await runEntry(entry, staged, label);
    };
    if (known) {
      await gap(`console:${name}`, { rule: "What the engine can do, the person running the table can reach through the console's form.", where: CATALOG, severity: "medium", ...known }, run);
    } else {
      await test(`console form reaches the engine (${name})`, run);
    }
  }
  staged.world.close();
}

// ---- the forms that once failed, held by name ----

await test("set_effect lands from the console's three flat fields, from the model's modifiers array, and with a penalty", async () => {
  const staged = await table({ fight: false });
  const { createDmTurn } = await import("../src/lib/db/dm-turns.ts");
  const { listEffects } = await import("../src/lib/db/active-effects.ts");
  const effectsNamed = (name) => listEffects(staged.world.campaignId).filter((effect) => effect.name === name);
  const form = await staged.invoke("set_effect", { characterId: staged.fighter.id, name: "Hymn", field: "attack", mode: "add", value: 2, duration: "rounds", remaining: 3 });
  assert.equal(form.ok, true, `the console's form: ${form.error}`);
  assert.equal(effectsNamed("Hymn").length, 1, "the effect is on the table");
  const curse = await staged.invoke("set_effect", { characterId: staged.fighter.id, name: "Curse", field: "ac", mode: "add", value: -30, duration: "manual" });
  assert.equal(curse.ok, true, `the form's minimum: ${curse.error}`);
  const turn = createDmTurn(staged.world.campaignId, [], "ai");
  const model = await invokeEngine(staged.world.campaign(), { kind: "ai", turnId: turn.id }, {
    name: "set_effect",
    args: { characterId: staged.cleric.id, name: "Shield of Faith", modifiers: [{ field: "ac", mode: "add", value: 2 }], duration: "rounds", remaining: 10 },
  });
  assert.equal(model.ok, true, `the model's shape: ${model.error}`);
  assert.equal(effectsNamed("Shield of Faith").length, 1);
  const nothing = await staged.invoke("set_effect", { characterId: staged.fighter.id, name: "Nothing", field: "ac", mode: "add", value: 0 });
  assert.equal(nothing.ok, false, "a change of nothing is refused in words");
  assert.match(nothing.error, /nonzero/);
  staged.world.close();
});

await test("npc_reaction rolls 2d6 with a penalty as well as a bonus, the whole range the console offers", async () => {
  const staged = await table({ fight: false });
  const { listRecentRolls } = await import("../src/lib/db/rolls.ts");
  for (const modifier of [-10, -3, 0, 4, 10]) {
    const met = await staged.invoke("npc_reaction", { name: `Stranger ${modifier + 10}`, modifier, trait: "wary", location: "The Old Mill" });
    assert.equal(met.ok, true, `modifier ${modifier}: ${met.error}`);
  }
  const rolls = listRecentRolls(staged.world.campaignId, 20).filter((roll) => /^2d6/.test(roll.expression));
  assert.equal(rolls.length, 5, `five reaction rolls on the record, found ${rolls.length}`);
  assert.deepEqual(rolls.map((roll) => roll.expression).sort(), ["2d6", "2d6+10", "2d6+4", "2d6-10", "2d6-3"]);
  for (const roll of rolls) {
    assert.ok(roll.total >= -8 && roll.total <= 22, `a 2d6 with a modifier of at most 10 either way: ${roll.total}`);
  }
  staged.world.close();
});

await test("every adjudication whose handler wants a fight says so, so the console greys it at a quiet table", () => {
  for (const name of ["aoe_damage", "use_reaction", "enemy_attack", "end_turn", "add_enemies", "end_encounter"]) {
    const entry = ADJUDICATIONS.find((candidate) => candidate.name === name);
    assert.ok(entry, name);
    assert.equal(entry.needsEncounter, true, `${name} is offered with no fight running`);
  }
});

if (process.env.ODM_CONSOLE_OUTCOMES) {
  fs.writeFileSync(process.env.ODM_CONSOLE_OUTCOMES, `${outcomes.join("\n")}\n`);
}

finish();
