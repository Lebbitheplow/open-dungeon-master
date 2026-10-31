// A bag of caltrops or ball bearings spread on the board (SRD 5.1
// Adventuring Gear): use_item spends the bag and lays its area here, the
// square in front of the user (toward the nearest foe on the board, else
// their own), and the zone triggers do the rest (src/lib/battlemap/
// zones-gear.ts). Off a board the bag is spent and the GM narrates where it
// lies.

import { getBattleMapForEncounter, getTokenByRef, listTokens } from "@/lib/db/battle-maps";
import { getActiveBoard } from "@/lib/db/encounters";
import type { Campaign } from "@/lib/db/campaigns";
import { placeSpellZone } from "@/lib/dm/zone-cast";
import { matchGear } from "@/lib/srd/adventuring-gear";
import { GEAR_ZONES } from "@/lib/battlemap/zones-gear";
import type { CharacterSheet } from "@/lib/schemas/sheet";

const SPREAD = GEAR_ZONES.map((entry) => ({ ...entry, row: matchGear(entry.gear) }));

// Lays the area of the bag just used, or null when the item is no such bag
// or there is no board. Returns the line use_item's result carries.
export function spreadGear(campaign: Campaign, user: CharacterSheet, itemName: string): string | null {
  const row = matchGear(itemName);
  const spread = row ? SPREAD.find((entry) => entry.row === row) : undefined;
  const encounter = spread ? getActiveBoard(campaign.id) : null;
  const map = encounter ? getBattleMapForEncounter(encounter.id) : null;
  const own = map ? getTokenByRef(map.id, user.id) : null;
  if (!spread || !map || !own) {
    return null;
  }
  const apart = (token: { x: number; y: number }) => Math.max(Math.abs(token.x - own.x), Math.abs(token.y - own.y));
  const nearest = listTokens(map.id)
    .filter((token) => token.kind === "enemy")
    .reduce<{ x: number; y: number } | null>((best, token) => (!best || apart(token) < apart(best) ? token : best), null);
  const at = nearest
    ? { x: own.x + Math.sign(nearest.x - own.x), y: own.y + Math.sign(nearest.y - own.y) }
    : { x: own.x, y: own.y };
  return placeSpellZone(campaign, { spell: spread.zone, caster: { kind: "pc", id: user.id, name: user.name }, dc: spread.dc, at });
}
