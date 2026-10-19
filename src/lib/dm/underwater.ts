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

// The SRD weapons each rule names, by their rows' names (src/lib/srd/
// weapons.ts): the weapon an attack swings as, never words in the name it is
// carried under.
const MELEE_UNDERWATER = ["Dagger", "Javelin", "Shortsword", "Spear", "Trident"];
const RANGED_UNDERWATER = ["Hand Crossbow", "Light Crossbow", "Heavy Crossbow", "Net", "Javelin", "Spear", "Trident", "Dart"];

export type UnderwaterSwing = { disadvantage: boolean; misses: boolean; note: string | null };

const CLEAR: UnderwaterSwing = { disadvantage: false, misses: false, note: null };

// One weapon attack made by a creature under the water. Pure.
export function underwaterSwing(input: {
  // The name it is carried under, for the note, and the SRD weapon it is.
  weapon: string;
  base: string | undefined;
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
    return input.swims || MELEE_UNDERWATER.includes(input.base ?? "")
      ? CLEAR
      : { disadvantage: true, misses: false, note: `underwater: a ${input.weapon} swung without a swimming speed is at disadvantage` };
  }
  if (input.beyondNormal) {
    return { disadvantage: false, misses: true, note: `underwater: a ranged attack past the ${input.weapon}'s normal range misses` };
  }
  return RANGED_UNDERWATER.includes(input.base ?? "")
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
// its normal range "automatically misses" (SRD 5.1, Underwater Combat): the
// attack is made, and spent, and misses. The reason, or null when the rule
// does not apply.
export function underwaterRangeMiss(
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
  return `Underwater, a ranged weapon attack past the weapon's normal range misses: ${target.displayName} is ${apart * 5} ft away and the ${profile.weapon}'s normal range is ${profile.rangeTiles * 5} ft.`;
}
