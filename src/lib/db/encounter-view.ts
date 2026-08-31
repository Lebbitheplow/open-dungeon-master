import { healthState, type HealthState } from "@/lib/bestiary/health";
import { getBattleMapForEncounter, listHiddenRefIds } from "@/lib/db/battle-maps";
import {
  getActiveEncounter,
  listEnemies,
  orderEntryId,
  type Encounter,
  type EncounterEnemy,
  type EncounterStatus,
  type EnemyStatus,
} from "@/lib/db/encounters";

// What a client is allowed to know about a fight. Split out of
// encounters.ts, which is persistence: this is the projection, and it is the
// only shape that ever leaves the server.

// Client-safe projection: vague health states only, no HP numbers, no stats.
//
// The one exception is the person running the fight. A human DM cannot run
// an encounter from "bloodied", so when `enemyNumbers` is granted the real
// hit points, AC and initiative ride along. That grant comes from
// src/lib/dm/viewer.ts and is never a raw id comparison here.
export type PublicEncounter = {
  id: string;
  status: EncounterStatus;
  round: number;
  turnIndex: number;
  orderReady: boolean;
  order: Array<{
    kind: "pc" | "enemy" | "npc";
    id: string;
    name: string;
    hidden: boolean;
    // DM view only, like the enemy numbers below.
    initiative?: number;
  }>;
  enemies: Array<{
    id: string;
    name: string;
    health: HealthState;
    status: EnemyStatus;
    cr: number;
    // Kept off the players' board and tracker by the DM. Only ever true in
    // the DM's own projection: a hidden enemy is absent from a player's.
    hidden: boolean;
    // The mob this one belongs to: every enemy from the same stat block in
    // this fight shares it. Initiative never stopped on enemies
    // individually (advanceOrder walks past them all to the next PC), so
    // this is what lets the panel show a mob as one line the DM can open up
    // rather than four rows of the same goblin.
    groupKey: string;
    conditions: string[];
    conditionRounds: Record<string, number>;
    // DM view only; absent for every player.
    currentHp?: number;
    maxHp?: number;
    ac?: number;
    initiative?: number | null;
  }>;
};

export function publicEncounter(
  encounter: Encounter,
  enemies: EncounterEnemy[],
  options: { enemyNumbers?: boolean; hiddenRefIds?: string[] } = {},
): PublicEncounter {
  const showNumbers = options.enemyNumbers === true;
  // Hidden is one flag on the board token (src/lib/db/battle-maps.ts) and it
  // means the same thing in both places: an ambusher the players have not
  // met yet is neither on the map nor on the tracker.
  const hidden = new Set(options.hiddenRefIds ?? []);
  return {
    id: encounter.id,
    status: encounter.status,
    round: encounter.round,
    turnIndex: encounter.turnIndex,
    orderReady: encounter.orderReady,
    order: encounter.orderReady
      ? encounter.order
          // A hidden combatant is not on the players' tracker at all. The DM
          // gets the whole order, marked, because they are the one hiding it.
          .filter((entry) => showNumbers || !hidden.has(orderEntryId(entry)))
          .map((entry) => ({
            kind: entry.kind,
            id: orderEntryId(entry),
            name: entry.name,
            hidden: hidden.has(orderEntryId(entry)),
            // The count itself rides along only for the seat that may edit
            // it. Players hear initiative announced; they do not need a
            // column of it, and the tracker has never shown one.
            ...(showNumbers ? { initiative: entry.initiative } : {}),
          }))
      : [],
    enemies: enemies
      .filter((enemy) => showNumbers || !hidden.has(enemy.id))
      .map((enemy) => ({
      id: enemy.id,
      hidden: hidden.has(enemy.id),
      name: enemy.displayName,
      health: enemy.status === "fled" ? "healthy" : healthState(enemy.currentHp, enemy.maxHp),
      status: enemy.status,
      cr: enemy.cr,
      groupKey: enemy.slug,
      conditions: enemy.status === "alive" ? enemy.conditions : [],
      conditionRounds:
        enemy.status === "alive"
          ? Object.fromEntries(
              Object.entries(enemy.conditionMeta)
                .filter(([, meta]) => typeof meta.rounds === "number")
                .map(([name, meta]) => [name, meta.rounds as number]),
            )
          : {},
      ...(showNumbers
        ? {
            currentHp: enemy.currentHp,
            maxHp: enemy.maxHp,
            ac: enemy.ac,
            initiative: enemy.initiative,
          }
        : {}),
    })),
  };
}

export function activePublicEncounter(
  campaignId: string,
  options: { enemyNumbers?: boolean } = {},
): PublicEncounter | null {
  const encounter = getActiveEncounter(campaignId);
  if (!encounter) {
    return null;
  }
  const map = getBattleMapForEncounter(encounter.id);
  return publicEncounter(encounter, listEnemies(encounter.id), {
    ...options,
    hiddenRefIds: map ? listHiddenRefIds(map.id) : [],
  });
}
