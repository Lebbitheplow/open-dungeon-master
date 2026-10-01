// Exhaustion on a creature (SRD 5.1, Appendix A: Conditions), the table the
// characters use: 1 disadvantage on ability checks, 2 speed halved, 3
// disadvantage on attack rolls and saving throws, 4 hit point maximum
// halved, 5 speed 0, 6 death. Kept on the creature as the condition
// "exhaustion N" (monster-abilities.ts enemyExhaustion reads it); the attack
// (enemy-attack.ts), the save (forced-save.ts rollEnemySave) and the walk
// (enemy-approach.ts, map-tools.ts) read the level from there.

import type { Campaign } from "@/lib/db/campaigns";
import type { DmTurn } from "@/lib/db/dm-turns";
import { getEnemy, patchEnemyConditions, patchEnemyHp, type Encounter, type EncounterEnemy } from "@/lib/db/encounters";
import { describeExhaustion, pruneMeta } from "@/lib/dm/condition-logic";
import { applyEnemyDamage, publishEncounter } from "@/lib/dm/enemy-damage";
import { enemyExhaustion, enemyHpCap } from "@/lib/dm/monster-abilities";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// Sets the creature's exhaustion to `level` (one more than it has when no
// level is sent), with what the new level does applied at once.
export function setEnemyExhaustion(
  campaign: Campaign,
  turn: DmTurn,
  encounter: Encounter,
  enemy: EncounterEnemy,
  level: number | undefined,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
): Record<string, unknown> {
  const next = Math.min(6, Math.max(1, level ?? enemyExhaustion(enemy.conditions) + 1));
  const condition = `exhaustion ${next}`;
  const conditions = [...enemy.conditions.filter((entry) => !/^exhaustion\b/i.test(entry.trim())), condition];
  patchEnemyConditions(enemy.id, conditions, pruneMeta(conditions, enemy.conditionMeta));
  const out: Record<string, unknown> = {
    ok: true,
    name: enemy.displayName,
    condition,
    effects: describeExhaustion(next),
  };
  const fresh = getEnemy(enemy.id) ?? { ...enemy, conditions };
  if (next >= 6) {
    Object.assign(out, applyEnemyDamage(campaign, turn, encounter, fresh, fresh.currentHp, sheets, sheetsById, undefined, { death: true }));
    out.note = `${enemy.displayName} dies of exhaustion (level 6). You may narrate its death.`;
    return out;
  }
  // Level 4 halves the maximum: hit points above the new maximum are lost.
  const cap = enemyHpCap(fresh);
  if (fresh.currentHp > cap) {
    patchEnemyHp(enemy.id, cap, "alive");
    out.hp = `${cap}/${cap}`;
  }
  publishEncounter(campaign.id);
  return out;
}
