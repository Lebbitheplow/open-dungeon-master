// Underwater combat (SRD 5.1, Combat: Underwater Combat). On the board a
// creature standing in a water square ("~", a swim) is under the water:
// ODM's water squares are the deep kind every walker swims through, so they
// are read as full immersion. A creature flying over them is not in them.
//   - A melee weapon attack by a creature without a swimming speed is at
//     disadvantage unless the weapon is a dagger, javelin, shortsword, spear
//     or trident.
//   - A ranged weapon attack automatically misses a target beyond the
//     weapon's normal range; within it, the roll has disadvantage unless the
//     weapon is a crossbow, a net, or a weapon thrown like a javelin (a
//     spear, a trident or a dart).
//   - A creature fully immersed in water has resistance to fire damage.
// Spell attacks are none of these.

import { getBattleMapForEncounter, getTokenByRef } from "@/lib/db/battle-maps";
import { getActiveBoard } from "@/lib/db/encounters";
import { TERRAIN, tileAt } from "@/lib/battlemap/types";
import { tilesBetween } from "@/lib/dm/attack-spatial";

const MELEE_UNDERWATER = /\b(dagger|javelin|shortsword|spear|trident)s?\b/i;
const RANGED_UNDERWATER = /\b(crossbow|net|javelin|spear|trident|dart)s?\b/i;

export type UnderwaterSwing = { disadvantage: boolean; misses: boolean; note: string | null };

const CLEAR: UnderwaterSwing = { disadvantage: false, misses: false, note: null };

// One weapon attack made by a creature under the water. Pure.
export function underwaterSwing(input: {
  weapon: string;
  // The swing is a melee one (a thrown weapon used in reach is melee).
  melee: boolean;
  // The attacker has a swimming speed (a stat block's swim, a feature's).
  swims: boolean;
  // The target stands past the weapon's normal range.
  beyondNormal: boolean;
  spell?: boolean;
}): UnderwaterSwing {
  if (input.spell) {
    return CLEAR;
  }
  if (input.melee) {
    return input.swims || MELEE_UNDERWATER.test(input.weapon)
      ? CLEAR
      : { disadvantage: true, misses: false, note: `underwater: a ${input.weapon} swung without a swimming speed is at disadvantage` };
  }
  if (input.beyondNormal) {
    return { disadvantage: false, misses: true, note: `underwater: a ranged attack past the ${input.weapon}'s normal range misses` };
  }
  return RANGED_UNDERWATER.test(input.weapon)
    ? CLEAR
    : { disadvantage: true, misses: false, note: `underwater: a ${input.weapon} shot through water is at disadvantage` };
}

// Whether a combatant stands in a water square of the board in play.
export function isImmersed(campaignId: string, refId: string): boolean {
  const encounter = getActiveBoard(campaignId);
  const map = encounter ? getBattleMapForEncounter(encounter.id) : null;
  const token = map ? getTokenByRef(map.id, refId) : null;
  if (!map || !token || token.movement === "fly") {
    return false;
  }
  return tileAt(map.terrain, map.width, token.x, token.y) === TERRAIN.water;
}

// The resistance immersion adds to a creature's own: "fire", or "".
export function immersedResistance(campaignId: string, refId: string): string {
  return isImmersed(campaignId, refId) ? "fire" : "";
}

// A stat block's resistance line with immersion's fire added.
export function resistLineFor(campaignId: string, enemy: { id: string; stats: { resist?: string } }): string {
  const extra = immersedResistance(campaignId, enemy.id);
  return [enemy.stats.resist ?? "", extra].filter(Boolean).join("; ");
}

// A character's ranged weapon attack from under the water at a target past
// its normal range: it would miss, so it is refused before anything is
// spent. Null when the rule does not apply.
export function underwaterRangeProblem(
  campaignId: string,
  encounterId: string,
  attackerId: string,
  profile: { weapon: string; ranged: boolean; thrown: boolean; rangeTiles: number },
  target: { id: string; displayName: string },
): string | null {
  const apart = tilesBetween(encounterId, attackerId, target.id);
  if (apart === null || !isImmersed(campaignId, attackerId)) {
    return null;
  }
  const ranged = profile.ranged || (profile.thrown && apart > 1);
  if (!ranged || apart <= profile.rangeTiles) {
    return null;
  }
  return `Underwater, a ranged weapon attack past the weapon's normal range misses: ${target.displayName} is ${apart * 5} ft away and the ${profile.weapon}'s normal range is ${profile.rangeTiles * 5} ft. Nothing was spent; close the distance or use a melee weapon.`;
}
