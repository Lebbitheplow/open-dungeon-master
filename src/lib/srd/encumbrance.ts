// The optional Variant: Encumbrance rule (PHB 176), off by default and
// switched on per table through the `encumbrance` variant rule.
//
// The default rule is only a carrying-capacity ceiling nobody ever hits, so
// tracking pounds was a deliberate omission for a long time. A table that
// asks for the variant wants the opposite: the pack is a real decision, and
// counting it is exactly the bookkeeping a person wants the machine to do.
//
// Weight comes from the content pack (data/content/open5e.sqlite stamps a
// `weight` on every item row it has one for), with two fallbacks here: the
// SRD armor table, because Open5e ships every armor row blank, and the
// ammunition table, because an arrow line's count moves as it is fired.
// Anything still unknown is COUNTED AS UNKNOWN, never as zero: the result
// reports how many carried items had no weight so nobody reads a total as
// exact when it is not.
import { matchArmor } from "@/lib/srd/armor";
import { ammoCount, ammoKindForItem, AMMO_WEIGHT_LB } from "@/lib/srd/ammunition";

// 50 coins weigh a pound, whatever the metal.
export const COINS_PER_POUND = 50;

// `qty` is optional because the lighter sheet shapes elsewhere in the app
// (the AC source, the builder's preview) carry only a name; a line without
// one counts as a single item.
export type CarriedItem = { name: string; qty?: number; weight?: number };

export type EncumbranceTier = "unencumbered" | "encumbered" | "heavily_encumbered";

export type Encumbrance = {
  carriedLb: number;
  // Carried items whose weight nothing could supply. The total above
  // excludes them, so a non-zero count means it is a floor, not a figure.
  unweighed: number;
  // Strength x 15: the most this character can carry at all.
  capacityLb: number;
  encumberedAtLb: number;
  heavilyEncumberedAtLb: number;
  tier: EncumbranceTier;
  // Feet off the walking speed: 0, 10 or 20.
  speedPenalty: number;
  // Disadvantage on STR, DEX and CON checks, attacks and saves.
  disadvantage: boolean;
  // Past the hard ceiling. RAW the character simply cannot pick it up; we
  // keep the heavily-encumbered penalties and say so instead of refusing a
  // grant the story already made.
  overCapacity: boolean;
  note: string | null;
};

// How much of the load a body of this size can bear. Tiny creatures carry
// half, and every size above Medium doubles again (PHB, "Carrying Capacity").
export function carryMultiplier(size: string | undefined): number {
  switch ((size ?? "medium").trim().toLowerCase()) {
    case "tiny":
      return 0.5;
    case "large":
      return 2;
    case "huge":
      return 4;
    case "gargantuan":
      return 8;
    default:
      return 1;
  }
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

// What one line of the inventory weighs in total, or null when nothing
// knows. A stamped weight of 0 means "the source did not say" rather than
// "weightless", which is why it falls through to the other lookups.
export function lineWeightLb(item: CarriedItem): number | null {
  const ammo = ammoKindForItem(item.name);
  if (ammo) {
    // An ammunition line's count lives in its name or its qty and moves as
    // rounds are spent, so it is weighed per round rather than per line.
    return round2(AMMO_WEIGHT_LB[ammo] * ammoCount({ name: item.name, qty: item.qty ?? 1 }));
  }
  const qty = Math.max(1, Math.floor(item.qty ?? 1));
  if (typeof item.weight === "number" && Number.isFinite(item.weight) && item.weight > 0) {
    return round2(item.weight * qty);
  }
  const armor = matchArmor(item.name);
  if (armor) {
    return round2(armor.weightLb * qty);
  }
  return null;
}

export function carriedWeight(
  equipment: CarriedItem[],
  coins = 0,
): { pounds: number; unweighed: number } {
  let pounds = 0;
  let unweighed = 0;
  for (const item of equipment) {
    const line = lineWeightLb(item);
    if (line === null) {
      unweighed += 1;
      continue;
    }
    pounds += line;
  }
  pounds += Math.max(0, coins) / COINS_PER_POUND;
  return { pounds: round2(pounds), unweighed };
}

// The whole picture for one character. Pure: callers hand in the Strength
// score, the pack and the purse, and gate the result on their table's
// variant rule themselves.
export function encumbranceFor(input: {
  strength: number;
  equipment: CarriedItem[];
  coins?: number;
  size?: string;
}): Encumbrance {
  const strength = Math.max(1, Math.floor(input.strength || 1));
  const multiplier = carryMultiplier(input.size);
  const { pounds, unweighed } = carriedWeight(input.equipment ?? [], input.coins ?? 0);
  const encumberedAtLb = round2(strength * 5 * multiplier);
  const heavilyEncumberedAtLb = round2(strength * 10 * multiplier);
  const capacityLb = round2(strength * 15 * multiplier);

  const tier: EncumbranceTier =
    pounds > heavilyEncumberedAtLb
      ? "heavily_encumbered"
      : pounds > encumberedAtLb
        ? "encumbered"
        : "unencumbered";
  const overCapacity = pounds > capacityLb;
  const speedPenalty = tier === "heavily_encumbered" ? 20 : tier === "encumbered" ? 10 : 0;
  const carried = `${pounds} lb`;
  const note =
    tier === "heavily_encumbered"
      ? `heavily encumbered (${carried} of a ${heavilyEncumberedAtLb} lb limit): speed -20 and disadvantage on STR, DEX and CON rolls`
      : tier === "encumbered"
        ? `encumbered (${carried} of a ${encumberedAtLb} lb limit): speed -10`
        : null;

  return {
    carriedLb: pounds,
    unweighed,
    capacityLb,
    encumberedAtLb,
    heavilyEncumberedAtLb,
    tier,
    speedPenalty,
    disadvantage: tier === "heavily_encumbered",
    overCapacity,
    note,
  };
}

// The abilities encumbrance weighs down: everything physical.
const ENCUMBERED_ABILITIES = new Set(["str", "dex", "con"]);

export function encumbranceCovers(ability: string | undefined | null): boolean {
  return ability ? ENCUMBERED_ABILITIES.has(ability) : false;
}
