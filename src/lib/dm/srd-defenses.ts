// The SRD defenses the final recount found narrated (SRD 5.1):
//
//   - Nature's Sanctuary (Circle of the Land 14): a beast or plant that
//     attacks the druid first makes a WIS save against their spell save DC;
//     on a failure it must choose another target or lose the attack.
//     enemy_attack asks it through the Sanctuary ward (enemy-conditions.ts
//     sanctuaryWard), so a creature turned away stays turned for the turn.
//   - Tranquility (Way of the Open Hand 11): at the end of a long rest the
//     monk gains the effect of Sanctuary until the next long rest, with a
//     save DC of 8 + WIS + proficiency (spell-defenses.ts sanctuaryRefusal
//     reads tranquilityDc for a caster with no spell save DC of their own).

import type { Campaign } from "@/lib/db/campaigns";
import type { EncounterEnemy } from "@/lib/db/encounters";
import { getSheetById, patchSheet } from "@/lib/db/sheets";
import { publishPersisted } from "@/lib/events";
import { computeSheetDerived } from "@/lib/srd";
import { holdsFeature } from "@/lib/srd/trait-rules";
import type { ConditionMetaMap } from "@/lib/dm/condition-logic";
import { rollEnemySave } from "@/lib/dm/forced-save";
import type { CharacterSheet } from "@/lib/schemas/sheet";

const lower = (value: string | undefined | null) => (value ?? "").trim().toLowerCase();

export function naturesSanctuaryRefusal(campaignId: string, enemy: EncounterEnemy, targetId: string): string | null {
  const target = getSheetById(targetId);
  if (!target || !holdsFeature(target, "nature's sanctuary") || !/\b(beast|plant)\b/.test(lower(String(enemy.stats.type ?? "")))) {
    return null;
  }
  const dc = computeSheetDerived(target).spellSaveDc ?? 13;
  const save = rollEnemySave(campaignId, enemy, "wis", dc, {
    magical: true,
    record: { detail: `${enemy.displayName}: WIS save against ${target.name}'s Nature's Sanctuary` },
  });
  return save.success
    ? null
    : `${enemy.displayName} fails its WIS save (DC ${dc}) against ${target.name}'s Nature's Sanctuary and cannot attack them: it must choose another target or lose the attack.`;
}

// The DC of the Sanctuary Tranquility gives, or null for a caster whose own
// spell save DC decides it.
export function tranquilityDc(caster: CharacterSheet): number | null {
  if (!holdsFeature(caster, "tranquility")) {
    return null;
  }
  const derived = computeSheetDerived(caster);
  return 8 + derived.proficiencyBonus + derived.abilityMods.wis;
}

// After a long rest: every monk with Tranquility is under Sanctuary until the
// next one (it ends early, as the spell does, when they attack or cast at an
// enemy).
export function tranquilityAfterLongRest(campaign: Campaign, restingIds: string[]): string[] {
  const lines: string[] = [];
  for (const id of restingIds) {
    const sheet = getSheetById(id);
    if (!sheet || sheet.deathSaves?.dead || !holdsFeature(sheet, "tranquility")) {
      continue;
    }
    const kept = sheet.conditions.filter((entry) => lower(entry) !== "sanctuary");
    const updated = patchSheet(sheet.id, {
      conditions: [...kept, "sanctuary"],
      conditionMeta: { ...(sheet.conditionMeta as ConditionMetaMap), sanctuary: { source: sheet.id, rounds: 14400 } },
    });
    if (updated) {
      publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
    }
    lines.push(`${sheet.name} rises under Tranquility's Sanctuary.`);
  }
  return lines;
}
