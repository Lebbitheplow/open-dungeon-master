// What a new character may start with, under the table's startingWealth
// setting. Pure: the prices of the content pack arrive through `priceOf`, and
// the SRD 5.1 weapon and armor prices below answer when there is no pack.
//
// "equipment" (the default): the class's gear and the background's kit are
// free, the background's coin is the purse, and anything more is bought out
// of that purse at its listed price.
// "rolled": the server rolls the class's starting wealth (SRD 5.1, Starting
// Wealth by Class) in place of the gear, and everything carried is bought
// out of it.
//
// Nothing magical and nothing without a listed price can be bought at
// creation: such things are found or granted in play.
import { matchMagicItem } from "@/lib/srd/magic-items";

export const STARTING_WEALTH_METHODS = ["equipment", "rolled"] as const;
export type StartingWealthMethod = (typeof STARTING_WEALTH_METHODS)[number];

export type WealthDice = { count: number; sides: number; multiplier: number };

// SRD 5.1, Starting Wealth by Class. The artificer and the setting classes
// are ODM's; they take the commonest row.
const CLASS_WEALTH: Record<string, WealthDice> = {
  barbarian: { count: 2, sides: 4, multiplier: 10 },
  bard: { count: 5, sides: 4, multiplier: 10 },
  cleric: { count: 5, sides: 4, multiplier: 10 },
  druid: { count: 2, sides: 4, multiplier: 10 },
  fighter: { count: 5, sides: 4, multiplier: 10 },
  monk: { count: 5, sides: 4, multiplier: 1 },
  paladin: { count: 5, sides: 4, multiplier: 10 },
  ranger: { count: 5, sides: 4, multiplier: 10 },
  rogue: { count: 4, sides: 4, multiplier: 10 },
  sorcerer: { count: 3, sides: 4, multiplier: 10 },
  warlock: { count: 4, sides: 4, multiplier: 10 },
  wizard: { count: 4, sides: 4, multiplier: 10 },
};
const DEFAULT_WEALTH: WealthDice = { count: 4, sides: 4, multiplier: 10 };

export function startingWealthDice(classId: string): WealthDice {
  return CLASS_WEALTH[classId.trim().toLowerCase()] ?? DEFAULT_WEALTH;
}

export function describeWealthDice(dice: WealthDice): string {
  return `${dice.count}d${dice.sides}${dice.multiplier > 1 ? ` x ${dice.multiplier}` : ""} gp`;
}

// Gold pieces from the faces the server rolled.
export function wealthFromFaces(classId: string, faces: number[]): number {
  const dice = startingWealthDice(classId);
  return faces.reduce((sum, face) => sum + face, 0) * dice.multiplier;
}

// The most coin any character arrives with who did not earn it at a table
// the server saw: what a file or a library build may claim, by level. ODM's
// own ceiling (the SRD leaves wealth above 1st level to the DM): the purse
// and the best starting roll at 1st level, then a tier's worth of treasure.
export function wealthCeilingGold(level: number): number {
  const clamped = Math.max(1, Math.min(20, Math.floor(level)));
  if (clamped >= 17) {
    return 25_000;
  }
  if (clamped >= 11) {
    return 7_500;
  }
  if (clamped >= 5) {
    return 1_000;
  }
  return 225 + (clamped - 1) * 75;
}

// SRD 5.1 prices in gold pieces, for the weapons and armor the bundled
// tables carry. The setting gear is priced beside its nearest SRD kin.
const PRICES_GP: Record<string, number> = {
  club: 0.1, dagger: 2, greatclub: 0.2, handaxe: 5, javelin: 0.5, "light hammer": 2, mace: 5,
  quarterstaff: 0.2, sickle: 1, spear: 1, "light crossbow": 25, dart: 0.05, shortbow: 25,
  sling: 0.1, battleaxe: 10, flail: 10, glaive: 20, greataxe: 30, greatsword: 50, halberd: 20,
  lance: 10, longsword: 15, maul: 10, morningstar: 15, pike: 5, rapier: 25, scimitar: 25,
  shortsword: 10, trident: 5, "war pick": 5, warhammer: 15, whip: 2, blowgun: 10,
  "hand crossbow": 75, "heavy crossbow": 50, longbow: 50, net: 1,
  pistol: 75, revolver: 75, "sawed-off scattergun": 50, "hunting rifle": 50, musket: 50,
  "hand cannon": 75, monoblade: 25, chainblade: 50, "shock baton": 15, vibroknife: 10,
  "ripper gauntlet": 10, "heavy spanner": 5, "sword cane": 25, machete: 10, crowbar: 2,
  "silvered stake": 5, "censer mace": 5, "hurled vial": 1,
  padded: 5, leather: 10, "leather armor": 10, "studded leather": 45, hide: 10,
  "chain shirt": 50, "scale mail": 50, breastplate: 400, "half plate": 750, "ring mail": 30,
  "chain mail": 75, splint: 200, plate: 1500, shield: 10,
  "armorweave vest": 10, "kevlar vest": 45, "riot plating": 75, "brass carapace": 50,
  "scrap plate": 50, "ballistic shield": 10,
};

const key = (name: string) =>
  name
    .trim()
    .toLowerCase()
    .replace(/\(\s*\d+\s*\)\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();

export function bundledPriceCopper(name: string): number | null {
  const wanted = key(name);
  const gold = PRICES_GP[wanted] ?? PRICES_GP[wanted.replace(/ armor$/, "")] ?? null;
  return gold === null ? null : Math.round(gold * 100);
}

export type ItemPrice = { copper: number | null; magic: boolean };
export type PriceLookup = (name: string) => ItemPrice;

// Whether a name reads as a magic item: a bonus in the name, or one of the
// items the magic item engine knows by that name.
export function looksMagical(name: string): boolean {
  if (/(^|\s)\+\d/.test(name)) {
    return true;
  }
  const known = matchMagicItem(name);
  return Boolean(known) && key(name).includes(known!.match);
}

// The price lookup with no content pack behind it.
export const bundledPrices: PriceLookup = (name) => ({
  copper: bundledPriceCopper(name),
  magic: looksMagical(name),
});

export type GearItem = { name: string; qty: number; slug?: string };

export type GearVerdict = {
  problems: string[];
  // What the gear cost, in copper; the purse is the coin less this.
  spentCopper: number;
};

const gp = (copper: number) => {
  const gold = copper / 100;
  return `${Number.isInteger(gold) ? gold : gold.toFixed(2)} gp`;
};

// Holds a new character's pack to what its coin could buy. `freeKit` is the
// gear that costs nothing (the class's and the background's, under
// "equipment"); everything else is paid for from `coinCopper`.
export function judgeStartingGear(input: {
  equipment: GearItem[];
  freeKit: string[];
  coinCopper: number;
  priceOf: PriceLookup;
}): GearVerdict {
  const problems: string[] = [];
  const free = new Map<string, number>();
  for (const name of input.freeKit) {
    free.set(key(name), (free.get(key(name)) ?? 0) + 1);
  }
  let spentCopper = 0;
  for (const item of input.equipment) {
    const left = free.get(key(item.name)) ?? 0;
    const given = Math.min(left, item.qty);
    if (given > 0) {
      free.set(key(item.name), left - given);
    }
    const bought = item.qty - given;
    if (bought <= 0) {
      continue;
    }
    if (item.slug?.startsWith("homebrew:")) {
      problems.push(
        `${item.name} is homebrew gear, which whoever runs the table grants in play; a new character starts with listed gear only.`,
      );
      continue;
    }
    const price = input.priceOf(item.name);
    if (price.magic) {
      problems.push(
        `${item.name} is a magic item, and those are found in play; a new character starts with mundane gear.`,
      );
      continue;
    }
    if (price.copper === null) {
      problems.push(
        `${item.name} has no listed price, so it cannot be bought at creation; ask whoever runs the table to grant it in play.`,
      );
      continue;
    }
    spentCopper += price.copper * bought;
  }
  if (!problems.length && spentCopper > input.coinCopper) {
    problems.push(
      `That gear costs ${gp(spentCopper)} beyond the starting kit and the character has ${gp(input.coinCopper)} to spend; remove ${gp(spentCopper - input.coinCopper)} of it.`,
    );
  }
  return { problems, spentCopper };
}
