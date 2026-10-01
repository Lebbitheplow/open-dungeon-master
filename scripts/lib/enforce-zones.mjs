// What the spell-area suite shares (scripts/test-enforce-zones.mjs): a table
// with its own open board, a player's walk through the move route, an
// enemy's walk as the console moves it, the pointer moved on the way the
// table moves it, and the board's spell areas as the engine stores them.
//
// Import scripts/lib/enforce-world.mjs before this file.
import { layMap, onTurnOf } from "./enforce-spells.mjs";
import { table } from "./enforce-spell-kit.mjs";

const maps = await import("../../src/lib/db/battle-maps.ts");
const encounters = await import("../../src/lib/db/encounters.ts");
const { getDatabase } = await import("../../src/lib/db/core.ts");
const { skipCurrentTurn } = await import("../../src/lib/dm/encounter-tools.ts");

// An open board of 24 by 9 floor tiles.
export const OPEN = () => Array.from({ length: 9 }, () => ".".repeat(24));

// A table (enforce-spell-kit.mjs) on an open board, every combatant at the
// square `at` gives it (heroes by index, enemies as "e0", "e1"...). Enemies
// with no square stand in the far corner row.
export async function board(heroes, at, { count = 1, stats = {}, ambient = "bright" } = {}) {
  const staged = await table(heroes, count, stats);
  const positions = {};
  staged.sheets.forEach((sheet, index) => {
    positions[sheet.id] = at[index] ?? { x: 1 + index, y: 8 };
  });
  staged.enemies.forEach((enemy, index) => {
    positions[enemy.id] = at[`e${index}`] ?? { x: 23 - index, y: 8 };
  });
  const map = await layMap(staged.world, OPEN(), positions);
  if (ambient !== "bright") {
    // Under a roof, so the clock's daylight does not light it.
    getDatabase().prepare("UPDATE battle_maps SET ambient = ?, outdoors = 0 WHERE id = ?").run(ambient, map.id);
  }
  return staged;
}

export function mapOf(world) {
  const encounter = world.encounter();
  return encounter ? maps.getBattleMapForEncounter(encounter.id) : null;
}

export function tokenOf(world, refId) {
  const map = mapOf(world);
  return map ? maps.getTokenByRef(map.id, refId) : null;
}

export function place(world, refId, x, y) {
  const token = tokenOf(world, refId);
  maps.moveToken(token.id, x, y, 0);
}

// The spell areas on the board as the engine stores them.
export function zonesOf(world) {
  return mapOf(world)?.spellZones;
}

// A player walks their own token on their own turn, through the move route.
const moveRoute = await import("../../src/app/api/campaigns/[campaignId]/battle-map/move/route.ts");
export async function walk(world, heroId, x, y) {
  globalThis.__odmTestToken = (await import("../../src/lib/auth.ts")).mintSession(world.sheet(heroId).userId).token;
  return onTurnOf(world, heroId, async () => {
    const response = await moveRoute.POST(
      new Request(`http://odm.test/api/campaigns/${world.campaignId}/battle-map/move`, {
        method: "POST",
        body: JSON.stringify({ x, y }),
      }),
      { params: Promise.resolve({ campaignId: world.campaignId }) },
    );
    return { status: response.status, body: await response.json().catch(() => ({})) };
  });
}

// An enemy walks on its own, as the console's move_token moves it.
export const stride = (world, enemyId, x, y) => world.invoke("move_token", { tokenName: enemyId, x, y });

// The pointer rests on this hero from now on, with a fresh turn.
export function holdTurn(world, heroId) {
  const encounter = world.encounter();
  const place = encounter.order.findIndex((entry) => entry.characterId === heroId);
  encounters.saveEncounter({ ...encounter, turnIndex: place, turnBudget: null });
}

// The pointer moves on once, as ending the current turn does.
export const nextTurn = (world) => skipCurrentTurn(world.campaignId);

export const d20s = (log) => log.filter((die) => die.sides === 20).length;
