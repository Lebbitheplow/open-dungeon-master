// A troll's Regeneration (SRD 5.1): "The troll dies only if it starts its
// turn with 0 hit points and doesn't regenerate." A blow that takes such a
// creature to 0 leaves it down, not dead: unconscious at 0 hit points, still
// in the fight. At the start of its turn it regenerates and rises, unless
// the damage that stops its Regeneration (acid or fire for a troll) landed
// since its last turn, and then it dies. Pure; enemy-damage.ts and
// regeneration-turn.ts apply it.

import type { ConditionMetaMap } from "@/lib/dm/condition-logic";
import { regenerationOf, type Regeneration } from "@/lib/dm/monster-abilities";

// The source written on the unconscious condition of a creature lying at 0
// waiting to regenerate. Not a knockout (knockout.ts): the fight goes on.
export const REGENERATING = "regenerating";

type Downable = { stats: { regeneration?: Regeneration; traits?: string[] } };

// Whether 0 hit points leaves this creature down rather than dead.
export function fallsRegenerating(enemy: Downable): boolean {
  return regenerationOf(enemy.stats)?.diesOnlyAtTurnStart === true;
}

// The conditions a creature down at 0 lies under: unconscious (which is
// prone as well), marked as the regenerating kind.
export function regeneratingDown(conditions: string[], meta: ConditionMetaMap | undefined): {
  conditions: string[];
  meta: ConditionMetaMap;
} {
  const kept = conditions.filter((entry) => !["unconscious", "prone"].includes(entry.trim().toLowerCase()));
  const next = { ...(meta ?? {}) };
  next.unconscious = { source: REGENERATING };
  delete next.prone;
  return { conditions: [...kept, "unconscious", "prone"], meta: next };
}

// Whether the creature lies down waiting to regenerate.
export function isRegeneratingDown(enemy: { currentHp: number; conditions: string[]; conditionMeta?: ConditionMetaMap }): boolean {
  if (enemy.currentHp > 0) {
    return false;
  }
  const unconscious = enemy.conditions.find((entry) => entry.trim().toLowerCase() === "unconscious");
  return Boolean(unconscious && enemy.conditionMeta?.[unconscious]?.source === REGENERATING);
}

// Getting up: the unconscious of the regenerating kind goes, and the prone
// that came with it (standing costs the creature half its speed as usual,
// src/lib/dm/enemy-approach.ts, so prone stays until it stands).
export function risenConditions(conditions: string[], meta: ConditionMetaMap | undefined): {
  conditions: string[];
  meta: ConditionMetaMap;
} {
  const next = { ...(meta ?? {}) };
  const unconscious = conditions.find((entry) => entry.trim().toLowerCase() === "unconscious");
  if (unconscious && next[unconscious]?.source === REGENERATING) {
    delete next[unconscious];
    return { conditions: conditions.filter((entry) => entry !== unconscious), meta: next };
  }
  return { conditions, meta: next };
}
