// What the equipment enforcement suites share on top of enforce-world.mjs: a
// training dummy that survives a whole file of swings, a flat board a test
// lays out by hand, and one call that makes a swing with the dice forced.
//
// Import enforce-world.mjs first (it points the database at the scratch
// directory), then:
//
//   const kit = await gearKit(world);
//   const dummy = await kit.arena({ first: anchor.id });
//   kit.stand(hero.id, 1);                   // tiles from the dummy
//   const swing = await kit.swing(hero.id, { weapon: "Longsword" }, 10, 5);
//   swing.ok, swing.result.rolled, swing.d20s, swing.unused
//
// A character attacks on their own turn (off it they have one reaction), so
// kit.swing hands the floor to whoever swings: a suite that wants many
// swings from one character seats an "anchor" hero first in the order and
// swings with another, and each of those swings is made on a fresh turn of
// the swinger's own, the floor going back to the anchor afterwards. A suite
// about the economy itself swings with the anchor, whose turn is left as it
// stands, and calls kit.freshTurn() between cases.
import { clearDice, dice, diceLog } from "./enforce-world.mjs";

// AC 10 and more hit points than a file of tests can take off.
export const DUMMY_AC = 10;
export const DUMMY_HP = 900;

export const profs = (overrides = {}) => ({
  saves: [], skills: [], expertise: [], languages: ["Common"],
  tools: [], armor: [], weapons: [], ...overrides,
});

export async function gearKit(world) {
  const { getDatabase } = await import("../../src/lib/db/core.ts");
  const encounters = await import("../../src/lib/db/encounters.ts");
  const maps = await import("../../src/lib/db/battle-maps.ts");

  function board() {
    const encounter = world.encounter();
    return encounter ? maps.getBattleMapForEncounter(encounter.id) : null;
  }

  function dummy() {
    return world.enemies()[0] ?? null;
  }

  // A fight against one dummy on an open indoor floor. `first` acts first;
  // every other hero rolls low, and the dummy lowest of all.
  let anchorId = null;

  async function arena({ first } = {}) {
    anchorId = first ?? null;
    const faces = Object.fromEntries(
      world.sheets().map((sheet) => [sheet.id, sheet.id === first ? 20 : 3]),
    );
    await world.beginFight([{ monster: "goblin", count: 1 }], { heroFaces: faces, enemyFace: 1 });
    const enemy = dummy();
    const stats = { ...enemy.stats, ac: DUMMY_AC, resist: "", immune: "", vulnerable: "" };
    getDatabase()
      .prepare(
        `UPDATE encounter_enemies SET ac = ?, max_hp = ?, current_hp = ?, stat_json = ? WHERE id = ?`,
      )
      .run(DUMMY_AC, DUMMY_HP, DUMMY_HP, JSON.stringify(stats), enemy.id);
    const map = board();
    maps.setBattleMapTerrain(map.id, ".".repeat(map.width * map.height));
    maps.setBattleMapOutdoors(map.id, false);
    getDatabase().prepare(`UPDATE battle_maps SET doors_json = '{}' WHERE id = ?`).run(map.id);
    // The dummy in one corner, every hero in the far row until a test
    // stands them somewhere.
    maps.placeToken(maps.getTokenByRef(map.id, enemy.id).id, 0, 0);
    world.sheets().forEach((sheet, index) => {
      const token = maps.getTokenByRef(map.id, sheet.id);
      if (token) {
        maps.placeToken(token.id, map.width - 1 - index, map.height - 1);
      }
    });
    diceLog();
    return dummy();
  }

  // Stands a hero `tiles` from the dummy along the top row (5 ft a tile).
  // Heroes that share a distance are stacked down the column beside it.
  function stand(heroId, tiles, row = 0) {
    const map = board();
    const token = maps.getTokenByRef(map.id, heroId);
    if (!token) {
      throw new Error(`no token for ${heroId}`);
    }
    maps.placeToken(token.id, tiles, row);
  }

  // A new turn for whoever holds the floor: the budget the last one spent
  // is forgotten, as it is when the round comes back to them.
  function freshTurn() {
    const encounter = world.encounter();
    encounter.turnBudget = null;
    encounters.saveEncounter(encounter);
  }

  // Hands the floor to a hero for one call and gives it back: the pointer
  // goes to their place in the order with a fresh turn, and returns to where
  // it was, with the budget it held, once `run` is done. The anchor keeps
  // its own turn as it stands.
  async function onTurnOf(heroId, run) {
    const before = world.encounter();
    const place = before?.orderReady
      ? before.order.findIndex((entry) => entry.characterId === heroId)
      : -1;
    if (!before || place < 0 || heroId === anchorId || place === before.turnIndex) {
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

  // One pc_attack with the dice forced, made on the swinger's own turn.
  // Reports the d20 faces the engine rolled and how many queued dice it left
  // untouched.
  async function swing(heroId, args = {}, ...faces) {
    clearDice();
    diceLog();
    dice(...faces);
    const enemy = dummy();
    const outcome = await onTurnOf(heroId, () =>
      world.invoke("pc_attack", {
        characterId: heroId,
        enemyId: enemy.id,
        targetEnemyId: enemy.id,
        ...args,
      }),
    );
    const log = diceLog();
    const unused = clearDice();
    return {
      ...outcome,
      log,
      unused,
      d20s: log.filter((die) => die.sides === 20).map((die) => die.face),
      damageDice: log.filter((die) => die.sides !== 20).map((die) => die.sides),
    };
  }

  async function endFight() {
    clearDice();
    if (world.encounter()) {
      await world.invoke("end_encounter", { outcome: "truce" });
    }
    diceLog();
  }

  return { arena, stand, freshTurn, swing, onTurnOf, endFight, dummy, board };
}
