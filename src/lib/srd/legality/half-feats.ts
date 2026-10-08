// Half-feats taken when a character is made: the ability point a feat such
// as Actor or Resilient gives, and Resilient's saving throw.
//
// A level-up applies them to the stored scores (src/lib/srd/level-up.ts). A
// character made in the builder takes feats in two places, its Ability Score
// Improvement slots (asiChoices, mode "feat") and, for a variant human, the
// race's own feat (sheet.feats, with the score in racialChoices.featAbility).
// The builder sends the scores before those points; the creation check adds
// them the same way the level-up does. A stored sheet already holds them, so
// the check takes them back off before asking which method gave the scores.
import type { Ability, AbilityScores, AsiChoice } from "@/lib/schemas/sheet";
import {
  applyFeatIncrease,
  featAbilityIncrease,
  featSaveProficiency,
} from "@/lib/srd/feat-effects";
import { lower } from "@/lib/srd/legality/types";

export type HalfFeatPick = { feat: string; ability: Ability | null };

type FeatHolder = {
  feats?: string[];
  asiChoices?: AsiChoice[];
  racialChoices?: { featAbility?: Ability | "" } | null;
};

// Every feat the sheet took at creation that raises a score, with the score
// it names (null where the feat offers a choice and none was made). The
// race's feats are the ones not recorded against an improvement, first in
// the list: the builder writes them after the improvements' feats, and a
// level-up records its own choice.
export function halfFeatPicks(sheet: FeatHolder, racialFeats: number): HalfFeatPick[] {
  const picks: HalfFeatPick[] = [];
  const recorded = new Set<string>();
  for (const choice of sheet.asiChoices ?? []) {
    if (choice.mode !== "feat") {
      continue;
    }
    recorded.add(lower(choice.feat));
    if (featAbilityIncrease(choice.feat)) {
      picks.push({ feat: choice.feat, ability: resolved(choice.feat, choice.ability ?? null) });
    }
  }
  const racial = (sheet.feats ?? []).filter((feat) => !recorded.has(lower(feat))).slice(0, racialFeats);
  for (const feat of racial) {
    if (featAbilityIncrease(feat)) {
      picks.push({ feat, ability: resolved(feat, sheet.racialChoices?.featAbility || null) });
    }
  }
  return picks;
}

// The score a feat raises: its only one, or the chosen one when the feat
// offers it.
function resolved(feat: string, chosen: Ability | null): Ability | null {
  const increase = featAbilityIncrease(feat);
  if (!increase) {
    return null;
  }
  if (increase.from.length === 1) {
    return increase.from[0];
  }
  return chosen && increase.from.includes(chosen) ? chosen : null;
}

// The points a stored sheet's half-feats already put into its scores, one
// ability per point, for the scores check to take off.
export function halfFeatPoints(picks: HalfFeatPick[]): Ability[] {
  return picks.flatMap((pick) => (pick.ability ? [pick.ability] : []));
}

// The scores after the half-feats, each capped at 20, and the saving throws
// Resilient adds. A missing or wrong choice is refused with the level-up's
// own sentence.
export function applyHalfFeats(
  abilities: AbilityScores,
  picks: HalfFeatPick[],
): { abilities: AbilityScores; saves: Ability[] } | { error: string } {
  let next = { ...abilities };
  const saves: Ability[] = [];
  for (const pick of picks) {
    const raised = applyFeatIncrease(next, pick.feat, pick.ability);
    if ("error" in raised) {
      return { error: raised.error };
    }
    next = raised.abilities;
    const save = featSaveProficiency(pick.feat, raised.raised);
    if (save) {
      saves.push(save);
    }
  }
  return { abilities: next, saves };
}

// The scores the builder shows: what the creation check will store once it
// adds these half-feats. A choosing feat with no score picked yet counts the
// first it offers, which is what the builder sends for it (submit.ts); a
// pick the check would refuse shows the scores unraised.
export function scoresWithHalfFeats(
  abilities: AbilityScores,
  picks: HalfFeatPick[],
): { abilities: AbilityScores; saves: Ability[] } {
  const out = applyHalfFeats(abilities, settledHalfFeats(picks));
  return "error" in out ? { abilities, saves: [] } : out;
}

// The picks with a choosing feat's unpicked score filled in as the builder
// sends it: the first the feat offers.
export function settledHalfFeats(picks: HalfFeatPick[]): HalfFeatPick[] {
  return picks.map((pick) => ({
    ...pick,
    ability: pick.ability ?? featAbilityIncrease(pick.feat)?.from[0] ?? null,
  }));
}
