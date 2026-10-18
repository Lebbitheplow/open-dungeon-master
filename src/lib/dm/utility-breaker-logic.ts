// A configured utility model that keeps failing (a wrong model name, a
// server that went away) used to be asked again by every helper, each paying
// the same timeout before falling back to the story model
// (docs/agent-context-efficiency-audit-2026-10-17.md F10). After two
// failures in a row the utility model is skipped for a while and the work
// goes straight to the story model; the first call after the pause is the
// probe, and a success closes the breaker. Each failure while open doubles
// the pause, up to a ceiling.
//
// Pure state transitions, so scripts/test-utility-breaker.mjs can drive the
// clock.

export const FAILURES_TO_OPEN = 2;
export const FIRST_PAUSE_MS = 2 * 60_000;
export const MAX_PAUSE_MS = 15 * 60_000;

export type BreakerState = {
  failures: number;
  // While now is before this, the utility model is skipped.
  openUntil: number;
  pauseMs: number;
};

export const CLOSED: BreakerState = { failures: 0, openUntil: 0, pauseMs: 0 };

export function breakerOpen(state: BreakerState, now: number): boolean {
  return state.openUntil > now;
}

export function afterSuccess(): BreakerState {
  return CLOSED;
}

export function afterFailure(state: BreakerState, now: number): BreakerState {
  const failures = state.failures + 1;
  if (failures < FAILURES_TO_OPEN) {
    return { ...state, failures };
  }
  const pauseMs = state.pauseMs ? Math.min(MAX_PAUSE_MS, state.pauseMs * 2) : FIRST_PAUSE_MS;
  return { failures, openUntil: now + pauseMs, pauseMs };
}
