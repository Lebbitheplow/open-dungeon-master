import { getDatabase } from "@/lib/db/core";
import { getEncounter, getEnemy, listEnemies, type Encounter, type EncounterEnemy } from "@/lib/db/encounters";

// Where a creature fought before (issue #667). Every fight's enemy rows are
// kept when it ends, and a creature that comes back to a later fight gets a
// new row that names the one it came from (carried_from), so its history
// is a chain of rows. These read that chain; src/lib/dm/foe-return.ts
// decides what a creature brings from it.

function enemyIds(sql: string, ...params: string[]): string[] {
  return (getDatabase().prepare(sql).all(...params) as Array<{ id: string }>).map((row) => row.id);
}

// The row that carried on from this one into a later fight, if any.
export function carriedOnward(enemyId: string): EncounterEnemy | null {
  const [id] = enemyIds(`SELECT id FROM encounter_enemies WHERE carried_from = ? ORDER BY created_at DESC LIMIT 1`, enemyId);
  return id ? getEnemy(id) : null;
}

// A creature's newest appearance, following its chain from any row of it:
// an id from two fights ago still finds the creature as it is now.
export function latestAppearance(enemyId: string): EncounterEnemy | null {
  let row = getEnemy(enemyId);
  // A chain is one row a fight; the bound only stops a loop no writer makes.
  for (let step = 0; row && step < 200; step += 1) {
    const next = carriedOnward(row.id);
    if (!next) {
      return row;
    }
    row = next;
  }
  return row;
}

// A Cast NPC's newest row in any fight of this campaign.
export function lastAppearanceOfNpc(campaignId: string, npcId: string): EncounterEnemy | null {
  if (!npcId) {
    return null;
  }
  const [id] = enemyIds(
    `SELECT id FROM encounter_enemies WHERE campaign_id = ? AND npc_id = ? ORDER BY created_at DESC LIMIT 1`,
    campaignId,
    npcId,
  );
  return id ? getEnemy(id) : null;
}

// The fight that ended last (by when it began), and its creatures still
// living that no later fight has brought back: who is still about.
export function survivorsOfLastFight(campaignId: string): { encounter: Encounter; survivors: EncounterEnemy[] } | null {
  const [id] = enemyIds(
    `SELECT id FROM encounters WHERE campaign_id = ? AND status = 'ended' AND kind = 'fight' ORDER BY created_at DESC LIMIT 1`,
    campaignId,
  );
  const encounter = id ? getEncounter(id) : null;
  if (!encounter) {
    return null;
  }
  const survivors = listEnemies(encounter.id).filter((enemy) => enemy.status !== "dead" && !carriedOnward(enemy.id));
  return { encounter, survivors };
}
