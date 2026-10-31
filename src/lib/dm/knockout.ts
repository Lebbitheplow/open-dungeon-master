// Knocking a creature out instead of killing it (SRD 5.1, Knocking a
// Creature Out): a melee attacker that drops a creature to 0 hit points may
// leave it unconscious and stable. The enemy row keeps status "alive" at 0
// hit points with the unconscious condition, sourced "knocked out"; that
// pair is what every reader asks. Pure, database-free.

import type { ConditionMetaMap } from "@/lib/dm/condition-logic";

export const KNOCKED_OUT = "knocked out";

type EnemyShape = {
  status: string;
  currentHp: number;
  conditions: string[];
  conditionMeta?: ConditionMetaMap | Record<string, { source?: string } | undefined>;
};

// A creature knocked out: alive, at 0, unconscious by the knockout.
export function isKnockedOut(enemy: EnemyShape): boolean {
  if (enemy.status !== "alive" || enemy.currentHp > 0) {
    return false;
  }
  const meta = (enemy.conditionMeta ?? {}) as Record<string, { source?: string } | undefined>;
  return enemy.conditions.some(
    (entry) => entry.trim().toLowerCase() === "unconscious" && meta[entry]?.source === KNOCKED_OUT,
  );
}

// Out of the fight: dead, fled, or knocked out. What victory counts.
export function isDefeated(enemy: EnemyShape): boolean {
  return enemy.status !== "alive" || isKnockedOut(enemy);
}

// The conditions and meta a knockout leaves: unconscious (which is prone as
// well) and nothing else of what it held on to. `wakeAfterHours` is the 1d4
// the blow rolled for the hours until it comes to with 1 hit point, kept so
// a later fight finds it as the clock left it (issue #667).
export function knockedOutConditions(enemy: EnemyShape, wakeAfterHours?: number): {
  conditions: string[];
  meta: ConditionMetaMap;
} {
  const conditions = [
    ...enemy.conditions.filter((entry) => !["unconscious", "prone"].includes(entry.trim().toLowerCase())),
    "unconscious",
    "prone",
  ];
  const meta = { ...((enemy.conditionMeta ?? {}) as ConditionMetaMap) };
  meta.unconscious = { source: KNOCKED_OUT, ...(wakeAfterHours ? { wakeAfterHours } : {}) };
  delete meta.prone;
  return { conditions, meta };
}
