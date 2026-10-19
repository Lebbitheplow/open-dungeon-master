// Ammunition tracking, off by default and switched on per table through the
// `ammunition` variant rule.
//
// It was a deliberate omission for a long time (docs/rules-coverage.md:
// "assumed supplied; tracking it is tedious with no upside at this table"),
// and for an AI-run game that is still the right default. A human DM asking
// for it is a different case: counting arrows is exactly the bookkeeping a
// person wants the machine to do for them.
//
// Pure by design: no "@/" imports and no I/O, so
// scripts/test-ammunition.mjs can import it directly.

import type { ToolError } from "../dm/tool-errors.ts";
import { hasItemTag, type TaggedItem } from "@/lib/srd/item-tags";

export type AmmoKind = "arrows" | "bolts" | "bullets" | "needles";

// What each ammunition weapon fires, by the SRD weapon row's name
// (src/lib/srd/weapons.ts).
const WEAPON_AMMO = new Map<string, AmmoKind>([
  ["Blowgun", "needles"],
  ["Hand Crossbow", "bolts"],
  ["Heavy Crossbow", "bolts"],
  ["Light Crossbow", "bolts"],
  ["Shortbow", "arrows"],
  ["Longbow", "arrows"],
  ["Sling", "bullets"],
  ["Pistol", "bullets"],
  ["Revolver", "bullets"],
  ["Musket", "bullets"],
  ["Hunting Rifle", "bullets"],
]);

// Pounds per round, from the SRD equipment table: 20 arrows weigh 1 lb, 20
// bolts or sling bullets 1.5 lb, 50 blowgun needles 1 lb. Per round rather
// than per bundle because a quiver's count moves as it is fired
// (src/lib/srd/encumbrance.ts weighs it that way).
export const AMMO_WEIGHT_LB: Record<AmmoKind, number> = {
  arrows: 0.05,
  bolts: 0.075,
  bullets: 0.075,
  needles: 0.02,
};

export const AMMO_LABELS: Record<AmmoKind, string> = {
  arrows: "arrows",
  bolts: "bolts",
  bullets: "bullets",
  needles: "needles",
};

// What an SRD weapon fires, by its row's name; null for any other.
export function ammoKindForWeapon(srdName: string | undefined): AmmoKind | null {
  return (srdName && WEAPON_AMMO.get(srdName)) || null;
}

type Item = TaggedItem & { qty: number };

// How many rounds an inventory line holds. `qty` is authoritative, but a
// line written as "Arrows (20)" carries its count in the name and would
// otherwise read as a single arrow, so the parenthesised number wins when
// qty is the schema default of 1.
export function ammoCount(item: Item): number {
  const bracketed = /\((\d+)\)\s*$/.exec(item.name.trim());
  if (bracketed && item.qty <= 1) {
    return Number(bracketed[1]);
  }
  return item.qty;
}

// The ammunition kinds, each the tag an inventory line carries for it
// (src/lib/srd/item-tags.ts).
const AMMO_KINDS: AmmoKind[] = ["arrows", "bolts", "bullets", "needles"];

// Which kind of ammunition an inventory line IS, as opposed to which kind a
// weapon fires. Null for everything that is not ammunition.
export function ammoKindForItem(item: TaggedItem): AmmoKind | null {
  return AMMO_KINDS.find((kind) => hasItemTag(item, kind)) ?? null;
}

// The inventory line this weapon draws from, or null when the character is
// carrying none. The first matching line wins, which keeps the choice
// predictable when someone carries both plain and silvered arrows.
export function findAmmo(
  equipment: Item[],
  kind: AmmoKind,
): { index: number; item: Item; count: number } | null {
  for (let index = 0; index < equipment.length; index += 1) {
    const item = equipment[index];
    if (hasItemTag(item, kind) && ammoCount(item) > 0) {
      return { index, item, count: ammoCount(item) };
    }
  }
  return null;
}

export type AmmoSpend =
  | { ok: true; index: number; name: string; remaining: number; kind: AmmoKind }
  | ({ ok: false; kind: AmmoKind } & ToolError);

// Spends one round. Returns the new count rather than mutating, so the
// caller decides how to persist it.
export function spendAmmo(
  equipment: Item[],
  // The SRD weapon it is (AttackProfile's base), and the name it is carried
  // under.
  weapon: { base: string | undefined; name: string },
  characterName: string,
): AmmoSpend | null {
  const kind = ammoKindForWeapon(weapon.base);
  if (!kind) {
    // Not an ammunition weapon; nothing to track.
    return null;
  }
  const found = findAmmo(equipment, kind);
  if (!found) {
    return {
      ok: false,
      kind,
      error: `${characterName} is out of ${AMMO_LABELS[kind]} and cannot fire the ${weapon.name}.`,
      refused: "rules",
    };
  }
  return {
    ok: true,
    kind,
    index: found.index,
    name: found.item.name,
    remaining: found.count - 1,
  };
}

// Rewrites the inventory line to a new count, dropping a line that hits
// zero. A "(20)"-style name is rewritten in place so the two never disagree.
export function withAmmoCount<T extends Item>(items: T[], index: number, count: number): T[] {
  const next = [...items];
  const item = next[index];
  if (!item) {
    return next;
  }
  if (count <= 0) {
    next.splice(index, 1);
    return next;
  }
  const bracketed = /\((\d+)\)\s*$/.exec(item.name.trim());
  next[index] = {
    ...item,
    qty: count,
    name: bracketed ? item.name.replace(/\((\d+)\)\s*$/, `(${count})`) : item.name,
  };
  return next;
}

// After a battle a character recovers half the ammunition they spent,
// rounded down (PHB, "Ammunition"). Spent counts are tallied per encounter.
export function recoveredAmmo(spent: number): number {
  return Math.floor(Math.max(0, spent) / 2);
}
