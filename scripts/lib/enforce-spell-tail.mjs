// What the tail spell suites share (scripts/test-enforce-spell-tail.mjs,
// scripts/test-enforce-spell-hooks.mjs, scripts/test-enforce-caster-features.mjs):
// a token's square on a laid map, an enemy's swing as the console makes it,
// and the initiative pointer moved on as the table moves it.
//
// Import scripts/lib/enforce-world.mjs before this file.

const maps = await import("../../src/lib/db/battle-maps.ts");
const { skipCurrentTurn } = await import("../../src/lib/dm/encounter-tools.ts");

// Where a combatant's token stands now, or null with no map.
export function squareOf(world, refId) {
  const encounter = world.encounter();
  const map = encounter ? maps.getBattleMapForEncounter(encounter.id) : null;
  const token = map ? maps.getTokenByRef(map.id, refId) : null;
  return token ? [token.x, token.y] : null;
}

// One enemy swing at a character, as the DM console calls it.
export const enemySwing = (world, enemyId, characterId) =>
  world.invoke("enemy_attack", { enemyId, targetCharacterId: characterId });

// The pointer moves on once, as ending the current turn does.
export const nextTurn = (world) => skipCurrentTurn(world.campaignId);

// The d20s among the dice rolled since the last look.
export const d20s = (log) => log.filter((die) => die.sides === 20).length;
