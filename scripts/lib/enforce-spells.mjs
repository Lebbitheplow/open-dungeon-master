// What the spell suites (scripts/test-enforce-spell-*.mjs, -casting*.mjs,
// -concentration.mjs) share: the SRD 5.1 slot tables written out by hand, a
// few casters with honest sheets, and the question every one of them asks
// first, "is the content pack answering?".
//
// The tables here are the rulebook's, typed from the SRD and never read from
// src/lib/srd/spell-slots.json, so a suite compares the engine to the rule.
// Import scripts/lib/enforce-world.mjs before this file.

// SRD 5.1, "Spell Slots per Spell Level": bard, cleric, druid, sorcerer and
// wizard. Index = character level - 1; each row is slot levels 1 to 9.
export const FULL_CASTER_SLOTS = [
  [2],
  [3],
  [4, 2],
  [4, 3],
  [4, 3, 2],
  [4, 3, 3],
  [4, 3, 3, 1],
  [4, 3, 3, 2],
  [4, 3, 3, 3, 1],
  [4, 3, 3, 3, 2],
  [4, 3, 3, 3, 2, 1],
  [4, 3, 3, 3, 2, 1],
  [4, 3, 3, 3, 2, 1, 1],
  [4, 3, 3, 3, 2, 1, 1],
  [4, 3, 3, 3, 2, 1, 1, 1],
  [4, 3, 3, 3, 2, 1, 1, 1],
  [4, 3, 3, 3, 2, 1, 1, 1, 1],
  [4, 3, 3, 3, 3, 1, 1, 1, 1],
  [4, 3, 3, 3, 3, 2, 1, 1, 1],
  [4, 3, 3, 3, 3, 2, 2, 1, 1],
];

// SRD 5.1, paladin and ranger: nothing at 1st level, then half the pace.
export const HALF_CASTER_SLOTS = [
  [],
  [2],
  [3],
  [3],
  [4, 2],
  [4, 2],
  [4, 3],
  [4, 3],
  [4, 3, 2],
  [4, 3, 2],
  [4, 3, 3],
  [4, 3, 3],
  [4, 3, 3, 1],
  [4, 3, 3, 1],
  [4, 3, 3, 2],
  [4, 3, 3, 2],
  [4, 3, 3, 3, 1],
  [4, 3, 3, 3, 1],
  [4, 3, 3, 3, 2],
  [4, 3, 3, 3, 2],
];

// The artificer is not SRD 5.1. ODM ships it, so its printed table (two 1st
// level slots from 1st level, then the half caster's row) is pinned too.
export const ARTIFICER_SLOTS = [[2], [2], ...HALF_CASTER_SLOTS.slice(2)];

// SRD 5.1, warlock Pact Magic: how many slots, and the one level they are.
export const PACT_SLOTS = [1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 3, 4, 4, 4, 4];
export const PACT_SLOT_LEVEL = [1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5];

// Eldritch Knight and Arcane Trickster (SRD 5.1 has neither subclass; both
// are PHB and ODM ships both): a third of the pace, from 3rd level.
export const THIRD_CASTER_SLOTS = [
  [],
  [],
  [2],
  [3],
  [3],
  [3],
  [4, 2],
  [4, 2],
  [4, 2],
  [4, 3],
  [4, 3],
  [4, 3],
  [4, 3, 2],
  [4, 3, 2],
  [4, 3, 2],
  [4, 3, 3],
  [4, 3, 3],
  [4, 3, 3],
  [4, 3, 3, 1],
  [4, 3, 3, 1],
];

export const FULL_CASTERS = ["bard", "cleric", "druid", "sorcerer", "wizard"];
export const HALF_CASTERS = ["paladin", "ranger"];
export const NON_CASTERS = ["barbarian", "fighter", "monk", "rogue"];

// A table row as the {level: max} record the engine speaks.
export const rowToTable = (row) =>
  Object.fromEntries(row.map((max, index) => [String(index + 1), max]));

// A table row as a sheet's slots, nothing spent.
export const slotsOf = (row) =>
  Object.fromEntries(row.map((max, index) => [String(index + 1), { max, used: 0 }]));

const PROFICIENCIES = { skills: [], expertise: [], languages: ["Common"], tools: [], armor: [], weapons: [] };

// Four casters the suites keep reaching for. Each is a sheet the builder
// could have produced: the class's slots for the level, its own saves, and a
// spell list inside its limits. `extra` overrides any field.
export function wizard(level = 5, extra = {}) {
  return {
    class: "wizard",
    level,
    abilities: { int: 16, con: 14, dex: 14 },
    proficiencies: { ...PROFICIENCIES, saves: ["int", "wis"] },
    ...extra,
    spellcasting: {
      ability: "int",
      slots: slotsOf(FULL_CASTER_SLOTS[level - 1]),
      known: [],
      prepared: ["Magic Missile", "Shield", "Mage Armor", "Burning Hands", "Hold Person", "Blur", "Fireball", "Haste"],
      cantrips: ["Fire Bolt", "Ray of Frost", "Shocking Grasp"],
      spellbook: ["Detect Magic", "Identify"],
      ...(extra.spellcasting ?? {}),
    },
  };
}

export function cleric(level = 5, extra = {}) {
  return {
    class: "cleric",
    level,
    abilities: { wis: 18, str: 14, con: 12 },
    proficiencies: { ...PROFICIENCIES, saves: ["wis", "cha"], weapons: ["simple"] },
    ...extra,
    spellcasting: {
      ability: "wis",
      slots: slotsOf(FULL_CASTER_SLOTS[level - 1]),
      known: [],
      prepared: ["Cure Wounds", "Healing Word", "Bless", "Bane", "Guiding Bolt", "Detect Magic", "Hold Person", "Spiritual Weapon", "Revivify"],
      cantrips: ["Sacred Flame", "Guidance", "Light"],
      ...(extra.spellcasting ?? {}),
    },
  };
}

export function sorcerer(level = 5, extra = {}) {
  return {
    class: "sorcerer",
    level,
    abilities: { cha: 16, con: 14 },
    proficiencies: { ...PROFICIENCIES, saves: ["con", "cha"] },
    ...extra,
    spellcasting: {
      ability: "cha",
      slots: slotsOf(FULL_CASTER_SLOTS[level - 1]),
      known: ["Magic Missile", "Shield", "Hold Person", "Blur", "Fireball", "Haste"],
      prepared: [],
      cantrips: ["Fire Bolt", "Ray of Frost", "Light", "Mage Hand", "Shocking Grasp"],
      ...(extra.spellcasting ?? {}),
    },
  };
}

export function warlock(level = 5, extra = {}) {
  return {
    class: "warlock",
    level,
    abilities: { cha: 16, con: 14 },
    proficiencies: { ...PROFICIENCIES, saves: ["wis", "cha"] },
    ...extra,
    spellcasting: {
      ability: "cha",
      slots: {
        [String(PACT_SLOT_LEVEL[level - 1])]: { max: PACT_SLOTS[level - 1], used: 0 },
      },
      known: ["Hex", "Hellish Rebuke", "Hold Person", "Misty Step", "Counterspell", "Fly"],
      prepared: [],
      cantrips: ["Eldritch Blast", "Chill Touch", "Mage Hand"],
      ...(extra.spellcasting ?? {}),
    },
  };
}

// Whether the Open5e content pack is answering. The SRD's own spells live
// there, not in the bundled JSON, so a rule that needs a spell's level, its
// ritual tag or its concentration flag can only be held while it is.
// world.hasPack says the file exists; this says the engine can read it.
export async function packAnswers() {
  const { findSpellByName } = await import("../../src/lib/content/index.ts");
  return findSpellByName("Fireball") !== null;
}

// A sheet sent to a creation route needs a portrait, or the server queues a
// real image render for it.
export const PORTRAIT = { url: "/uploads/enforce.png" };

// start_encounter draws a battle map and scatters the tokens at random, so
// the same cast is in range on one run and out of it on the next. A suite
// that is not about position fights with no map at all (no map, no spatial
// rules: src/lib/dm/map-tools.ts), and one that is lays its own.
export async function dropMap(world) {
  const { getDatabase } = await import("../../src/lib/db/core.ts");
  const encounter = world.encounter();
  if (!encounter) {
    return;
  }
  const db = getDatabase();
  db.prepare(
    "DELETE FROM battle_tokens WHERE map_id IN (SELECT id FROM battle_maps WHERE encounter_id = ?)",
  ).run(encounter.id);
  db.prepare("DELETE FROM battle_maps WHERE encounter_id = ?").run(encounter.id);
}

export async function fightWithoutMap(world, enemies, options = {}) {
  await world.beginFight(enemies, options);
  await dropMap(world);
  return world.encounter();
}

// The stat block every staged enemy is given, so a suite reads the same
// with the content pack and without it: AC 13, 90 hit points (enough to
// stand through a Fireball or three), every save at +0, immune to nothing.
export const DUMMY = {
  ac: 13,
  maxHp: 90,
  dexMod: 0,
  saveMods: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 },
  speed: "30 ft.",
  attacks: [{ name: "Club", toHit: 4, damage: "1d6+2", type: "bludgeoning" }],
  traits: [],
  resist: "",
  immune: "",
  vulnerable: "",
  conditionImmune: "",
  cr: 0.25,
  xp: 50,
  attacksPerTurn: 1,
  size: "Medium",
  type: "humanoid",
  abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
  skills: {},
  senses: { passivePerception: 10 },
};

// A fight against `count` dummies with no map, initiative in. They spawn as
// goblins (cheap enough for any party's encounter budget) and are rewritten
// to DUMMY. Returns them in name order: "Goblin 1", "Goblin 2", ...
export async function fightDummies(world, count = 1, options = {}) {
  const { getDatabase } = await import("../../src/lib/db/core.ts");
  const { stats = {}, ...rest } = options;
  await world.beginFight([{ monster: "goblin", count }], rest);
  await dropMap(world);
  const block = { ...DUMMY, ...stats };
  for (const enemy of world.enemies()) {
    getDatabase()
      .prepare("UPDATE encounter_enemies SET ac = ?, max_hp = ?, current_hp = ?, stat_json = ? WHERE id = ?")
      .run(block.ac, block.maxHp, block.maxHp, JSON.stringify(block), enemy.id);
  }
  world.diceLog();
  return world.enemies().sort((a, b) => a.displayName.localeCompare(b.displayName));
}

// A map of the test's own drawing: `rows` are strings of "." (floor) and "#"
// (wall), `positions` maps a sheet or enemy id to its square.
export async function layMap(world, rows, positions) {
  const maps = await import("../../src/lib/db/battle-maps.ts");
  await dropMap(world);
  const encounter = world.encounter();
  const map = maps.createBattleMap({
    encounterId: encounter.id,
    campaignId: world.campaignId,
    width: rows[0].length,
    height: rows.length,
    terrain: rows.join(""),
    ambient: "bright",
    theme: "field",
    lights: [],
    seed: 1,
  });
  const sheetIds = new Set(world.sheets().map((sheet) => sheet.id));
  for (const [refId, at] of Object.entries(positions)) {
    maps.insertToken({
      mapId: map.id,
      campaignId: world.campaignId,
      kind: sheetIds.has(refId) ? "pc" : "enemy",
      refId,
      name: refId,
      x: at.x,
      y: at.y,
    });
  }
  return map;
}

export const enemyNamed = (world, name) =>
  world.enemies().find((enemy) => enemy.displayName === name) ?? null;

// What a refused call must leave behind: the same sheet.
export const castingState = (sheet) =>
  JSON.stringify({
    slots: sheet.spellcasting?.slots ?? null,
    pact: sheet.spellcasting?.pact ?? null,
    concentratingOn: sheet.concentratingOn ?? null,
    conditions: sheet.conditions,
    currentHp: sheet.currentHp,
  });

// A cast takes its casting time out of the caster's turn (src/lib/dm/
// cast-guard.ts), so a suite that casts twice at one table between two
// rules starts each rule on a fresh turn: the budget the last one spent is
// forgotten and the reactions come back, as they do when the round returns.
export async function freshTurn(world) {
  const encounters = await import("../../src/lib/db/encounters.ts");
  const encounter = world.encounter();
  if (encounter) {
    encounters.saveEncounter({ ...encounter, turnBudget: null, reactionsUsed: [] });
  }
}

// Hands the initiative pointer to `heroId` with a fresh turn for the calls
// in `run`, and puts it back afterwards. Casting is done on the caster's own
// turn; a rule about something else should not trip on whose turn it is.
export async function onTurnOf(world, heroId, run) {
  const encounters = await import("../../src/lib/db/encounters.ts");
  const before = world.encounter();
  const place = before?.orderReady
    ? before.order.findIndex((entry) => entry.characterId === heroId)
    : -1;
  if (!before || place < 0) {
    return run();
  }
  const held = { turnIndex: before.turnIndex, turnBudget: before.turnBudget };
  encounters.saveEncounter({ ...before, turnIndex: place, turnBudget: null });
  try {
    return await run();
  } finally {
    const after = world.encounter();
    if (after) {
      encounters.saveEncounter({ ...after, ...held });
    }
  }
}

// Which argument names the caster, for each tool that casts.
const CASTER_ARG = {
  use_spell_slot: "characterId",
  cast_at_enemy: "characterId",
  cast_buff: "characterId",
  pc_attack: "characterId",
  aoe_damage: "casterId",
  heal: "casterId",
};

// For a suite whose rules are about lists, slots, dice and effects rather
// than turns: every cast is made on the caster's own turn, fresh, so a
// refusal it asserts is the refusal it is about and never "not your turn".
// `world.invokeAsIs` keeps the plain call for a rule that is about turns.
export function castOnOwnTurn(world) {
  const invoke = world.invoke;
  world.invokeAsIs = invoke;
  world.invoke = (name, args = {}) => {
    const key = CASTER_ARG[name];
    // A healing spell with no casterId is cast by the one it heals.
    const casterId = key ? (args[key] ?? (name === "heal" && args.spell ? args.characterId : null)) : null;
    return casterId ? onTurnOf(world, casterId, () => invoke(name, args)) : invoke(name, args);
  };
  return world;
}
