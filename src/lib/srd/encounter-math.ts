import type { CampaignDifficulty } from "@/lib/campaign-types";

// 5e DMG encounter-building math: CR to XP, per-character XP thresholds by
// level, and the multi-monster adjustment multiplier. Pure and table-driven
// so scripts/test-encounter-math.mjs can exercise it without a database.

const CR_XP_PAIRS: Array<[number, number]> = [
  [0, 10],
  [0.125, 25],
  [0.25, 50],
  [0.5, 100],
  [1, 200],
  [2, 450],
  [3, 700],
  [4, 1100],
  [5, 1800],
  [6, 2300],
  [7, 2900],
  [8, 3900],
  [9, 5000],
  [10, 5900],
  [11, 7200],
  [12, 8400],
  [13, 10000],
  [14, 11500],
  [15, 13000],
  [16, 15000],
  [17, 18000],
  [18, 20000],
  [19, 22000],
  [20, 25000],
  [21, 33000],
  [22, 41000],
  [23, 50000],
  [24, 62000],
  [25, 75000],
  [26, 90000],
  [27, 105000],
  [28, 120000],
  [29, 135000],
  [30, 155000],
];

export const CR_XP: ReadonlyMap<number, number> = new Map(CR_XP_PAIRS);

// Nearest listed CR wins for oddball values (some Open5e third-party
// monsters carry fractional CRs outside the DMG table).
export function xpForCr(cr: number): number {
  const exact = CR_XP.get(cr);
  if (exact !== undefined) {
    return exact;
  }
  let best = CR_XP_PAIRS[0];
  for (const pair of CR_XP_PAIRS) {
    if (Math.abs(pair[0] - cr) < Math.abs(best[0] - cr)) {
      best = pair;
    }
  }
  return best[1];
}

export type XpThresholds = { easy: number; medium: number; hard: number; deadly: number };

// Per-character thresholds, index 0 = level 1 .. index 19 = level 20.
export const XP_BUDGETS: ReadonlyArray<XpThresholds> = [
  { easy: 25, medium: 50, hard: 75, deadly: 100 },
  { easy: 50, medium: 100, hard: 150, deadly: 200 },
  { easy: 75, medium: 150, hard: 225, deadly: 400 },
  { easy: 125, medium: 250, hard: 375, deadly: 500 },
  { easy: 250, medium: 500, hard: 750, deadly: 1100 },
  { easy: 300, medium: 600, hard: 900, deadly: 1400 },
  { easy: 350, medium: 750, hard: 1100, deadly: 1700 },
  { easy: 450, medium: 900, hard: 1400, deadly: 2100 },
  { easy: 550, medium: 1100, hard: 1600, deadly: 2400 },
  { easy: 600, medium: 1200, hard: 1900, deadly: 2800 },
  { easy: 800, medium: 1600, hard: 2400, deadly: 3600 },
  { easy: 1000, medium: 2000, hard: 3000, deadly: 4500 },
  { easy: 1100, medium: 2200, hard: 3400, deadly: 5100 },
  { easy: 1250, medium: 2500, hard: 3800, deadly: 5700 },
  { easy: 1400, medium: 2800, hard: 4300, deadly: 6400 },
  { easy: 1600, medium: 3200, hard: 4800, deadly: 7200 },
  { easy: 2000, medium: 3900, hard: 5900, deadly: 8800 },
  { easy: 2100, medium: 4200, hard: 6300, deadly: 9500 },
  { easy: 2400, medium: 4900, hard: 7300, deadly: 10900 },
  { easy: 2800, medium: 5700, hard: 8500, deadly: 12700 },
];

export function thresholdsForParty(partyLevels: number[]): XpThresholds {
  const totals = { easy: 0, medium: 0, hard: 0, deadly: 0 };
  for (const level of partyLevels) {
    const row = XP_BUDGETS[Math.min(Math.max(Math.round(level), 1), 20) - 1];
    totals.easy += row.easy;
    totals.medium += row.medium;
    totals.hard += row.hard;
    totals.deadly += row.deadly;
  }
  return totals;
}

// DMG multiplier ladder; small parties feel packs harder, large parties
// easier, expressed as a one-step band shift.
const MULTIPLIER_BANDS = [0.5, 1, 1.5, 2, 2.5, 3, 4];

export function encounterMultiplier(monsterCount: number, partySize: number): number {
  let band: number;
  if (monsterCount <= 1) {
    band = 1;
  } else if (monsterCount === 2) {
    band = 2;
  } else if (monsterCount <= 6) {
    band = 3;
  } else if (monsterCount <= 10) {
    band = 4;
  } else if (monsterCount <= 14) {
    band = 5;
  } else {
    band = 6;
  }
  if (partySize < 3) {
    band = Math.min(band + 1, MULTIPLIER_BANDS.length - 1);
  } else if (partySize > 5) {
    band = Math.max(band - 1, 0);
  }
  return MULTIPLIER_BANDS[band];
}

export type EncounterVerdict =
  | "trivial"
  | "easy"
  | "medium"
  | "hard"
  | "deadly"
  | "beyond_deadly";

export type EncounterEvaluation = {
  totalXp: number;
  adjustedXp: number;
  thresholds: XpThresholds;
  verdict: EncounterVerdict;
};

export function evaluateEncounter(
  partyLevels: number[],
  monsterCrs: number[],
): EncounterEvaluation {
  const totalXp = monsterCrs.reduce((sum, cr) => sum + xpForCr(cr), 0);
  const adjustedXp = Math.round(
    totalXp * encounterMultiplier(monsterCrs.length, partyLevels.length),
  );
  const thresholds = thresholdsForParty(partyLevels);
  let verdict: EncounterVerdict;
  if (adjustedXp < thresholds.easy / 2) {
    verdict = "trivial";
  } else if (adjustedXp < thresholds.medium) {
    verdict = "easy";
  } else if (adjustedXp < thresholds.hard) {
    verdict = "medium";
  } else if (adjustedXp < thresholds.deadly) {
    verdict = "hard";
  } else if (adjustedXp <= thresholds.deadly * 1.5) {
    verdict = "deadly";
  } else {
    verdict = "beyond_deadly";
  }
  return { totalXp, adjustedXp, thresholds, verdict };
}

// Campaign difficulty sets how far past the deadly threshold an encounter
// may go before start_encounter refuses it outright.
const CEILING_FACTORS: Record<CampaignDifficulty, number> = {
  easy: 1.0,
  normal: 1.25,
  hard: 1.5,
  deadly: 2.0,
};

// Milestone XP for surviving a story chapter: roughly a tenth of the gap
// to the next level, so steady play advances even without combat. Clamped
// so early levels stay quick and level 20 grants nothing.
export function milestoneXp(level: number, xpThresholds: number[]): number {
  const current = xpThresholds[Math.max(0, Math.min(19, level - 1))] ?? 0;
  const next = xpThresholds[Math.max(0, Math.min(19, level))] ?? current;
  const gap = Math.max(0, next - current);
  if (!gap) {
    return 0;
  }
  return Math.max(25, Math.min(1000, Math.round(gap / 10)));
}

export function encounterCeiling(
  difficulty: CampaignDifficulty,
  deadlyThreshold: number,
): number {
  return Math.round((CEILING_FACTORS[difficulty] ?? 1.25) * deadlyThreshold);
}
