// When a reaction can still be taken by a character the triggering hit just
// dropped (issue 233). A reaction is "an instant response to a trigger" (PHB,
// Reactions), and a creature at 0 hit points is unconscious and takes none;
// what the reaction does to its trigger decides which of the two comes first:
//
//   answers  acts on the triggering attack or damage itself (Shield, Uncanny
//            Dodge, Stone's Endurance): taken as the hit lands, so judged as
//            the character stood before it.
//   at_zero  is triggered by being reduced to 0 hit points (Strength before
//            Death, Necrotic Husk): allowed exactly then, refused otherwise.
//   after    follows the damage and does not change it (Hellish Rebuke,
//            Misty Escape, Wrath of the Storm): a character the hit dropped
//            is unconscious and cannot take it. Every reaction not named as
//            one of the other two is this one.
//
// A reaction that answers a hit on someone else is judged as the reactor is
// now: the "as before" reading is only for a hit on the reactor themselves.
// Pure: no imports beyond types and the name helpers, so every tool and the
// tests read one table.
import type { ReactionDoes } from "@/lib/srd/authored-effects-types";
import { isNamed } from "@/lib/srd/feature-names";

export type ReactionTiming = "answers" | "at_zero" | "after";

const AT_ZERO = ["strength before death", "necrotic husk"];

// Kind A, by the words of each feature's trigger: the PHB, XGtE, TCoE, FToD
// and VRGtR reactions that change the attack or damage that triggered them,
// with the spells that do (Shield "including against the triggering attack",
// Absorb Elements "the triggering damage", Feather Fall, Silvery Barbs).
const ANSWERS = [
  "uncanny dodge",
  "deflect missiles",
  "deflect missile",
  "slow fall",
  "feather fall",
  "shield",
  "absorb elements",
  "silvery barbs",
  "defensive duelist",
  "parry",
  "warding flare",
  "entropic ward",
  "illusory self",
  "instinctive charm",
  "sentinel at death's door",
  "glorious defense",
  "spell thief",
  "stone's endurance",
  "stones endurance",
  "swarming dispersal",
  "one with the word",
  "warding maneuver",
  "lucky",
  "fortunate",
  "cutting words",
  "protection",
  "ice pick",
];

// By the reaction's whole name (src/lib/srd/feature-names.ts): Shield of
// Faith is no Shield.
export function reactionTimingOf(name: string): ReactionTiming {
  if (isNamed(name, ...AT_ZERO)) {
    return "at_zero";
  }
  if (isNamed(name, ...ANSWERS)) {
    return "answers";
  }
  return "after";
}

// An authored reaction's timing, from what it does to the hit: lowering it,
// raising the AC against it, rolling it again, resisting it, taking it in an
// ally's place or turning it aside all act on the triggering attack; striking
// back, attacking, a save, a move or a condition follow it.
export function timingOfDoes(does: ReactionDoes): ReactionTiming {
  switch (does.kind) {
    case "reduce":
    case "ac_vs_hit":
    case "disadv_vs_hit":
    case "resist_instance":
    case "take_for_ally":
    case "redirect":
    case "force_miss":
    case "attack_penalty":
      return "answers";
    default:
      return "after";
  }
}

// The limited-use reactions src/lib/dm/reaction-counters.ts carries out when
// use_resource spends them: their dice are rolled and applied there, not by
// a counter's fx.
export const COUNTER_REACTION_IDS = [
  "race_stones_endurance",
  "sub_swarming_dispersal",
  "sub_one_with_the_word",
  "sub_warding_maneuver",
  "sub_necrotic_husk",
  "sub_strength_before_death",
];
