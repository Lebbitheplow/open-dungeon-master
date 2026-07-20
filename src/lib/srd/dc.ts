// The DMG "Typical Difficulty Classes" ladder. The DM names a difficulty tier
// and the server turns it into the canonical DC, so a "hard" lock is always
// DC 20 and never drifts between scenes or between one model call and the
// next. Pure and table-driven like encounter-math.ts, so scripts/test-dc.mjs
// can exercise it without a database.

export const DIFFICULTY_TIERS = [
  "very_easy",
  "easy",
  "moderate",
  "hard",
  "very_hard",
  "nearly_impossible",
] as const;

export type DifficultyTier = (typeof DIFFICULTY_TIERS)[number];

const TIER_DC: Record<DifficultyTier, number> = {
  very_easy: 5,
  easy: 10,
  moderate: 15,
  hard: 20,
  very_hard: 25,
  nearly_impossible: 30,
};

export function dcForDifficulty(tier: DifficultyTier): number {
  return TIER_DC[tier];
}

// The hardest tier whose DC the number reaches, so a raw DC reads back as a
// label for result text. A DC below 5 still reports "very_easy".
export function difficultyOfDc(dc: number): DifficultyTier {
  let best: DifficultyTier = "very_easy";
  for (const tier of DIFFICULTY_TIERS) {
    if (dc >= TIER_DC[tier]) {
      best = tier;
    }
  }
  return best;
}

// Maps the model's loose spellings onto a tier: "very hard", "veryHard",
// "very-hard" all reach very_hard; a few common synonyms are folded in
// (trivial -> very_easy, medium -> moderate, impossible -> nearly_impossible).
// Returns null when the value is not a difficulty word so callers can fall
// back to a raw dc.
export function normalizeDifficulty(value: unknown): DifficultyTier | null {
  if (typeof value !== "string") {
    return null;
  }
  const key = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (!key) {
    return null;
  }
  if ((DIFFICULTY_TIERS as readonly string[]).includes(key)) {
    return key as DifficultyTier;
  }
  const synonyms: Record<string, DifficultyTier> = {
    trivial: "very_easy",
    veryeasy: "very_easy",
    medium: "moderate",
    normal: "moderate",
    average: "moderate",
    veryhard: "very_hard",
    impossible: "nearly_impossible",
    nearlyimpossible: "nearly_impossible",
  };
  return synonyms[key.replace(/_/g, "")] ?? null;
}
