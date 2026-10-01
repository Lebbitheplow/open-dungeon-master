// A spell cast from a scroll or a charged item, resolved by the tool that
// applies it. use_item already spent the scroll or the charges, and the
// action it took to use them, and wrote a credit for the spell
// (src/lib/srd/item-cast-credit.ts); the cast guard hands the cast here when
// that credit is waiting, so nothing is spent twice.
//
// SRD 5.1, Magic Items, Spells: the spell "doesn't expend any of the user's
// spell slots, and requires no components", uses its normal duration, "and
// the user of the item must concentrate if the spell requires
// concentration". A spell scroll's spell is cast the same way.

import type { Campaign } from "@/lib/db/campaigns";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import type { SpellFacts } from "@/lib/srd/spell-facts";
import type { ItemCast } from "@/lib/srd/item-cast-credit";
import { clearSpellConditionsByName, setConcentration } from "@/lib/dm/concentration";
import { endInvisibilityOnCast } from "@/lib/dm/attack-marks";

export function castFromItem(
  campaign: Campaign,
  turnId: string,
  sheet: CharacterSheet,
  facts: SpellFacts | null,
  name: string,
  cast: ItemCast,
  input: { dryRun?: boolean; concentration?: boolean },
): Record<string, unknown> {
  const numbers = {
    ...(cast.saveDc ? { saveDc: cast.saveDc } : {}),
    ...(cast.attackBonus ? { attackBonus: cast.attackBonus } : {}),
  };
  if (input.dryRun) {
    return { ok: true, dryRun: true, spell: name, slotLevel: cast.level, fromItem: cast.item, ...numbers };
  }
  const result: Record<string, unknown> = {
    ok: true,
    spell: name,
    slotLevel: cast.level,
    fromItem: cast.item,
    slot: `cast from ${cast.item}: no spell slot spent`,
    ...numbers,
  };
  if (input.concentration === true || facts?.concentration === true) {
    const { displaced } = setConcentration(campaign, turnId, sheet.id, name);
    result.concentration = true;
    if (displaced) {
      clearSpellConditionsByName(campaign, displaced, sheet.userId, sheet.id);
      result.droppedConcentration = `${displaced} ended when ${name} was cast; its effects are gone.`;
    }
  }
  // Casting a spell from an item is casting a spell: Invisibility ends.
  endInvisibilityOnCast(campaign.id, sheet.id);
  return result;
}
