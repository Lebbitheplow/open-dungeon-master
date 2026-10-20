// The optional Variant: Encumbrance rule (PHB 176), off by default and
// switched on per table through the `encumbrance` variant rule.
//
// The default rule is only a carrying-capacity ceiling nobody ever hits, so
// tracking pounds was a deliberate omission for a long time. A table that
// asks for the variant wants the opposite: the pack is a real decision, and
// counting it is exactly the bookkeeping a person wants the machine to do.
//
// Weight comes from the content pack (data/content/open5e.sqlite stamps a
// `weight` on every item row it has one for), with three fallbacks here: the
// SRD armor table, because Open5e ships every armor row blank, the SRD gear
// table, and the ammunition table, because an arrow line's count moves as
// it is fired.
// Anything still unknown is COUNTED AS UNKNOWN, never as zero: the result
// reports how many carried items had no weight so nobody reads a total as
// exact when it is not.
import { gearWeightLb } from "@/lib/srd/adventuring-gear";
import { matchArmor } from "@/lib/srd/armor";
import { rowName } from "@/lib/srd/item-row";
import { matchWeapon, SRD_WEAPON_WEIGHT_LB } from "@/lib/srd/weapons";
import { ammoCount, ammoKindForItem, AMMO_WEIGHT_LB } from "@/lib/srd/ammunition";
import { magicItemRiders, type Wearer, type WornMagicItem } from "@/lib/srd/magic-items";

// 50 coins weigh a pound, whatever the metal.
export const COINS_PER_POUND = 50;

// `qty` is optional because the lighter sheet shapes elsewhere in the app
// (the AC source, the builder's preview) carry only a name; a line without
// one counts as a single item.
export type CarriedItem = { name: string; qty?: number; weight?: number } & Partial<
  Pick<WornMagicItem, "slug" | "equipped" | "attuned" | "gear">
>;

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

// Where a line's weight came from: the line's own number (the content pack's,
// a workshop entry's, or one typed by hand), the ammunition table, or the SRD
// armor, gear or weapon table.
export type WeightSource = "item" | "ammunition" | "armor" | "gear" | "weapon";

// One inventory line as the load weighs it (issue #206: the breakdown behind
// the sheet's Carried tile is built from these, and so is the total, so the
// two cannot disagree).
export type LoadLine = {
  // Its place in the equipment list, so two lines of one name stay apart.
  index: number;
  name: string;
  // The count it is weighed by: the rounds an ammunition line holds (its
  // count lives in the name or the qty, never both), otherwise its qty, at
  // least one.
  qty: number;
  // Pounds for one and for the whole line; null when nothing knows.
  eachLb: number | null;
  totalLb: number | null;
  source: WeightSource | null;
};

// A stamped weight of 0 means "the source did not say" rather than
// "weightless", which is why it falls through to the other lookups.
export function loadLine(item: CarriedItem, index = 0): LoadLine {
  const ammo = ammoKindForItem(item);
  if (ammo) {
    // An ammunition line's count lives in its name or its qty and moves as
    // rounds are spent, so it is weighed per round rather than per line.
    const rounds = ammoCount({ name: item.name, qty: item.qty ?? 1 });
    const each = AMMO_WEIGHT_LB[ammo];
    return { index, name: item.name, qty: rounds, eachLb: each, totalLb: round2(each * rounds), source: "ammunition" };
  }
  const qty = Math.max(1, Math.floor(item.qty ?? 1));
  const weighed = (each: number, source: WeightSource): LoadLine => ({
    index,
    name: item.name,
    qty,
    eachLb: each,
    totalLb: round2(each * qty),
    source,
  });
  if (typeof item.weight === "number" && Number.isFinite(item.weight) && item.weight > 0) {
    return weighed(item.weight, "item");
  }
  const armor = matchArmor(item);
  if (armor) {
    return weighed(armor.weightLb, "armor");
  }
  // Adventuring gear and tools by their SRD weights (adventuring-gear.ts),
  // for a kit the content pack did not stamp.
  const gear = gearWeightLb(rowName(item));
  if (gear !== null) {
    return weighed(gear, "gear");
  }
  // Then a weapon by the SRD's table (a +1 longsword weighs a longsword's 3 lb).
  const weapon = matchWeapon(item);
  if (weapon && SRD_WEAPON_WEIGHT_LB[weapon.name] !== undefined) {
    return weighed(SRD_WEAPON_WEIGHT_LB[weapon.name], "weapon");
  }
  return { index, name: item.name, qty, eachLb: null, totalLb: null, source: null };
}

// What one line of the inventory weighs in total, or null when nothing
// knows.
export function lineWeightLb(item: CarriedItem): number | null {
  return loadLine(item).totalLb;
}

export function loadLines(equipment: CarriedItem[]): LoadLine[] {
  return equipment.map((item, index) => loadLine(item, index));
}

export type LoadSort = "total" | "each";
export type LoadOrder = "desc" | "asc";

// The breakdown's order: heaviest (or lightest) first by the chosen column,
// ties in the sheet's order, and a line of unknown weight always last, in
// sheet order, so it is never read as the lightest thing carried.
export function sortLoadLines(lines: LoadLine[], key: LoadSort, order: LoadOrder): LoadLine[] {
  const value = (line: LoadLine) => (key === "total" ? line.totalLb : line.eachLb);
  const known = lines.filter((line) => value(line) !== null);
  const unknown = lines.filter((line) => value(line) === null);
  known.sort((a, b) => {
    const gap = (value(a) as number) - (value(b) as number);
    return (order === "asc" ? gap : -gap) || a.index - b.index;
  });
  return [...known, ...unknown];
}

// What the purse weighs, to the hundredth the total is shown in.
export function coinWeightLb(coins: number): number {
  return round2(Math.max(0, coins) / COINS_PER_POUND);
}

export function carriedWeight(
  equipment: CarriedItem[],
  coins = 0,
): { pounds: number; unweighed: number } {
  let pounds = 0;
  let unweighed = 0;
  for (const line of loadLines(equipment)) {
    if (line.totalLb === null) {
      unweighed += 1;
      continue;
    }
    pounds += line.totalLb;
  }
  pounds += coinWeightLb(coins);
  return { pounds: round2(pounds), unweighed };
}

// The whole picture for one character. Pure: callers hand in the Strength
// score, the pack and the purse, and gate the result on their table's
// variant rule themselves.
//
// `strength` is the score written on the sheet. A worn item that sets
// Strength (Gauntlets of Ogre Power, a Belt of Giant Strength) is in the pack
// being weighed, so it is read here and every caller carries by the score the
// character really has.
export function encumbranceFor(input: {
  strength: number;
  equipment: CarriedItem[];
  coins?: number;
  size?: string;
  wearer?: Wearer;
}): Encumbrance {
  const setByItem = magicItemRiders(input.equipment ?? [], input.wearer).abilitySet.str ?? 0;
  const strength = Math.max(1, Math.floor(input.strength || 1), setByItem);
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
