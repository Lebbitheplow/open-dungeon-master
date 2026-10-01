// What the authored subclass features do to a character's own spells, beyond
// the dice they add (src/lib/srd/spell-damage-riders.ts reads those):
//
//   - Grasping Tentacles (Fathomless warlock 10): casting Evard's Black
//     Tentacles gives temporary hit points equal to the warlock level (the
//     cast guard calls castTempHp), and damage cannot break the concentration
//     on it (concentration.ts asks authoredConcentrationGuard).
//   - Improved Reaper: src/lib/dm/authored-reaper.ts.

import type { Campaign } from "@/lib/db/campaigns";
import { getSheetById, patchSheet } from "@/lib/db/sheets";
import { publishPersisted } from "@/lib/events";
import { computeSheetDerived } from "@/lib/srd";
import { authoredConcentrationGuard } from "@/lib/srd/authored-effects-more";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// Grasping Tentacles: the temporary hit points of casting the guarded spell.
// They do not stack with ones the caster already holds; the higher stands.
export function castTempHp(campaign: Campaign, stale: CharacterSheet, spell: string): string | null {
  const sheet = getSheetById(stale.id) ?? stale;
  const guard = authoredConcentrationGuard(sheet, spell, computeSheetDerived(sheet).abilityMods);
  if (!guard || guard.tempHp <= 0) {
    return null;
  }
  if (guard.tempHp > sheet.tempHp) {
    const updated = patchSheet(sheet.id, { tempHp: guard.tempHp });
    if (updated) {
      publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
    }
  }
  return `${guard.feature}: ${Math.max(guard.tempHp, sheet.tempHp)} temporary hit points, and damage cannot break the concentration on ${spell}.`;
}
