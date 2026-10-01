// What rides a player's attack and is paid for by it: a Battle Master's
// maneuver and a paladin's smite, both spent when the hit is known, and the
// conditions a rider can leave on the target. Split from pc-attack.ts, which
// decides the attack these belong to.

import { untilTurnEnd } from "@/lib/dm/turn-end";
import type { Campaign } from "@/lib/db/campaigns";
import type { PendingAttack } from "@/lib/db/dm-turns";
import { getEnemy, patchEnemyConditions, type EncounterEnemy } from "@/lib/db/encounters";
import { rollEnemySave } from "@/lib/dm/forced-save";
import { resourceLeft } from "@/lib/dm/attack-rules";
import type { ManeuverPick } from "@/lib/dm/pc-attack-plan";
import { classLevelFor } from "@/lib/srd/multiclass";
import { getSheetById, patchSheet } from "@/lib/db/sheets";
import { publishPersisted } from "@/lib/events";
import { removeConditions, type ConditionMeta } from "@/lib/dm/condition-logic";
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

// A Battle Master maneuver named on the swing: known, with a Superiority Die
// left, on a weapon attack. The pool is only looked at; the die is spent on
// the roll for Precision Attack and on the hit for every other maneuver.
export function pickManeuver(
  sheet: CharacterSheet,
  asked: string | undefined,
  weaponAttack: boolean,
): { refused: string } | { maneuver: ManeuverPick | null } {
  if (!asked?.trim()) {
    return { maneuver: null };
  }
  if (!weaponAttack) {
    return { refused: "Maneuvers ride weapon attacks, not spells." };
  }
  const term = asked.trim().toLowerCase();
  const picks = sheet.features
    .map((feature) => feature.name)
    .filter((name) => name.toLowerCase().startsWith("maneuver"));
  const known = picks.some((name) => {
    const bare = name.toLowerCase().replace(/^maneuver:\s*/, "");
    return bare.includes(term) || term.includes(bare);
  });
  if (!known) {
    return {
      refused: `${sheet.name} knows no maneuver "${asked}".${
        picks.length ? ` Their maneuvers: ${picks.join(", ")}.` : " They have no maneuver picks."
      }`,
    };
  }
  const pool = resourceLeft(sheet, "Superiority Dice");
  if (pool === null || pool.left < 1) {
    return {
      refused:
        pool === null
          ? `${sheet.name} has no Superiority Dice.`
          : `${sheet.name} has 0/${pool.max} Superiority Dice left; ${asked.trim()} is not available until they rest. They can make the attack without it.`,
    };
  }
  return {
    maneuver: {
      name: asked.trim(),
      // Multiclass: the superiority die grows with FIGHTER levels.
      die: superiorityDie(classLevelFor(sheet, "fighter") || sheet.level),
      precision: /precision/i.test(term),
      rider: MANEUVER_RIDERS.find((entry) => entry.match.test(term)) ?? null,
    },
  };
}

// What a hit spends, decided before the roll and paid after it: the smite
// slot and the Superiority Die of an on-hit maneuver. Carried on a parked
// physical-dice attack too, so the player's own d20 decides the spend.
export type OnHitSpends = {
  characterId: string;
  smite?: { slot: number; dice: number; undeadOrFiend: boolean };
  maneuver?: { name: string; die: string };
  // Stunning Strike: 1 ki on the hit, then the target's CON save at this DC.
  stun?: { dc: number };
  // The damage before any on-hit dice, and what a critical adds to it.
  baseDamage: string;
  critExtraDice: number;
};

// `nonlethal`: a knockout blow, carried to the damage stage
// (src/lib/dm/enemy-damage.ts applyPendingDamageRoll).
// `hitSpent`: the attacker's conditions the hit uses up (the smites);
// `spell`: an attack spell whose rider lands on the hit.
export type ParkedAttack = PendingAttack & {
  onHit?: OnHitSpends;
  nonlethal?: boolean;
  hitSpent?: string[];
  spell?: string;
  // A melee attack, which a monster's Parry answers (enemy-reactions.ts).
  melee?: boolean;
  // A magic weapon's dice on a natural 20 (src/lib/dm/gear-attack.ts).
  critGear?: { suffix: string; typed: Array<{ dice: string; type: string }>; notes: string[] };
  // What rides the roll and the hit beyond the damage
  // (src/lib/dm/attack-features.ts, attack-onhit.ts).
  extras?: {
    foeSlayer?: number;
    strokeOfLuck?: boolean;
    openHand?: { choice: "prone" | "push" | "no reactions"; dc: number };
    hurl?: boolean;
    poison?: boolean;
  };
};

// Pays for what the hit carries and returns the dice it bought. A spend the
// sheet can no longer afford (the slot went elsewhere while the roll was
// parked) buys nothing and says so.
export function spendOnHit(
  campaign: Campaign,
  turnId: string,
  spends: OnHitSpends,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
): { suffix: string; notes: string[]; stunPaid: boolean } {
  let suffix = "";
  const notes: string[] = [];
  let stunPaid = false;
  if (spends.stun) {
    const spent = applyDmMutation(
      campaign,
      turnId,
      "use_resource",
      JSON.stringify({ characterId: spends.characterId, resource: "Ki", reason: "Stunning Strike" }),
      sheets,
      sheetsById,
    ).result;
    if ("error" in spent) {
      notes.push("Stunning Strike: no ki point left, so the hit lands without it");
    } else {
      stunPaid = true;
    }
  }
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
  return { suffix, notes, stunPaid };
}

// Stunning Strike's save, once the ki is paid: CON against the monk's ki DC,
// and a failure stuns the creature until the end of the monk's next turn
// (untilTurnEndOf, src/lib/dm/turn-end.ts).
export function stunningStrikeSave(
  campaign: Campaign,
  encounterId: string,
  enemyId: string,
  monkId: string,
  dc: number,
): string {
  const fresh = getEnemy(enemyId);
  if (!fresh || fresh.encounterId !== encounterId || fresh.status !== "alive") {
    return "Stunning Strike: the target is already down.";
  }
  const barred = riderBarred(fresh, "stunned", null);
  if (barred) {
    return `Stunning Strike: ${barred} The ki is spent.`;
  }
  const save = rollEnemySave(campaign.id, fresh, "con", dc);
  if (save.success) {
    return `Stunning Strike: ${fresh.displayName} holds (CON save ${save.total} vs DC ${dc}); no stun.`;
  }
  if (!fresh.conditions.includes("stunned")) {
    patchEnemyConditions(fresh.id, [...fresh.conditions, "stunned"], {
      ...fresh.conditionMeta,
      stunned: untilTurnEnd(monkId, { source: monkId }),
    });
    publishEncounter(campaign.id);
  }
  return `Stunning Strike: ${fresh.displayName} fails the CON save (${save.autoFailed ? "automatic" : save.total} vs DC ${dc}) and is stunned until the end of the monk's next turn.`;
}

// Clears the attacker's conditions a hit uses up (the smites: "the next
// time you hit"). A miss leaves them for the next swing.
export function clearHitSpent(campaign: Campaign, sheetId: string, names: string[]) {
  if (!names.length) {
    return;
  }
  const fresh = getSheetById(sheetId);
  if (!fresh) {
    return;
  }
  const cleared = removeConditions(fresh.conditions, fresh.conditionMeta, names);
  const updated = patchSheet(sheetId, { conditions: cleared.conditions, conditionMeta: cleared.meta });
  if (updated) {
    publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
  }
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
  options: { rounds?: number; maxSize?: string; meta?: ConditionMeta } = {},
): { applied: true } | { applied: false; reason: string } {
  const barred = riderBarred(enemy, condition, options.maxSize ?? null);
  if (barred) {
    return { applied: false, reason: barred };
  }
  if (!enemy.conditions.includes(condition)) {
    patchEnemyConditions(enemy.id, [...enemy.conditions, condition], {
      ...enemy.conditionMeta,
      ...(options.meta ? { [condition]: options.meta } : options.rounds ? { [condition]: { rounds: options.rounds } } : {}),
    });
    publishEncounter(campaign.id);
  }
  return { applied: true };
}
