// Whether a creature aloft can stay there, read from its conditions alone:
// no database here, so the board (src/lib/dm/token-state.ts) and the rows'
// own watch (src/lib/db/flight-watch.ts) ask the same question.

import { effectiveSpeed } from "@/lib/dm/condition-logic";
import { enemyExhaustion } from "@/lib/dm/monster-abilities";
import { isConditionNamed } from "@/lib/srd/feature-names";

// What a holder of conditions carries: a character's exhaustion is a level
// of its own, an enemy's rides its conditions ("exhaustion 2").
export type Aloft = { conditions: readonly string[]; exhaustion?: number | null };

// "If a flying creature is knocked prone, has its speed reduced to 0, or is
// otherwise deprived of the ability to move, the creature falls, unless it
// has the ability to hover or it is being held aloft by magic" (SRD 5.1,
// Flying Movement). Exhaustion 5 is a speed of 0 as well.
export function cannotStayAloft(holder: Aloft): boolean {
  const conditions = [...holder.conditions];
  const exhaustion = holder.exhaustion ?? enemyExhaustion(conditions);
  return conditions.some((entry) => isConditionNamed(entry, "prone")) || effectiveSpeed(conditions, 30) === 0 || exhaustion >= 5;
}

// Flight a spell gives (Fly, Gaseous Form, Wind Walk), or the flying speed a
// worn magic item gives (Winged Boots, any item src/lib/srd/magic-items.ts
// itemSpeeds reads a fly speed from): magic holds it up. The SRD's own
// example of "held aloft by magic, such as by the fly spell" is magic that
// grants a flying speed, so an item granting one holds its wearer the same
// way; without it a prone Winged Boots wearer fell like a harpy.
export function aloftByMagic(conditions: readonly string[], wornFlyingSpeed?: number | null): boolean {
  return Boolean(wornFlyingSpeed && wornFlyingSpeed > 0) || conditions.some((entry) => isConditionNamed(entry, "flying", "fly", "gaseous form", "wind walk"));
}

// Whether a write just took away what kept a flyer up: it falls the moment
// the condition lands, not when its next turn begins.
export function newlyGrounded(before: Aloft | null, after: Aloft | null): boolean {
  return Boolean(after && cannotStayAloft(after) && !(before && cannotStayAloft(before)));
}
