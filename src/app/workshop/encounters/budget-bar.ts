// The CR budget bar's geometry: where the party's four thresholds and the
// campaign's ceiling sit along a strip, and how far along it this roster
// reaches.
//
// Nothing here decides difficulty. The adjusted XP and the ceiling arrive
// from the server's readout (src/lib/dm/encounter-templates.ts) and the
// thresholds from src/lib/srd/encounter-math.ts, which is the one place the
// DMG table lives; this only turns those numbers into percentages. Pure by
// design (no "@/" imports, no I/O) so a script can drive it.

export type Thresholds = { easy: number; medium: number; hard: number; deadly: number };

export type BudgetTick = { label: string; percent: number };

export type BudgetBarGeometry = {
  // How far along the strip the roster reaches, 0 to 100.
  fillPercent: number;
  // Where each threshold sits, in the same units, plus the ceiling.
  ticks: BudgetTick[];
  // True when the roster reaches past the end of the strip.
  overflow: boolean;
};

function percentOf(value: number, scale: number): number {
  return Math.round((value / scale) * 1000) / 10;
}

// The strip runs to the ceiling or the deadly threshold, whichever is
// further, so "past the end" always means "the engine will refuse this".
export function budgetBarGeometry(input: {
  adjustedXp: number;
  ceiling: number;
  thresholds: Thresholds | null;
}): BudgetBarGeometry {
  const scale = Math.max(input.ceiling, input.thresholds?.deadly ?? 0, 1);
  const overflow = input.adjustedXp > scale;
  const ticks: BudgetTick[] = [];
  if (input.thresholds) {
    for (const label of ["easy", "medium", "hard", "deadly"] as const) {
      ticks.push({ label, percent: percentOf(input.thresholds[label], scale) });
    }
  }
  if (input.ceiling > 0) {
    ticks.push({ label: "ceiling", percent: percentOf(input.ceiling, scale) });
  }
  return {
    fillPercent: overflow ? 100 : percentOf(Math.max(0, input.adjustedXp), scale),
    ticks: ticks.filter((tick) => tick.percent <= 100),
    overflow,
  };
}
