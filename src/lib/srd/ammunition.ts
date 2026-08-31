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

export type AmmoKind = "arrows" | "bolts" | "bullets" | "needles";

// What each ammunition weapon fires. Matched against the SRD weapon name,
// lowercased, longest key first so "hand crossbow" beats "crossbow".
const WEAPON_AMMO: Array<[match: string, kind: AmmoKind]> = [
  ["blowgun", "needles"],
  ["hand crossbow", "bolts"],
  ["heavy crossbow", "bolts"],
  ["light crossbow", "bolts"],
  ["crossbow", "bolts"],
  ["shortbow", "arrows"],
  ["longbow", "arrows"],
  ["bow", "arrows"],
  ["sling", "bullets"],
  ["pistol", "bullets"],
  ["revolver", "bullets"],
  ["musket", "bullets"],
  ["rifle", "bullets"],
];

// The nouns an inventory line may use for each kind. "Sling bullets" and
// "bullets" both work, as do the singular forms a player might type.
const AMMO_WORDS: Record<AmmoKind, string[]> = {
  arrows: ["arrow", "arrows"],
  bolts: ["bolt", "bolts", "quarrel", "quarrels"],
  bullets: ["bullet", "bullets", "cartridge", "cartridges", "shot"],
  needles: ["needle", "needles"],
};

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

export function ammoKindForWeapon(weaponName: string): AmmoKind | null {
  const name = (weaponName ?? "").toLowerCase();
  for (const [match, kind] of WEAPON_AMMO) {
    if (name.includes(match)) {
      return kind;
    }
  }
  return null;
}

type Item = { name: string; qty: number };

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

function isAmmoFor(kind: AmmoKind, name: string): boolean {
  const lower = name.toLowerCase();
  return AMMO_WORDS[kind].some((word) => new RegExp(`\\b${word}\\b`).test(lower));
}

// Which kind of ammunition an inventory line IS, as opposed to which kind a
// weapon fires. Null for everything that is not ammunition.
export function ammoKindForItem(itemName: string): AmmoKind | null {
  for (const kind of Object.keys(AMMO_WORDS) as AmmoKind[]) {
    if (isAmmoFor(kind, itemName ?? "")) {
      return kind;
    }
  }
  return null;
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
    if (isAmmoFor(kind, item.name) && ammoCount(item) > 0) {
      return { index, item, count: ammoCount(item) };
    }
  }
  return null;
}

export type AmmoSpend =
  | { ok: true; index: number; name: string; remaining: number; kind: AmmoKind }
  | { ok: false; error: string; kind: AmmoKind };

// Spends one round. Returns the new count rather than mutating, so the
// caller decides how to persist it.
export function spendAmmo(
  equipment: Item[],
  weaponName: string,
  characterName: string,
): AmmoSpend | null {
  const kind = ammoKindForWeapon(weaponName);
  if (!kind) {
    // Not an ammunition weapon; nothing to track.
    return null;
  }
  const found = findAmmo(equipment, kind);
  if (!found) {
    return {
      ok: false,
      kind,
      error: `${characterName} is out of ${AMMO_LABELS[kind]} and cannot fire the ${weaponName}.`,
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
