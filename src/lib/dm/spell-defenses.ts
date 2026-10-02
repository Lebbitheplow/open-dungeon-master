// The protective spells an enemy's attack meets on its way in (SRD 5.1):
//
//   Sanctuary: a creature that targets the warded character with an attack
//     first makes a Wisdom save against the caster's DC; on a failure it must
//     choose a new target or lose the attack.
//   Mirror Image: each attack against the caster first rolls a d20; with
//     three duplicates a 6 or higher, two an 8 or higher, one an 11 or
//     higher, and the attack targets a duplicate instead (AC 10 + the
//     caster's Dexterity modifier). A duplicate hit is destroyed; with none
//     left the spell ends.
//
// Called from enemy_attack (src/lib/dm/enemy-attack.ts). The duplicates
// left ride the condition's name: "mirror image" is three, then
// "mirror image (2)", "mirror image (1)".

import { rollCard } from "@/lib/dm/roll-card";
import { getSheetById, patchSheet } from "@/lib/db/sheets";
import type { EncounterEnemy } from "@/lib/db/encounters";
import { publishPersisted } from "@/lib/events";
import { computeSheetDerived, spellSaveDcFor } from "@/lib/srd";
import { rollEnemySave } from "@/lib/dm/forced-save";
import { removeConditions, type ConditionMetaMap } from "@/lib/dm/condition-logic";
import { tranquilityDc } from "@/lib/dm/srd-defenses";

// Why the enemy cannot attack this character now, or null.
export function sanctuaryRefusal(campaignId: string, enemy: EncounterEnemy, targetId: string): string | null {
  const target = getSheetById(targetId);
  const ward = target?.conditions.find((entry) => entry.trim().toLowerCase() === "sanctuary");
  if (!target || !ward) {
    return null;
  }
  const casterId = (target.conditionMeta as ConditionMetaMap)[ward]?.source;
  const caster = casterId ? getSheetById(casterId) : null;
  // Tranquility's Sanctuary is the monk's own: 8 + WIS + proficiency.
  const dc = (caster ? (tranquilityDc(caster) ?? spellSaveDcFor(caster, "Sanctuary")) : null) ?? 13;
  const save = rollEnemySave(campaignId, enemy, "wis", dc);
  if (save.success) {
    return null;
  }
  return `${enemy.displayName} fails its WIS save (DC ${dc}) against ${target.name}'s Sanctuary and cannot attack them: it must choose another target or lose the attack.`;
}

// The attack's fate when the target holds Mirror Image: null when it goes
// to the target as usual, or what happened to a duplicate.
export function mirrorImageDecoy(campaignId: string, targetId: string, attackTotal: number): string | null {
  const target = getSheetById(targetId);
  const held = target?.conditions.find((entry) => /^mirror images?\b/i.test(entry.trim()));
  if (!target || !held) {
    return null;
  }
  const left = Number(/\((\d)\)/.exec(held)?.[1] ?? 3);
  const needed = left >= 3 ? 6 : left === 2 ? 8 : 11;
  const roll = rollCard({ id: campaignId }, null, target.id, "custom", `Mirror Image (${needed} or higher turns the attack)`, "1d20", null).total;
  if (roll < needed) {
    return null;
  }
  const duplicateAc = 10 + computeSheetDerived(target).abilityMods.dex;
  if (attackTotal < duplicateAc) {
    return `the attack goes to one of ${target.name}'s duplicates (d20 ${roll}) and misses it (AC ${duplicateAc})`;
  }
  const cleared = removeConditions(target.conditions, target.conditionMeta, [held]);
  const next = left - 1;
  const conditions = next > 0 ? [...cleared.conditions, `mirror image (${next})`] : cleared.conditions;
  const meta = (target.conditionMeta as ConditionMetaMap)[held];
  const updated = patchSheet(target.id, {
    conditions,
    conditionMeta: next > 0 && meta ? { ...cleared.meta, [`mirror image (${next})`]: meta } : cleared.meta,
  });
  if (updated) {
    publishPersisted(campaignId, "sheet_updated", { sheet: updated });
  }
  return `the attack goes to one of ${target.name}'s duplicates (d20 ${roll}) and destroys it; ${next > 0 ? `${next} left` : "the spell ends"}`;
}

// Sanctuary ends when the warded creature makes an attack or casts a spell
// that affects an enemy (SRD 5.1). The conditions an attack ends.
export function sanctuaryEndedByAttack(sheet: { conditions: string[] }): string[] {
  return sheet.conditions.filter((entry) => entry.trim().toLowerCase() === "sanctuary");
}

// The same for a spell cast at an enemy (the cast guard calls this).
export function endSanctuaryOnHarm(campaignId: string, sheetId: string): string | null {
  const sheet = getSheetById(sheetId);
  const ending = sheet ? sanctuaryEndedByAttack(sheet) : [];
  if (!sheet || !ending.length) {
    return null;
  }
  const cleared = removeConditions(sheet.conditions, sheet.conditionMeta, ending);
  const updated = patchSheet(sheet.id, { conditions: cleared.conditions, conditionMeta: cleared.meta });
  if (updated) {
    publishPersisted(campaignId, "sheet_updated", { sheet: updated });
  }
  return `${sheet.name} casts at an enemy and Sanctuary ends.`;
}
