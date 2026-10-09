// One carried item as GAME STATE lists it.
//
// The equipment line used to carry names only, so the model narrated a
// character's magic items from its own memory of the books and guessed which
// were worn and attuned, while the engine applied (or did not apply) the
// real numbers. A magic item now reads as the gear engine describes it
// (src/lib/dm/item-summary.ts magicItemLine: what the server applies, its
// charges, attuned or not, worn or not; the pack's own sentence for an item
// the engine only narrates); an ordinary item stays its name.
import { magicItemLine } from "@/lib/dm/item-summary";
import { sentienceLine } from "@/lib/homebrew/sentience";
import type { EquipmentItem } from "@/lib/schemas/sheet";

// `equipment` is the whole list: when no row says what is worn, the armor
// engine treats everything as worn, and so does the line.
export function describeEquipmentItem(item: EquipmentItem, equipment: readonly EquipmentItem[]): string {
  const count = item.qty > 1 ? ` x${item.qty}` : "";
  const magic = magicItemLine(item, !equipment.some((entry) => entry.equipped !== undefined));
  // A sentient item is an NPC the DM runs (src/lib/homebrew/sentience.ts).
  const mind = item.gear?.sentience ? `; ${sentienceLine(item.gear.sentience)}` : "";
  // Bracketed: the line lists items with commas, and a magic item's own
  // description has commas in it.
  if (magic) {
    return `[${magic}${mind}]${count}`;
  }
  if (mind) {
    return `[${item.name}${mind}]${count}`;
  }
  return `${item.name}${count}${item.identified === false ? " (unidentified)" : ""}`;
}
