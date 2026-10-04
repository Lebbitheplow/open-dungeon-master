// What the combat enforcement suites share on top of enforce-world.mjs: a
// board a test can lay out by hand, enemies whose numbers a test can set, and
// the two ways a turn ends.
//
// Import enforce-world.mjs first (it points the database at the scratch
// directory), then:
//
//   const kit = await combatKit(world);
//   kit.openField();                         // every tile floor, no cover
//   kit.place(hero.id, 2, 2);                // a token by sheet or enemy id
//   kit.setEnemy(enemy.id, { ac: 15, currentHp: 40, stats: { size: "Huge" } });
//   kit.endTurn(world.owner.id);             // the player's End Turn button
//   kit.handOnEnemies();                     // the lead's "Hand on the turn"
//
// Enemies spawn as goblins and are then rewritten to one fixed stat block
// (DUMMY below), so the suites read the same with and without the content
// pack:
//   await kit.fight(2)                       // two dummies, initiative in
import { clearDice, dice, diceLog } from "./enforce-world.mjs";

// The stat block every staged enemy is given. AC 13, 40 hit points, one
// melee attack at +4 for 1d6+2, no resistances, Medium, passive Perception 10.
export const DUMMY = {
  ac: 13,
  maxHp: 40,
  dexMod: 0,
  saveMods: { str: 1, dex: 0, con: 1, int: 0, wis: 0, cha: 0 },
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
  abilities: { str: 12, dex: 10, con: 12, int: 10, wis: 10, cha: 10 },
  skills: {},
  senses: { passivePerception: 10 },
};

// Weapon and armor training wide enough that a test's attack is never an
// untrained one by accident.
export const TRAINED = {
  saves: [],
  skills: [],
  expertise: [],
  languages: ["Common"],
  tools: [],
  armor: ["light", "medium", "heavy", "shields"],
  weapons: ["simple", "martial"],
};

export async function combatKit(world) {
  const { getDatabase } = await import("../../src/lib/db/core.ts");
  const encounters = await import("../../src/lib/db/encounters.ts");
  const maps = await import("../../src/lib/db/battle-maps.ts");
  const tools = await import("../../src/lib/dm/encounter-tools.ts");
  const { onPersonsTurn } = await import("../../src/lib/dm/invoke.ts");
  const rolls = await import("../../src/lib/db/rolls.ts");

  const db = () => getDatabase();

  function map() {
    const encounter = world.encounter();
    return encounter ? maps.getBattleMapForEncounter(encounter.id) : null;
  }

  // Writes straight to the enemy row: the numbers a rule is tested against
  // are the test's to choose, the way a prepared encounter chooses them.
  function setEnemy(enemyId, patch = {}) {
    const enemy = encounters.getEnemy(enemyId);
    if (!enemy) {
      throw new Error(`no enemy ${enemyId}`);
    }
    const stats = { ...enemy.stats, ...(patch.stats ?? {}) };
    if (patch.ac !== undefined) {
      stats.ac = patch.ac;
    }
    db()
      .prepare(
        `UPDATE encounter_enemies SET ac = ?, max_hp = ?, current_hp = ?, cr = ?, xp = ?,
         stat_json = ?, conditions_json = ?, condition_meta_json = ? WHERE id = ?`,
      )
      .run(
        patch.ac ?? enemy.ac,
        patch.maxHp ?? enemy.maxHp,
        patch.currentHp ?? patch.maxHp ?? enemy.currentHp,
        stats.cr,
        stats.xp,
        JSON.stringify(stats),
        JSON.stringify(patch.conditions ?? enemy.conditions),
        JSON.stringify(patch.conditionMeta ?? enemy.conditionMeta ?? {}),
        enemyId,
      );
    return encounters.getEnemy(enemyId);
  }

  // Every tile floor: no walls, no cover, no difficult ground. `paint` is a
  // list of [x, y, char] laid over it.
  function openField(paint = []) {
    const board = map();
    const tiles = new Array(board.width * board.height).fill(".");
    for (const [x, y, ch] of paint) {
      tiles[y * board.width + x] = ch;
    }
    maps.setBattleMapTerrain(board.id, tiles.join(""));
    db().prepare(`UPDATE battle_maps SET doors_json = '{}' WHERE id = ?`).run(board.id);
    return map();
  }

  function token(refId) {
    return maps.getTokenByRef(map().id, refId);
  }

  // Puts a token down without spending movement.
  function place(refId, x, y, moved = 0) {
    const found = token(refId);
    if (!found) {
      throw new Error(`no token for ${refId}`);
    }
    maps.moveToken(found.id, x, y, moved);
    return token(refId);
  }

  // Parks every token along the far edge, three squares apart, so a test
  // places only the ones its rule is about and nobody stands next to anybody
  // by accident. The generated board puts them somewhere new every fight.
  function scatter() {
    const board = map();
    const perRow = Math.floor(board.width / 3);
    maps.listTokens(board.id).forEach((entry, index) => {
      const x = board.width - 1 - (index % perRow) * 3;
      const y = board.height - 1 - Math.floor(index / perRow) * 3;
      maps.moveToken(entry.id, x, y, 0);
    });
  }

  // A fight against `count` dummies on an open field, initiative in, with
  // nobody standing next to anybody.
  async function fight(count = 1, options = {}) {
    await world.beginFight([{ monster: "goblin", count }], options);
    for (const enemy of world.enemies()) {
      setEnemy(enemy.id, { ac: DUMMY.ac, maxHp: DUMMY.maxHp, stats: { ...DUMMY } });
    }
    openField();
    scatter();
    diceLog();
    return world.encounter();
  }

  // A player's attack. The console's form calls the target `enemyId` and the
  // handler reads `targetEnemyId` (see the gap in test-enforce-turn-order),
  // so both are sent.
  function attack(characterId, enemyId, args = {}) {
    return world.invoke("pc_attack", { characterId, enemyId, targetEnemyId: enemyId, ...args });
  }

  // An attack with its dice forced, and the two rolls it stored: `toHit`
  // always, `damage` on a hit. `unused` counts forced faces nothing rolled,
  // `rolled` lists the faces the engine took, in order.
  async function swing(characterId, enemyId, faces = [], args = {}) {
    clearDice();
    diceLog();
    const before = new Set(rolls.listRecentRolls(world.campaignId, 40).map((roll) => roll.id));
    dice(...faces);
    const out = await attack(characterId, enemyId, args);
    const unused = clearDice();
    const made = rolls
      .listRecentRolls(world.campaignId, 40)
      .filter((roll) => !before.has(roll.id));
    return {
      out,
      ok: out.ok,
      error: out.error,
      result: out.result ?? {},
      toHit: made.find((roll) => roll.kind === "attack") ?? null,
      damage: made.find((roll) => roll.kind === "damage") ?? null,
      unused,
      rolled: diceLog().map((die) => die.face),
    };
  }

  // Puts the initiative pointer on a character, with a fresh turn, without
  // walking the order there. A character acts on their own turn (off it they
  // have one reaction), so a test about what an attack DOES gives its
  // attacker the floor first.
  function giveTurn(characterId) {
    const encounter = world.encounter();
    const place = encounter?.orderReady
      ? encounter.order.findIndex((entry) => entry.characterId === characterId)
      : -1;
    if (place < 0) {
      throw new Error(`no place in the order for ${characterId}`);
    }
    encounters.saveEncounter({
      ...encounter,
      turnIndex: place,
      turnBudget: null,
      reactionsUsed: encounter.reactionsUsed.filter((id) => id !== characterId),
    });
    return world.encounter();
  }

  // A new turn for whoever holds the floor: what the last one spent is
  // forgotten, as it is when the round comes back to them.
  function freshTurn() {
    const encounter = world.encounter();
    encounters.saveEncounter({ ...encounter, turnBudget: null });
  }

  // A new round for the enemies: whoever has taken their action has it
  // back, as when the order wraps. An enemy acts once a round, so a test
  // that has one enemy attack several times calls this between attacks.
  function freshRound() {
    const encounter = world.encounter();
    const legendary = { ...encounter.legendary };
    delete legendary.acted;
    encounters.saveEncounter({ ...encounter, legendary });
  }

  // The player's own End Turn, without the DM wake the route adds. The
  // button waits for the enemies a pass left due (src/lib/dm/enemies-due.ts):
  // here the lead hands the turn on from the banner first, ending their
  // turns unplayed, as the next pass used to. A suite pinning the wait
  // calls endOwnTurn itself.
  function endTurn(userId) {
    handOnEnemies();
    return tools.endOwnTurn(world.campaignId, userId);
  }

  function handOnEnemies() {
    if (world.encounter()?.legendary.due?.length) {
      const campaign = world.campaign();
      onPersonsTurn(campaign, (turn) => tools.handOnEnemyTurns(campaign, turn, false));
    }
  }

  // Ends whatever fight is running, so one file can stage several.
  async function endFight() {
    clearDice();
    if (world.encounter()) {
      await world.invoke("end_encounter", { outcome: "truce" });
    }
    for (const sheet of world.sheets()) {
      world.patch(sheet.id, {
        currentHp: sheet.maxHp,
        tempHp: 0,
        conditions: [],
        conditionMeta: {},
        exhaustion: 0,
      });
    }
    diceLog();
  }

  // The last rolls the engine stored, newest first.
  function lastRolls(count = 1) {
    return rolls.listRecentRolls(world.campaignId, count);
  }

  function current() {
    const encounter = world.encounter();
    return encounter?.orderReady ? encounter.order[encounter.turnIndex] : null;
  }

  return {
    dice,
    map,
    setEnemy,
    openField,
    token,
    place,
    scatter,
    fight,
    attack,
    swing,
    endTurn,
    handOnEnemies,
    giveTurn,
    freshTurn,
    freshRound,
    endFight,
    lastRolls,
    current,
    enemy: (id) => encounters.getEnemy(id),
    saveEncounter: encounters.saveEncounter,
  };
}

// A d20 expression's faces, as the engine stored them on a roll.
export function d20Faces(roll) {
  const term = roll?.breakdown?.terms?.find((entry) => entry.sides === 20);
  return term ? term.dice.map((die) => die.value) : [];
}
