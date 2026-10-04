import { legendaryProfile } from "@/lib/dm/legendary-logic";
import { enemyActedThisRound, isSurprised } from "@/lib/dm/can-act";
import { isCompanionUserId } from "@/lib/db/users";
import { freshLastHit, type LastHit } from "@/lib/dm/last-hit";
import { conditionNote, conditionNoteLine, namesLookup } from "@/lib/battlemap/condition-notes";
import { healthState, type HealthState } from "@/lib/bestiary/health";
import { creatureTypeOf } from "@/lib/bestiary/statblock";
import { isRegeneratingDown } from "@/lib/dm/regeneration";
import { REGENERATION_STOPPED } from "@/lib/dm/monster-abilities";
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
  // DM view only. While the order is collected: who has rolled so far.
  staged?: Array<{ name: string; initiative: number }>;
  // DM view only: the enemies the pointer walked past that are due before
  // the player up next, the floor held for them (src/lib/dm/enemies-due.ts);
  // `acted` once one has taken its action.
  enemiesDue?: Array<{ id: string; name: string; acted: boolean }>;
  // Every view: the floor is held for the enemies' turns, which a hold for
  // table talk wrapping the fight's floor (held responses) is not.
  enemyTurns?: boolean;
  // DM view only: an AI companion is up, and nobody at the table holds it.
  companionTurn?: { id: string; name: string };
  order: Array<{
    kind: "pc" | "enemy" | "npc";
    id: string;
    name: string;
    hidden: boolean;
    // DM view only, like the enemy numbers below.
    initiative?: number;
    // Thief's Reflexes: the thief's second turn in the first round, a
    // second entry with the same id (so rows are keyed by position).
    reflex?: boolean;
  }>;
  enemies: Array<{
    id: string;
    name: string;
    health: HealthState;
    status: EnemyStatus;
    cr: number;
    // SRD creature type off the snapshot, for the thumbnail.
    type: string;
    // Kept off the players' board and tracker by the DM. Only ever true in
    // the DM's own projection: a hidden enemy is absent from a player's.
    hidden: boolean;
    // The mob this one belongs to: every enemy from the same stat block in
    // this fight shares it. Initiative never stopped on enemies
    // individually (advanceOrder walks past them all to the next PC), so
    // this is what lets the panel show a mob as one line the DM can open up
    // rather than four rows of the same goblin.
    groupKey: string;
    // Alive at 0 hit points after a nonlethal blow: out of the fight.
    knockedOut?: boolean;
    // Down at 0 hit points waiting to regenerate (a troll, regeneration.ts):
    // it rises at its turn, or dies then when `stopped` (acid or fire landed).
    regenerating?: { stopped: boolean };
    conditions: string[];
    conditionRounds: Record<string, number>;
    // "until Kael's turn", "save ends (WIS 13)", "from Kael", per condition.
    conditionNotes?: Record<string, string>;
    // DM view only; absent for every player.
    currentHp?: number;
    maxHp?: number;
    ac?: number;
    initiative?: number | null;
    // DM view only: legendary actions left this round and resistances
    // left this fight (docs/vtt-parity-implementation-plan.md 4.1).
    legendary?: { actions: number; actionsMax: number; resistances: number; resistancesMax: number };
  }>;
  // Whether the lair acts on initiative 20, and whether it has this round.
  lair?: { active: boolean; usedThisRound: boolean };
  // What the character whose turn it is has spent (src/lib/dm/action-budget.ts),
  // so the Hand and the board's turn pips show the engine's count rather than
  // a guess. Only ever a player character's: nothing here is hidden from the
  // table, and an enemy's economy stays the DM's.
  turn?: PublicTurn;
  // Who the pointer rests on, so a client can ask the engine's own canAct
  // (src/lib/dm/can-act.ts) the question the server will ask. The id is a
  // character's; any other combatant is named but not identified.
  acting?: { id: string; name: string } | null;
  // Characters surprised in round 1: those who may not act yet, and those who
  // may not react yet (isSurprised in can-act.ts, asked on the server).
  surprised?: { acting: string[]; reacting: string[] };
  // Characters whose reaction is spent until their next turn starts. A
  // reaction is spent on somebody else's turn, so it lives here and not in
  // the turn budget.
  reactionsUsed?: string[];
  // The attacks a reaction may still answer (src/lib/dm/last-hit.ts): one
  // per character hit this turn, while the engine would accept a reaction
  // to it. Absent keys mean nothing to answer.
  lastHits?: PublicLastHit[];
};

export type PublicTurn = {
  ownerId: string;
  actionUsed: boolean;
  bonusUsed: boolean;
  reactionUsed: boolean;
  attacksMade: number;
  attacksAllowed: number;
  extraActions?: number;
  // Action Surge's additional action, still to spend.
  grantedActions?: number;
  // The budget's once-per-turn marks (Sneak Attack spent, Martial Arts'
  // bonus strike open, a levelled or bonus-action spell cast, the creatures
  // attacked), so the Hand can ask the engine's own spend and cast rules.
  marks?: string[];
  // Flurry of Blows strikes bought and not yet made.
  flurryStrikes?: number;
  dashed?: boolean;
  disengaged?: boolean;
  // A levelled spell already cast this turn with this kind of action.
  castThisAction?: boolean;
};

export type PublicLastHit = {
  characterId: string;
  attacker: string;
  // The enemy that made it, when the player may know it (not hidden).
  attackerId: string | null;
  attack: string;
  type: string;
  ranged: boolean;
  source: "attack" | "fall";
  // Whether any swing hit, and the damage the hits sent.
  hit: boolean;
  damage: number;
  // Reactions already taken against it.
  answered: string[];
};

function turnView(encounter: Encounter): { turn?: PublicTurn } {
  const budget = encounter.turnBudget;
  if (!budget || budget.round !== encounter.round) {
    return {};
  }
  if (!encounter.order.some((entry) => entry.kind === "pc" && entry.characterId === budget.ownerId)) {
    return {};
  }
  return {
    turn: {
      ownerId: budget.ownerId,
      actionUsed: budget.actionUsed,
      bonusUsed: budget.bonusUsed,
      reactionUsed: budget.reactionUsed,
      attacksMade: budget.attacksMade,
      attacksAllowed: budget.attacksAllowed,
      ...(budget.extraActions ? { extraActions: budget.extraActions } : {}),
      ...(budget.grantedActions ? { grantedActions: budget.grantedActions } : {}),
      ...(budget.oncePerTurn.length ? { marks: budget.oncePerTurn } : {}),
      ...(budget.flurryStrikes ? { flurryStrikes: budget.flurryStrikes } : {}),
      ...(budget.dashed ? { dashed: true } : {}),
      ...(budget.disengaged ? { disengaged: true } : {}),
      ...(budget.castThisAction ? { castThisAction: true } : {}),
    },
  };
}

// The engine's own reading of whose turn it is, surprise and spent
// reactions, for the characters only: an enemy's id or its reaction is the
// DM's business, and a hidden one must not be given away.
function actingView(encounter: Encounter, hidden: Set<string>, showNumbers: boolean) {
  const pcIds = encounter.order
    .filter((entry) => entry.kind === "pc")
    .map((entry) => orderEntryId(entry));
  const current = encounter.orderReady ? encounter.order[encounter.turnIndex] : undefined;
  const concealed = current && !showNumbers && hidden.has(orderEntryId(current));
  return {
    acting: current
      ? {
          id: current.kind === "pc" ? current.characterId : "",
          name: concealed ? "someone unseen" : current.name,
        }
      : null,
    surprised: {
      acting: pcIds.filter((id) => isSurprised(encounter, id)),
      reacting: pcIds.filter((id) => isSurprised(encounter, id, true)),
    },
    reactionsUsed: encounter.reactionsUsed.filter((id) => pcIds.includes(id)),
  };
}

function lastHitView(record: LastHit, hidden: Set<string>, showNumbers: boolean): PublicLastHit {
  const attackerId = record.attacker.id;
  return {
    characterId: record.characterId,
    attacker: record.attacker.name,
    attackerId: attackerId && (showNumbers || !hidden.has(attackerId)) ? attackerId : null,
    attack: record.attack,
    type: record.type,
    ranged: record.ranged,
    source: record.source,
    hit: record.source === "fall" || record.swings.some((swing) => swing.hit),
    damage: record.swings.reduce((sum, swing) => sum + (swing.hit ? swing.raw : 0), 0),
    answered: record.answered,
  };
}

export function publicEncounter(
  encounter: Encounter,
  enemies: EncounterEnemy[],
  options: { enemyNumbers?: boolean; hiddenRefIds?: string[]; lastHits?: LastHit[] } = {},
): PublicEncounter {
  const showNumbers = options.enemyNumbers === true;
  // Hidden is one flag on the board token (src/lib/db/battle-maps.ts) and it
  // means the same thing in both places: an ambusher the players have not
  // met yet is neither on the map nor on the tracker.
  const hidden = new Set(options.hiddenRefIds ?? []);
  // Names a condition's "until X's turn" or "from X" may show: the order as
  // this viewer sees it.
  const nameOf = namesLookup(
    encounter.order
      .filter((entry) => showNumbers || !hidden.has(orderEntryId(entry)))
      .map((entry) => ({ id: orderEntryId(entry), name: entry.name })),
  );
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
            ...(entry.kind === "pc" && entry.reflex ? { reflex: true } : {}),
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
      type: creatureTypeOf(enemy.stats),
      groupKey: enemy.slug,
      // Knocked out by a nonlethal blow (src/lib/dm/knockout.ts): alive at
      // 0 hit points, out of the fight, not dying.
      ...(knockedOut(enemy) ? { knockedOut: true } : {}),
      ...(enemy.status === "alive" && isRegeneratingDown(enemy)
        ? { regenerating: { stopped: enemy.conditions.includes(REGENERATION_STOPPED) } }
        : {}),
      conditions: enemy.status === "alive" ? enemy.conditions : [],
      conditionRounds:
        enemy.status === "alive"
          ? Object.fromEntries(
              Object.entries(enemy.conditionMeta)
                .filter(([, meta]) => typeof meta.rounds === "number")
                .map(([name, meta]) => [name, meta.rounds as number]),
            )
          : {},
      // The rest of what each condition's metadata says: a turn it ends on,
      // the save that ends it, who laid it (condition-notes.ts).
      conditionNotes:
        enemy.status === "alive"
          ? Object.fromEntries(
              enemy.conditions.flatMap((name) => {
                const line = conditionNoteLine(conditionNote(name, enemy.conditionMeta[name], nameOf, enemy.id), {
                  skipCounted: true,
                });
                return line ? [[name, line]] : [];
              }),
            )
          : {},
      ...(showNumbers
        ? {
            currentHp: enemy.currentHp,
            maxHp: enemy.maxHp,
            ac: enemy.ac,
            initiative: enemy.initiative,
            ...legendaryView(encounter, enemy),
          }
        : {}),
    })),
    ...(encounter.legendary.lair
      ? { lair: { active: true, usedThisRound: encounter.legendary.lairUsedRound === encounter.round } }
      : {}),
    ...turnView(encounter),
    ...actingView(encounter, hidden, showNumbers),
    ...(encounter.orderReady && encounter.legendary.due?.length ? { enemyTurns: true } : {}),
    ...(showNumbers ? dmTurnView(encounter, enemies) : {}),
    ...(options.lastHits?.length
      ? { lastHits: options.lastHits.map((record) => lastHitView(record, hidden, showNumbers)) }
      : {}),
  };
}

// What the person running the fight is waiting on: the rolls so far while
// the order is collected, the enemies due, an AI companion up.
function dmTurnView(encounter: Encounter, enemies: EncounterEnemy[]) {
  if (!encounter.orderReady) {
    const staged = encounter.order.flatMap((entry) =>
      entry.kind === "pc" ? [{ name: entry.name, initiative: entry.initiative }] : [],
    );
    return staged.length ? { staged } : {};
  }
  const names = new Map(enemies.map((enemy) => [enemy.id, enemy.displayName]));
  const due = (encounter.legendary.due ?? []).flatMap((id) =>
    names.has(id) ? [{ id, name: names.get(id) as string, acted: enemyActedThisRound(encounter, id) }] : [],
  );
  const current = encounter.order[encounter.turnIndex];
  return {
    ...(due.length ? { enemiesDue: due } : {}),
    ...(current?.kind === "pc" && isCompanionUserId(current.userId)
      ? { companionTurn: { id: current.characterId, name: current.name } }
      : {}),
  };
}

function knockedOut(enemy: EncounterEnemy): boolean {
  return (
    enemy.status === "alive" &&
    enemy.currentHp <= 0 &&
    enemy.conditionMeta.unconscious?.source === "knocked out"
  );
}

function legendaryView(encounter: Encounter, enemy: EncounterEnemy) {
  const pool = encounter.legendary.pools[enemy.id];
  const profile = pool ? legendaryProfile(enemy.stats) : null;
  if (!pool || !profile) {
    return {};
  }
  return {
    legendary: {
      actions: pool.actions,
      actionsMax: profile.actionsPerRound,
      resistances: pool.resistances,
      resistancesMax: profile.resistances,
    },
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
  // Only records a reaction may still answer: the engine's own freshness
  // rule (same round and turn), asked per character in the order.
  const lastHits = encounter.order.flatMap((entry) => {
    if (entry.kind !== "pc") {
      return [];
    }
    const record = freshLastHit(campaignId, entry.characterId);
    return record ? [record] : [];
  });
  return publicEncounter(encounter, listEnemies(encounter.id), {
    ...options,
    lastHits,
    hiddenRefIds: map ? listHiddenRefIds(map.id) : [],
  });
}
