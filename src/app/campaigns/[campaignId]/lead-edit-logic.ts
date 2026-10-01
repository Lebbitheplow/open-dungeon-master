// The pure half of the lead's Adjust dialog (LeadEditDialog.tsx): what the
// pickers may offer and how an item row keeps everything it stores.
// Database-free and JSX-free so scripts/test-lead-edit.mjs drives it.
import { spellClassFor } from "@/lib/classes";
import { THIRD_CASTER_LIST, isThirdCaster } from "@/lib/srd/third-caster";
import type { CharacterSheet, EquipmentItem } from "@/lib/schemas/sheet";

// The highest spell level this sheet can actually cast, read from the slots
// it has stored: the multiclass table, a third caster's slots and a
// warlock's pact level are all already in there, where the class table of
// the primary class at the total level was wrong for all three (U:UC5).
// Cantrips (level 0) always pass.
export function highestStoredSlot(spellcasting: CharacterSheet["spellcasting"]): number {
  if (!spellcasting) {
    return 0;
  }
  const shared = Object.entries(spellcasting.slots ?? {}).reduce(
    (top, [level, slot]) => (slot.max > 0 ? Math.max(top, Number(level)) : top),
    0,
  );
  const pact = spellcasting.pact && spellcasting.pact.max > 0 ? spellcasting.pact.level : 0;
  return Math.max(shared, pact);
}

// The class list the pickers search: an Eldritch Knight or Arcane Trickster
// learns from the wizard's.
export function spellListOf(sheet: Pick<CharacterSheet, "class" | "subclass">): string {
  return isThirdCaster(sheet.class, sheet.subclass) ? THIRD_CASTER_LIST : spellClassFor(sheet.class);
}

// One item row in the dialog. `base` is the stored item whole, so a save
// that only changed a name or a count keeps worn, attuned, identified and
// charges (U:UC1: rows used to be rebuilt from name, qty and slug, and every
// save quietly unequipped the party's armor and dropped their attunements).
export type ItemRow = { name: string; qty: string; base: EquipmentItem };

export function itemRowsOf(equipment: EquipmentItem[]): ItemRow[] {
  return equipment.map((item) => ({ name: item.name, qty: String(item.qty), base: { ...item } }));
}

export function equipmentFrom(rows: ItemRow[]): EquipmentItem[] {
  return rows
    .map((row) => ({
      ...row.base,
      name: row.name.trim(),
      qty: Math.min(999, Math.max(1, Math.round(Number(row.qty)) || 1)),
    }))
    .filter((item) => item.name);
}
