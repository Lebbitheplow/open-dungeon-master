// The token estimate (characters / 4, src/lib/dm/context-budget.ts) runs
// low on some payloads: JSON heavy with ids, a table that plays in another
// language, a tokenizer with a small vocabulary. A request sized by a low
// estimate overflows the window it was fitted to. So each backend's reported
// input is compared with the estimate for the same request, and the fitter
// (src/lib/dm/request-fit.ts) scales its estimate by the ratio it learned.
//
// The ratio only ever raises the estimate (a tokenizer that does better than
// four characters a token is simply left a little room), and it is capped,
// so one odd report cannot shrink every prompt. Ollama reports only the
// prompt it evaluated, which is shorter when its cache was reused, so its
// reports may raise the ratio but never lower it.
//
// Dependency-free so scripts/test-request-fit.mjs can drive it.

export const MAX_CALIBRATION = 1.6;
const WEIGHT = 0.3;
// A report this far under the estimate says nothing about the tokenizer:
// a cached prompt, or a backend that counts only part of it.
const IGNORE_BELOW = 0.5;

declare global {
  var __odmTokenCalibration: Map<string, number> | undefined;
}

function ratios(): Map<string, number> {
  return (globalThis.__odmTokenCalibration ??= new Map<string, number>());
}

export function calibrationFor(key: string): number {
  return ratios().get(key) ?? 1;
}

export function noteReportedInput(
  key: string,
  estimatedTokens: number,
  reportedTokens: number,
  options: { partialReport?: boolean } = {},
): number {
  if (!(estimatedTokens > 0) || !(reportedTokens > 0)) {
    return calibrationFor(key);
  }
  const ratio = reportedTokens / estimatedTokens;
  const current = calibrationFor(key);
  if (ratio < IGNORE_BELOW || (options.partialReport && ratio <= current)) {
    return current;
  }
  const next = Math.min(MAX_CALIBRATION, Math.max(1, current * (1 - WEIGHT) + ratio * WEIGHT));
  ratios().set(key, next);
  return next;
}

export function resetCalibration(): void {
  ratios().clear();
}
