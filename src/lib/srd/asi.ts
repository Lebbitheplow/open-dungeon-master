import type { AbilityScores, AsiChoice } from "@/lib/schemas/sheet";

// Levels that grant an Ability Score Improvement (or a feat) in 5e, for every
// class but the two below.
export const ASI_LEVELS = [4, 8, 12, 16, 19] as const;

// SRD 5.1: a fighter improves twice more (6 and 14) and a rogue once more
// (10). Every other class, the setting classes included, keeps the five.
const CLASS_ASI_LEVELS: Record<string, readonly number[]> = {
  fighter: [4, 6, 8, 12, 14, 16, 19],
  rogue: [4, 8, 10, 12, 16, 19],
};

export const ABILITY_SCORE_CAP = 20;

// The most improvements any one class earns (the fighter's seven); what the
// sheet schema sizes its list of recorded choices by.
export const MAX_ASI_CHOICES = 7;

// The levels of this class that grant an improvement. With no class named
// the answer is the common five, which is what callers from before the
// per-class tables still ask for.
export function asiLevelsFor(classId?: string | null): readonly number[] {
  return CLASS_ASI_LEVELS[(classId ?? "").trim().toLowerCase()] ?? ASI_LEVELS;
}

// How many ASI choices a character of this level has earned. On a multiclass
// sheet the level is the CLASS level: use earnedAsiCountFor.
export function earnedAsiCount(level: number, classId?: string | null): number {
  return asiLevelsFor(classId).filter((threshold) => level >= threshold).length;
}

// Improvements earned across a class list, each class counted at its own
// level (SRD 5.1, Multiclassing: the feature belongs to the class).
export function earnedAsiCountFor(classes: Array<{ id: string; level: number }>): number {
  return classes.reduce((sum, entry) => sum + earnedAsiCount(entry.level, entry.id), 0);
}

// Which of these slots were taken in play. The table's level-up folds an
// improvement straight into the scores and records no choice, so a stored
// sheet can reach a level with fewer picks than it earned. The recorded
// picks are the earliest slots (the builder's own); the ones after them, up
// to the level the character reached, are already in its scores, and asking
// for them again would count them twice.
export function asiSlotsTakenInPlay(
  slotLevels: number[],
  recordedCount: number,
  reachedLevel: number,
): boolean[] {
  return slotLevels.map((threshold, index) => index >= recordedCount && threshold <= reachedLevel);
}

// The ASI thresholds crossed when advancing from one level to another, in
// the class named (class levels, on a multiclass sheet).
export function crossedAsiLevels(
  fromLevel: number,
  toLevel: number,
  classId?: string | null,
): number[] {
  return asiLevelsFor(classId).filter(
    (threshold) => threshold > fromLevel && threshold <= toLevel,
  );
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
