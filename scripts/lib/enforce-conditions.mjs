// What the conditions, damage and death suites share: a table with a fight
// played in the theatre of the mind, a way to put a sheet back to a known
// state, and the dice the engine rolled in a form a test can compare.
//
// Import ./enforce-world.mjs first in the test file, as every enforcement
// suite does; this module only adds to the world it is handed.
const encounters = await import("../../src/lib/db/encounters.ts");
const maps = await import("../../src/lib/db/battle-maps.ts");
const turns = await import("../../src/lib/dm/encounter-tools.ts");
const { getDatabase } = await import("../../src/lib/db/core.ts");

export const FIGHTER_TRAINING = {
  saves: ["str", "con"],
  skills: ["athletics"],
  expertise: [],
  languages: ["Common"],
  tools: [],
  armor: [],
  weapons: ["simple", "martial"],
};

// A level 5 fighter with a sword and a bow: +3 STR, +2 DEX, +3 proficiency,
// so +6 to hit with either and 1d8+3 (sword) or 1d8+2 (bow) on a hit.
export const FIGHTER = {
  class: "fighter",
  level: 5,
  abilities: { str: 16, dex: 14, con: 14 },
  maxHp: 40,
  equipment: [
    { name: "Longsword", qty: 1 },
    { name: "Longbow", qty: 1 },
  ],
  proficiencies: FIGHTER_TRAINING,
};

export function kit(world) {
  // The generated board puts the party 60 ft from the enemy, and every
  // attack is then refused for range. These suites are about conditions and
  // damage, not distance, so the tokens come off and the fight is played
  // without a board, which the engine allows (no token, no spatial check).
  function offBoard() {
    const encounter = world.encounter();
    const map = encounter ? maps.getBattleMapForEncounter(encounter.id) : null;
    for (const token of map ? maps.listTokens(map.id) : []) {
      maps.deleteToken(token.id);
    }
  }

  // A clean action budget, so one test's swing is not refused for the last
  // test's spent action. The enemies' side of it is the ledger of who has
  // acted this round, which is wiped with it.
  function freshTurn() {
    const encounter = world.encounter();
    if (encounter) {
      encounter.turnBudget = null;
      encounter.reactionsUsed = [];
      if (encounter.legendary?.acted) {
        delete encounter.legendary.acted;
      }
      encounters.saveEncounter(encounter);
    }
  }

  function reset(id, extra = {}) {
    const sheet = world.sheet(id);
    return world.patch(id, {
      conditions: [],
      conditionMeta: {},
      exhaustion: 0,
      deathSaves: null,
      concentratingOn: null,
      currentHp: sheet.maxHp,
      tempHp: 0,
      ...extra,
    });
  }

  function enemy(id) {
    return world.enemies().find((entry) => entry.id === id);
  }

  function resetEnemy(id, conditions = [], meta = {}) {
    const row = enemy(id);
    encounters.patchEnemyHp(id, row.maxHp, "alive");
    encounters.patchEnemyConditions(id, conditions, meta);
    return enemy(id);
  }

  // Rewrites part of an enemy's stat block, so a suite can state the
  // resistances it is testing instead of hoping the content pack is there.
  // The row is the encounter's own snapshot; the bestiary is untouched.
  function setEnemyStats(id, patch) {
    const stats = { ...enemy(id).stats, ...patch };
    getDatabase()
      .prepare("UPDATE encounter_enemies SET stat_json = ? WHERE id = ?")
      .run(JSON.stringify(stats), id);
    return enemy(id);
  }

  // Every die the engine rolled since the last call, as "d20:17".
  function rolled() {
    return world.diceLog().map((die) => `d${die.sides}:${die.face}`);
  }

  // Queue dice, run one call, and hand back the outcome with the dice it
  // really rolled. Unused dice are dropped so they cannot leak onward.
  async function withDice(faces, name, args) {
    // An enemy acts once a round; these suites swing the same goblin many
    // times to read one rule after another, each as if the round were new.
    if (name === "enemy_attack") {
      freshTurn();
    }
    world.clearDice();
    world.diceLog();
    world.dice(...faces);
    const outcome = await world.invoke(name, args);
    const unused = world.clearDice();
    return { outcome, dice: rolled(), unused, result: outcome.ok ? outcome.result : null };
  }

  // A player's swing. The console names the target enemyId and the handler
  // reads targetEnemyId, so both are sent.
  function swing(faces, characterId, enemyId, args = {}) {
    freshTurn();
    return withDice(faces, "pc_attack", {
      characterId,
      enemyId,
      targetEnemyId: enemyId,
      ...args,
    });
  }

  function d20s(dice) {
    return dice.filter((die) => die.startsWith("d20:")).length;
  }

  return {
    offBoard,
    freshTurn,
    reset,
    enemy,
    resetEnemy,
    setEnemyStats,
    rolled,
    withDice,
    swing,
    d20s,
    // The player's own End Turn button and the lead's skip, which are the
    // two ways the initiative pointer moves without a model in the loop.
    endOwnTurn: (userId) => turns.endOwnTurn(world.campaignId, userId),
    skipTurn: () => turns.skipCurrentTurn(world.campaignId),
    pointer: () => {
      const encounter = world.encounter();
      const entry = encounter.order[encounter.turnIndex];
      return { round: encounter.round, id: entry?.characterId ?? entry?.enemyId ?? null };
    },
  };
}

// How an advantage state shows in the dice: one d20 for a straight roll, two
// for either state, and the kept face says which. With 3 then 17 queued the
// total tells advantage (17) from disadvantage (3).
export function stateFrom(dice, total, modifier) {
  const faces = dice.filter((die) => die.startsWith("d20:")).map((die) => Number(die.slice(4)));
  if (faces.length === 1) {
    return "none";
  }
  const kept = total - modifier;
  return kept === Math.max(...faces) ? "advantage" : "disadvantage";
}
