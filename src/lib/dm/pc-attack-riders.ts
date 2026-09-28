// What rides a player's attack and is paid for by it: a Battle Master's
// maneuver and a paladin's smite, both spent when the hit is known, and the
// conditions a rider can leave on the target. Split from pc-attack.ts, which
// decides the attack these belong to.

import type { Campaign } from "@/lib/db/campaigns";
import type { PendingAttack } from "@/lib/db/dm-turns";
import { patchEnemyConditions, type EncounterEnemy } from "@/lib/db/encounters";
import { sizeRank } from "@/lib/bestiary/statblock";
import { publishEncounter } from "@/lib/dm/enemy-damage";
import { applyDmMutation } from "@/lib/dm/mutations";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// Battle Master superiority die by fighter level.
export function superiorityDie(level: number): string {
  if (level >= 18) return "d12";
  if (level >= 10) return "d10";
  return "d8";
}

// The condition a maneuver's rider save decides, when it has one.
export const MANEUVER_RIDERS: Array<{ match: RegExp; condition: string; save: "str" | "wis" }> = [
  { match: /trip/i, condition: "prone", save: "str" },
  { match: /menacing/i, condition: "frightened", save: "wis" },
  { match: /disarm/i, condition: "disarmed", save: "str" },
  { match: /goading/i, condition: "goaded", save: "wis" },
];

// What a hit spends, decided before the roll and paid after it: the smite
// slot and the Superiority Die of an on-hit maneuver. Carried on a parked
// physical-dice attack too, so the player's own d20 decides the spend.
export type OnHitSpends = {
  characterId: string;
  smite?: { slot: number; dice: number; undeadOrFiend: boolean };
  maneuver?: { name: string; die: string };
  // The damage before any on-hit dice, and what a critical adds to it.
  baseDamage: string;
  critExtraDice: number;
};

export type ParkedAttack = PendingAttack & { onHit?: OnHitSpends };

// Pays for what the hit carries and returns the dice it bought. A spend the
// sheet can no longer afford (the slot went elsewhere while the roll was
// parked) buys nothing and says so.
export function spendOnHit(
  campaign: Campaign,
  turnId: string,
  spends: OnHitSpends,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
): { suffix: string; notes: string[] } {
  let suffix = "";
  const notes: string[] = [];
  if (spends.maneuver) {
    const spent = applyDmMutation(
      campaign,
      turnId,
      "use_resource",
      JSON.stringify({
        characterId: spends.characterId,
        resource: "Superiority Dice",
        reason: spends.maneuver.name,
      }),
      sheets,
      sheetsById,
    ).result;
    if ("error" in spent) {
      notes.push(`${spends.maneuver.name}: no Superiority Die left, so the hit lands without it`);
    } else {
      suffix += `+1${spends.maneuver.die}`;
    }
  }
  if (spends.smite) {
    const spent = applyDmMutation(
      campaign,
      turnId,
      "use_spell_slot",
      JSON.stringify({
        characterId: spends.characterId,
        level: spends.smite.slot,
        reason: "Divine Smite",
      }),
      sheets,
      sheetsById,
    ).result;
    if ("error" in spent) {
      notes.push(`Divine Smite: no level ${spends.smite.slot} slot left, so the hit lands without it`);
    } else {
      suffix += `+${spends.smite.dice}d8`;
    }
  }
  return { suffix, notes };
}

// Why a rider's condition cannot land on this creature, or null when it can:
// it is immune to the condition, or too large for the maneuver.
export function riderBarred(
  enemy: EncounterEnemy,
  condition: string,
  maxSize: string | null,
): string | null {
  if (enemy.stats.conditionImmune.toLowerCase().includes(condition)) {
    return `${enemy.displayName} is immune to being ${condition}.`;
  }
  if (maxSize && sizeRank(enemy.stats.size) > sizeRank(maxSize)) {
    return `${enemy.displayName} is ${enemy.stats.size}, too large to be knocked ${condition} this way (${maxSize} or smaller).`;
  }
  return null;
}

// Writes a rider's condition to the enemy row, when nothing bars it.
export function applyRiderCondition(
  campaign: Campaign,
  enemy: EncounterEnemy,
  condition: string,
  options: { rounds?: number; maxSize?: string } = {},
): { applied: true } | { applied: false; reason: string } {
  const barred = riderBarred(enemy, condition, options.maxSize ?? null);
  if (barred) {
    return { applied: false, reason: barred };
  }
  if (!enemy.conditions.includes(condition)) {
    patchEnemyConditions(enemy.id, [...enemy.conditions, condition], {
      ...enemy.conditionMeta,
      ...(options.rounds ? { [condition]: { rounds: options.rounds } } : {}),
    });
    publishEncounter(campaign.id);
  }
  return { applied: true };
}
