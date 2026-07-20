// CR-scaled treasure, a simplified reading of the DMG hoard tables: the coin
// value of a hoard rises by tier, and a hoard may carry a few magic items.
// Pure and table-driven so scripts/test-world.mjs can exercise it without a
// database; the actual coins are applied through modify_gold and the item
// count guides how many grant_item calls the model makes.

export type TreasureTier = 1 | 2 | 3 | 4; // CR 0-4, 5-10, 11-16, 17+

export function treasureTierForCr(cr: number): TreasureTier {
  const value = Number(cr) || 0;
  if (value <= 4) return 1;
  if (value <= 10) return 2;
  if (value <= 16) return 3;
  return 4;
}

// Gold value of a hoard by tier: a dice expression and a multiplier, kept
// modest enough not to wreck a campaign's economy but scaling clearly with
// tier. Individual treasure (a single defeated foe) is a tenth of a hoard.
const HOARD_GP: Record<TreasureTier, { dice: string; mult: number }> = {
  1: { dice: "4d6", mult: 10 },
  2: { dice: "3d6", mult: 100 },
  3: { dice: "2d6", mult: 1000 },
  4: { dice: "3d6", mult: 5000 },
};

export function hoardGoldDice(tier: TreasureTier): { dice: string; mult: number } {
  return HOARD_GP[tier];
}

// How many magic items a hoard of this tier tends to carry (a hint for the
// model's grant_item calls, not a hard rule).
const HOARD_ITEMS: Record<TreasureTier, number> = { 1: 0, 2: 1, 3: 2, 4: 3 };

export function hoardItemCount(tier: TreasureTier): number {
  return HOARD_ITEMS[tier];
}
