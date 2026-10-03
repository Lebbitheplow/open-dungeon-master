// Spells whose cost falls on their caster once the casting is paid (SRD 5.1):
//
//   Contact Other Plane: "you must make a DC 15 Intelligence saving throw.
//     On a failure, you take 6d6 psychic damage and are insane until you
//     finish a long rest. While insane, you can't take actions, can't
//     understand what other creatures say, can't read, and speak only in
//     gibberish." The insanity is "insane (contact other plane)"
//     (condition-effects-last.ts); a long rest ends it (ordeal.ts), and
//     Greater Restoration can too.
//
// The cast guard calls casterCost once the spend has gone through.

import type { Campaign } from "@/lib/db/campaigns";
import { createDmTurn, saveDmTurn } from "@/lib/db/dm-turns";
import { getSheetById } from "@/lib/db/sheets";
import { rollCharacterSave } from "@/lib/dm/forced-save";
import { applyPcDamage } from "@/lib/dm/pc-damage";
import { handleSetCondition } from "@/lib/dm/set-condition";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { rollCard } from "@/lib/dm/roll-card";

export const INSANE = "insane (contact other plane)";

// What the casting costs its caster, as lines for the result ({} for none).
export function casterCost(campaign: Campaign, sheet: CharacterSheet, spell: string): { casterCost?: string } {
  if (spell.trim().toLowerCase() !== "contact other plane") {
    return {};
  }
  const turn = createDmTurn(campaign.id, [], "human_dm");
  try {
    const save = rollCharacterSave(campaign, turn, sheet, "int", 15, "INT save against Contact Other Plane");
    if (save.success) {
      return { casterCost: `${sheet.name}'s mind holds against the other plane (INT save ${save.total} against DC 15).` };
    }
    const amount = rollCard(campaign, turn, sheet.id, "damage", "Contact Other Plane", "6d6", null).total;
    applyPcDamage(campaign, turn.id, getSheetById(sheet.id) ?? sheet, { amount, type: "psychic", reason: "Contact Other Plane: the mind recoils" });
    const standing = getSheetById(sheet.id);
    if (standing && !standing.deathSaves?.dead) {
      handleSetCondition(campaign, turn.id, standing, { condition: INSANE }, "Contact Other Plane", { spellEffect: { spell: "Contact Other Plane", source: sheet.id } });
    }
    return { casterCost: `${sheet.name} fails the INT save (${save.total} against DC 15), takes ${amount} psychic damage and is insane until a long rest: no actions, no understanding, only gibberish.` };
  } finally {
    turn.status = "done";
    saveDmTurn(turn);
  }
}
