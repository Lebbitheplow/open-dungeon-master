// Spells whose result outlasts them when the caster holds concentration for
// the whole duration (SRD 5.1). Ending early ends the effect as any broken
// concentration does; running the full course leaves it:
//
//   Flesh to Stone  the creature is turned to stone until the effect is removed
//   True Polymorph  the transformation lasts until it is dispelled
//
// (Wall of Stone's permanent wall is the table's to narrate: the server lays
// no wall for it.) Read by src/lib/dm/concentration-clock.ts as the clock runs
// out, keyed by the spell or the published spell a workshop copy runs as.

import { textKey } from "@/lib/language/text-logic";

export type FullDurationRule = {
  // What every creature the casting still holds becomes, for good; absent,
  // its conditions simply stay, no longer bound to the spell.
  becomes?: string;
};

const FULL_DURATION: Record<string, FullDurationRule> = {
  "flesh to stone": { becomes: "petrified" },
  "true polymorph": {},
};

export function fullDurationRule(spell: string): FullDurationRule | null {
  return FULL_DURATION[textKey(spell)] ?? null;
}
