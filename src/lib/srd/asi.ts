import type { AbilityScores, AsiChoice } from "@/lib/schemas/sheet";

// Levels that grant an Ability Score Improvement (or a feat) in 5e.
export const ASI_LEVELS = [4, 8, 12, 16, 19] as const;

export const ABILITY_SCORE_CAP = 20;

// How many ASI choices a character of this level has earned.
export function earnedAsiCount(level: number): number {
  return ASI_LEVELS.filter((threshold) => level >= threshold).length;
}

// The ASI thresholds crossed when advancing from one level to another.
export function crossedAsiLevels(fromLevel: number, toLevel: number): number[] {
  return ASI_LEVELS.filter((threshold) => threshold > fromLevel && threshold <= toLevel);
}

// Bake ASI choices into ability scores, capping each at 20. Null slots
// (still undecided in the UI) are skipped.
export function applyAsiChoices(
  scores: AbilityScores,
  choices: Array<AsiChoice | null | undefined>,
): AbilityScores {
  const next = { ...scores };
  for (const choice of choices) {
    if (!choice) {
      continue;
    }
    if (choice.mode === "plus2") {
      next[choice.ability] = Math.min(ABILITY_SCORE_CAP, next[choice.ability] + 2);
    } else if (choice.mode === "plus1x2") {
      for (const ability of choice.abilities) {
        next[ability] = Math.min(ABILITY_SCORE_CAP, next[ability] + 1);
      }
    }
  }
  return next;
}

// Reverse-apply choices when a character instantiates below the level that
// earned them. Slightly lossy for scores that hit the 20 cap on the way up;
// floors at 1 so a score can never reverse into nonsense.
export function removeAsiChoices(scores: AbilityScores, choices: AsiChoice[]): AbilityScores {
  const next = { ...scores };
  for (const choice of choices) {
    if (choice.mode === "plus2") {
      next[choice.ability] = Math.max(1, next[choice.ability] - 2);
    } else if (choice.mode === "plus1x2") {
      for (const ability of choice.abilities) {
        next[ability] = Math.max(1, next[ability] - 1);
      }
    }
  }
  return next;
}
