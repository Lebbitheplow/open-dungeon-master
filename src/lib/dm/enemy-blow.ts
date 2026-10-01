// A rolled damage total landing on an enemy: a parked attack's damage roll
// (physical dice) and a damage roll that names its target, each split by
// type and met by the creature's resistances before applyEnemyDamage lands
// it. Split from enemy-damage.ts, which re-exports it.

import { getCampaignById, type Campaign } from "@/lib/db/campaigns";
import { getActiveEncounter, type Encounter, type EncounterEnemy } from "@/lib/db/encounters";
import { listSheets } from "@/lib/db/sheets";
import { getDmTurn, type DmTurn, type PendingRoll } from "@/lib/db/dm-turns";
import { markRollApplied, type StoredRoll } from "@/lib/db/rolls";
import { healthState } from "@/lib/bestiary/health";
import { damageAdjust, resistsAllDamage } from "@/lib/dm/condition-logic";
import { weaponMaterial } from "@/lib/dm/damage-logic";
import { damageParts, type TypedRider } from "@/lib/dm/damage-parts";
import { applyEnemyDamage, resolveEnemyRef } from "@/lib/dm/enemy-damage";
import { resistLineFor } from "@/lib/dm/underwater";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// How a parked attack's damage roll is resolved (carried on the pending
// roll's attack context): the magical flag, the dice that ride it under a
// type of their own, and the critical those dice were doubled for.
export type DamageBlow = {
  magical?: boolean;
  // A knockout blow (src/lib/dm/knockout.ts).
  nonlethal?: boolean;
  riders?: TypedRider[];
  crit?: boolean;
  critExtraDice?: number;
  // The weapon's name, for a silvered or adamantine one (damage-logic.ts).
  weapon?: string;
};

// One rolled damage total landing on an enemy. With typed riders the blow is
// split per type (damage-parts.ts) and each part meets the creature's
// resistances on its own, the same way pc_attack's digital path resolves it;
// what is left lands as one wound.
function applyBlow(
  campaign: Campaign,
  turn: DmTurn,
  encounter: Encounter,
  enemy: EncounterEnemy,
  roll: StoredRoll,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
  damageType: string | undefined,
  blow: DamageBlow | undefined,
): Record<string, unknown> {
  const amount = Math.max(1, roll.total);
  const magical = blow?.magical === true;
  const material = weaponMaterial(blow?.weapon);
  const parts =
    blow?.riders?.length && damageType && roll.breakdown?.terms
      ? damageParts(roll.breakdown, damageType, blow.riders, {
          crit: blow.crit === true,
          trailingTerms: blow.crit ? (blow.critExtraDice ?? 0) : 0,
        })
      : [];
  if (parts.length < 2) {
    return applyEnemyDamage(campaign, turn, encounter, enemy, amount, sheets, sheetsById, damageType, {
      magical,
      nonlethal: blow?.nonlethal === true,
      crit: blow?.crit === true,
      ...material,
    });
  }
  // A creature that resists everything (petrified) is halved once, by
  // applyEnemyDamage, not once per part.
  const resistAll = resistsAllDamage(enemy.conditions);
  const byType = parts.map((part, index) => ({
    ...part,
    ...damageAdjust(
      part.amount,
      part.type,
      resistAll ? "" : resistLineFor(campaign.id, enemy),
      enemy.stats.immune,
      enemy.stats.vulnerable,
      // Only the weapon's own part can be nonmagical: a rider is a spell's or
      // a feature's dice.
      { magical: index === 0 ? magical : true, ...(index === 0 ? material : {}) },
    ),
  }));
  const landed = byType.reduce((sum, part) => sum + part.amount, 0);
  const applied: Record<string, unknown> =
    landed > 0
      ? applyEnemyDamage(campaign, turn, encounter, enemy, landed, sheets, sheetsById, undefined, {
          magical: true,
          nonlethal: blow?.nonlethal === true,
        })
      : {
          ok: true,
          name: enemy.displayName,
          hp: `${enemy.currentHp}/${enemy.maxHp}`,
          health: healthState(enemy.currentHp, enemy.maxHp),
          damageApplied: 0,
        };
  if ("error" in applied) {
    return applied;
  }
  return {
    ...applied,
    damageApplied: resistAll ? Math.floor(landed / 2) : landed,
    damageByType: byType.map(
      (part) => `${part.amount} ${part.type || "untyped"}${part.note ? ` (${part.note})` : ""}`,
    ),
  };
}

// A resolved damage roll that names its target: apply it before the model
// even sees the number. Returned payload merges into the roll's tool result.
export function autoApplyDamageRoll(
  campaign: Campaign,
  turn: DmTurn,
  targetEnemyRef: string,
  roll: StoredRoll,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
  damageType?: string,
  blow?: DamageBlow,
): Record<string, unknown> {
  const encounter = getActiveEncounter(campaign.id);
  if (!encounter) {
    return { warning: "No active encounter; this damage was not applied to anyone." };
  }
  const enemy = resolveEnemyRef(encounter.id, targetEnemyRef);
  if (!enemy || enemy.status !== "alive") {
    return {
      warning: `targetEnemyId "${targetEnemyRef}" matched no living enemy; the damage was NOT applied. Call damage_enemy with an exact enemyId from GAME STATE.`,
    };
  }
  const result = applyBlow(
    campaign,
    turn,
    encounter,
    enemy,
    roll,
    sheets,
    sheetsById,
    damageType,
    blow,
  );
  if (!("error" in result)) {
    markRollApplied(roll.id, enemy.id);
    result.note = result.dead
      ? `${enemy.displayName} is slain; the server already applied this damage. Do NOT call damage_enemy for this hit.`
      : `The server already applied this damage to ${enemy.displayName}. Do NOT call damage_enemy for this hit.`;
  }
  return result;
}

// Physical-dice variant, called from the pending-rolls route when a player
// submits a targeted damage roll. Returns the summary the resumed turn
// surfaces to the model (stored in pending_rolls.combat_note).
export function applyPendingDamageRoll(pending: PendingRoll, roll: StoredRoll): string | null {
  if (!pending.targetEnemyId) {
    return null;
  }
  const campaign = getCampaignById(pending.campaignId);
  const turn = getDmTurn(pending.turnId);
  if (!campaign || !turn) {
    return null;
  }
  const sheets = listSheets(campaign.id);
  const sheetsById = new Map(sheets.map((sheet) => [sheet.id, sheet]));
  const applied = autoApplyDamageRoll(
    campaign,
    turn,
    pending.targetEnemyId,
    roll,
    sheets,
    sheetsById,
    pending.attack?.damageType,
    pending.attack
      ? {
          magical: pending.attack.magical,
          riders: pending.attack.riders,
          crit: pending.attack.crit,
          critExtraDice: pending.attack.critExtraDice,
          nonlethal: (pending.attack as { nonlethal?: boolean }).nonlethal === true,
          weapon: (pending.attack as { weapon?: string }).weapon,
        }
      : undefined,
  );
  if (typeof applied.warning === "string") {
    return applied.warning;
  }
  if ("error" in applied) {
    return null;
  }
  const byType = Array.isArray(applied.damageByType)
    ? ` (${(applied.damageByType as string[]).join(", ")})`
    : "";
  const parts = [
    `The server already applied this ${roll.total} damage${byType} to ${String(applied.name)} (now ${
      applied.dead ? "SLAIN" : String(applied.health)
    }).`,
  ];
  if (applied.encounterOver) {
    parts.push(`The encounter ended: ${String(applied.outcome)}. XP was awarded automatically.`);
  }
  parts.push("Do NOT call damage_enemy for this hit; narrate from this state.");
  return parts.join(" ");
}
