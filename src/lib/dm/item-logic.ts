import type { EquipmentItem } from "@/lib/schemas/sheet";

// Pure consumable knowledge for the use_item tool: healing potion tiers,
// generic consumable detection, and ammunition lookup. Database-free so
// scripts/test-item-logic.mjs imports it directly.

export type ConsumableEffect =
  | { kind: "healing"; expression: string }
  | { kind: "generic" };

const POTION_TIERS: Array<{ pattern: RegExp; expression: string }> = [
  { pattern: /supreme/i, expression: "10d4+20" },
  { pattern: /superior/i, expression: "8d4+8" },
  { pattern: /greater/i, expression: "4d4+4" },
  { pattern: /./, expression: "2d4+2" },
];

// What using this item does. Healing potions get their SRD dice; everything
// else is a generic consumable (decrement only, model narrates the effect).
export function consumableEffect(name: string): ConsumableEffect {
  const lowered = name.toLowerCase();
  const isHealing =
    /potion|vial|elixir|flask|draught|philter/.test(lowered) &&
    /heal|life|vitality|cure/.test(lowered);
  if (isHealing) {
    const tier = POTION_TIERS.find((entry) => entry.pattern.test(lowered));
    return { kind: "healing", expression: tier?.expression ?? "2d4+2" };
  }
  return { kind: "generic" };
}

// Finds a carried item by fuzzy name (containment either way).
export function findCarriedItem(equipment: EquipmentItem[], term: string): EquipmentItem | null {
  const wanted = term.trim().toLowerCase();
  if (!wanted) {
    return null;
  }
  return (
    equipment.find((item) => item.name.toLowerCase() === wanted) ??
    equipment.find(
      (item) =>
        item.name.toLowerCase().includes(wanted) || wanted.includes(item.name.toLowerCase()),
    ) ??
    // Token fallback so "healing potion" still finds "Potion of Healing".
    equipment.find((item) => {
      const name = item.name.toLowerCase();
      const tokens = wanted.split(/\s+/).filter((token) => token.length > 2);
      return tokens.length > 0 && tokens.every((token) => name.includes(token));
    }) ??
    null
  );
}

// The carried item that serves as ammunition of the given kind ("arrows",
// "bolts", "rounds"...). Matches singular/plural and common phrasings
// ("Quiver of arrows", "Crossbow bolts x20", "bullets").
export function ammoItemFor(equipment: EquipmentItem[], ammoKind: string): EquipmentItem | null {
  const base = ammoKind.trim().toLowerCase().replace(/s$/, "");
  if (!base) {
    return null;
  }
  // "sling bullets" -> match on "bullet" too.
  const fragments = [base, ...base.split(" ").filter((part) => part.length > 3)];
  return (
    equipment.find((item) => {
      const name = item.name.toLowerCase();
      return fragments.some((fragment) => name.includes(fragment));
    }) ?? null
  );
}
