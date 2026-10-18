// The pure half of the lead's Adjust dialog (LeadEditDialog.tsx): what the
// pickers may offer and how an item row keeps everything it stores.
// Database-free and JSX-free so scripts/test-lead-edit.mjs drives it.
import { spellClassFor } from "@/lib/classes";
import { thirdCasterList, thirdCasterProfileOf } from "@/lib/srd/third-caster";
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
export function spellListOf(sheet: Pick<CharacterSheet, "class" | "subclass" | "spellcasting">): string {
  const profile = thirdCasterProfileOf(sheet.class, sheet.subclass, sheet.spellcasting?.progression);
  return profile ? thirdCasterList(profile) : spellClassFor(sheet.class);
}

// Round and clamp shared slot edits before the Adjust dialog sends them. A
// zero maximum is intentional; only a missing or invalid edit uses the sheet.
export function editedSpellSlots(
  original: NonNullable<CharacterSheet["spellcasting"]>["slots"],
  edits: Record<string, { max: string; used: string }>,
): NonNullable<CharacterSheet["spellcasting"]>["slots"] {
  return Object.fromEntries(
    Object.entries(original).map(([level, slot]) => {
      const edited = edits[level];
      const enteredMax = Number(edited?.max);
      const max = edited?.max?.trim() && Number.isFinite(enteredMax)
        ? Math.max(0, Math.round(enteredMax))
        : slot.max;
      const used = Math.min(max, Math.max(0, Math.round(Number(edited?.used ?? slot.used)) || 0));
      return [level, { max, used }];
    }),
  );
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
