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

// `shift` is the table's strictness (docs/vtt-parity-implementation-plan.md
// 9.2): minus two when lenient, plus two when harsh, never below five.
export function dcForDifficulty(tier: DifficultyTier, shift = 0): number {
  return Math.max(5, TIER_DC[tier] + shift);
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

// A tier as the model may space it: "very hard" and "very-hard" are
// very_hard. Returns null when the value is not one of the tiers, so callers
// can fall back to a raw dc or refuse it with the tiers listed.
export function normalizeDifficulty(value: unknown): DifficultyTier | null {
  if (typeof value !== "string") {
    return null;
  }
  const key = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return DIFFICULTY_TIERS.find((tier) => tier === key) ?? null;
}
