// The gear receipt (backlog F14): one line per item in the pack, saying how
// many, how many the kit gave free and how many were bought, what each costs
// and what is left of the purse. Pure, so scripts/test-builder-gear-receipt.mjs
// can check it without React.
//
// The free and paid split is the purse's own (judgeStartingGear in
// src/lib/srd/starting-wealth.ts): the kit's copies of a name are free, the
// rest are bought at the layered price, and a homebrew, magic or unpriced
// copy cannot be bought at all. The receipt only spells that arithmetic out
// per line; the purse and the server still decide.

import { weaponAttackProfile, weaponOf, type AttackProfile, type ResolvedWeapon } from "@/lib/dm/attack-logic";
import { magicWeaponOfRow } from "@/lib/dm/gear-attack";
import type { EquipmentItem as SheetItem } from "@/lib/schemas/sheet";
import type { DerivedPart, SheetDerived } from "@/lib/srd";
import type { CombatRiders } from "@/lib/srd/feature-effects";
import { gearNameKey, type PriceLookup } from "@/lib/srd/starting-wealth";
import { matchWeapon } from "@/lib/srd/weapons";

// The most of one item a receipt line takes: a typo of 5000 torches is not a
// purchase anyone means.
export const MAX_QTY = 999;

export type WeaponLine = {
  toHit: number;
  damage: string;
  damageType: string;
  notes: string[];
  // How the to-hit is made, read off the attack profile (the build math
  // table shows it): the ability, the proficiency, a magic bonus and what
  // the features add, summing to toHit.
  toHitParts: DerivedPart[];
  // The ability the damage adds, upper case ("STR").
  ability: string;
};

export type ReceiptRow = {
  name: string;
  slug?: string;
  qty: number;
  // Copies the class or background kit put in the pack. They come and go
  // together: the kit's two daggers are one removal, not two.
  preAdded: number;
  // Copies the purse does not charge for, and copies it does.
  free: number;
  bought: number;
  // The price of one copy in copper; null when it has none to buy at.
  unitCopper: number | null;
  costCopper: number;
  // Why the bought copies cannot be paid for, when they cannot.
  refused: "homebrew" | "magic" | "unpriced" | null;
  weapon: WeaponLine | null;
};

export type Receipt = {
  rows: ReceiptRow[];
  coinCopper: number;
  spentCopper: number;
  leftCopper: number;
};

// The purse's own key, so a free copy is matched exactly as the purse
// matches it.
const key = gearNameKey;

// The receipt for a pack. `equipment` is the merged pack the builder shows
// (one row per name), `preAdded` how many of each name the kits put there,
// `freeKit` the names the purse gives free (one entry per copy, empty under
// rolled wealth), as the purse is judged.
export function buildReceipt(input: {
  equipment: Array<{ name: string; qty: number; slug?: string }>;
  preAdded: Map<string, number>;
  freeKit: string[];
  coinCopper: number;
  priceOf: PriceLookup;
}): Receipt {
  const free = new Map<string, number>();
  for (const name of input.freeKit) {
    free.set(key(name), (free.get(key(name)) ?? 0) + 1);
  }
  let spentCopper = 0;
  const rows = input.equipment.map((item): ReceiptRow => {
    const left = free.get(key(item.name)) ?? 0;
    const given = Math.min(left, item.qty);
    free.set(key(item.name), left - given);
    const bought = item.qty - given;
    const price = input.priceOf(item.name);
    const homebrew = item.slug?.startsWith("homebrew:") ?? false;
    const refused = bought <= 0 ? null : homebrew ? "homebrew" : price.magic ? "magic" : price.copper === null ? "unpriced" : null;
    const unitCopper = homebrew || price.magic ? null : price.copper;
    const costCopper = refused || unitCopper === null ? 0 : unitCopper * bought;
    spentCopper += costCopper;
    return {
      name: item.name,
      ...(item.slug ? { slug: item.slug } : {}),
      qty: item.qty,
      preAdded: Math.min(item.qty, input.preAdded.get(key(item.name)) ?? 0),
      free: given,
      bought,
      unitCopper,
      costCopper,
      refused,
      weapon: null,
    };
  });
  return {
    rows,
    coinCopper: input.coinCopper,
    spentCopper,
    leftCopper: Math.max(0, input.coinCopper - spentCopper),
  };
}

// The quantity a line settles on when the player asks for `wanted`. The
// kit's copies come as a set, so a count between none and the kit's is the
// kit's; anything over it is bought.
export function settleQty(row: Pick<ReceiptRow, "preAdded">, wanted: number): number {
  if (!Number.isFinite(wanted) || wanted <= 0) {
    return 0;
  }
  const whole = Math.min(MAX_QTY, Math.floor(wanted));
  return whole < row.preAdded ? row.preAdded : whole;
}

// One fewer, from the stepper: down to the kit's copies, then none.
export function stepDown(row: Pick<ReceiptRow, "qty" | "preAdded">): number {
  return row.qty - 1 < row.preAdded ? 0 : row.qty - 1;
}

// The player's own list of added gear with `name` at `qty` copies beyond the
// kit's: the entry is updated, added or dropped. The kit's copies are not in
// this list; they leave through the removed-names list instead.
export function withAddedQty<T extends { name: string; qty: number; slug?: string }>(
  equipment: T[],
  name: string,
  qty: number,
  slug?: string,
): T[] {
  const held = equipment.some((item) => item.name === name);
  if (qty <= 0) {
    return held ? equipment.filter((item) => item.name !== name) : equipment;
  }
  if (held) {
    return equipment.map((item) => (item.name === name ? { ...item, qty } : item));
  }
  return [...equipment, { name, qty, ...(slug ? { slug } : {}) } as T];
}

// The to-hit and damage line for a weapon in the pack, by the function the
// sheet's attack cards and the attack engine use (weaponAttackProfile), with
// the same riders: fighting styles, Martial Arts, a magic weapon's bonus.
// Null for anything that is not a weapon. A row resolves its weapon the way
// carriedWeapons in src/lib/battlemap/hand.ts does.
// The ability an attack swings with, as the sheet's parts name it.
const ATTACK_ABILITY: Record<AttackProfile["ability"], string> = { str: "STR", dex: "DEX" };

export function weaponLineFor(
  item: SheetItem,
  derived: Pick<SheetDerived, "abilityMods" | "proficiencyBonus">,
  weaponProfs: string[],
  riders: CombatRiders,
  martialArts: boolean,
): WeaponLine | null {
  const magic = magicWeaponOfRow(item);
  const srd = (magic.gear ? magic.srd : null) ?? weaponOf(item) ?? matchWeapon(item);
  if (!srd) {
    return null;
  }
  const resolved: ResolvedWeapon = {
    displayName: item.name,
    srd,
    unarmed: false,
    ...(magic.gear ? { gear: magic.gear } : {}),
  };
  const profile = weaponAttackProfile(derived, weaponProfs, resolved, { riders, martialArts });
  const notes = [...profile.riderNotes];
  if (!profile.proficient) {
    notes.push("Not proficient");
  }
  const abilityPart = { label: `${ATTACK_ABILITY[profile.ability]} modifier`, value: derived.abilityMods[profile.ability] };
  const proficiency = { label: "proficiency", value: profile.proficient ? derived.proficiencyBonus : 0 };
  const magicPart = { label: "magic", value: profile.magicBonus };
  // A fighting style's to-hit (Archery) is the rest; the notes name it.
  const features = { label: "features", value: profile.toHit - abilityPart.value - proficiency.value - magicPart.value };
  return {
    toHit: profile.toHit,
    damage: profile.damageExpression,
    damageType: profile.damageType,
    notes,
    toHitParts: [abilityPart, proficiency, magicPart, features].filter((part, index) => index === 0 || part.value !== 0),
    ability: ATTACK_ABILITY[profile.ability],
  };
}

// Coin as the purse line writes it: gold and the copper under a gold piece.
export function formatCoin(copper: number): string {
  const gold = Math.floor(copper / 100);
  const rest = copper % 100;
  return [gold ? `${gold} gp` : "", rest ? `${rest} cp` : ""].filter(Boolean).join(" ") || "0 gp";
}
