// Pure 5e death-save bookkeeping, database-free like mutation-math.ts so
// scripts/test-death-logic.mjs can exercise every branch.

export type DeathTrack = {
  successes: number;
  failures: number;
  stable: boolean;
  dead: boolean;
};

export function freshDeathTrack(): DeathTrack {
  return { successes: 0, failures: 0, stable: false, dead: false };
}

// Instant death: the damage that dropped a character to 0 carried enough
// overkill to equal their HP maximum.
export function isMassiveDamage(overkill: number, maxHp: number): boolean {
  return overkill >= Math.max(1, maxHp);
}

// Damage taken while already at 0 HP: one automatic failure (two on a
// critical hit), and a stable character starts dying again.
export function onDamageAtZero(track: DeathTrack, crit: boolean): DeathTrack {
  if (track.dead) {
    return track;
  }
  const failures = Math.min(3, track.failures + (crit ? 2 : 1));
  return { ...track, stable: false, failures, dead: failures >= 3 };
}

export type DeathSaveOutcome = "revive" | "success" | "stable" | "failure" | "dead";

// One death saving throw: nat 20 revives at 1 HP, nat 1 counts as two
// failures, 10+ succeeds (three successes stabilize), otherwise a failure
// (three failures kill).
export function applyDeathSaveRoll(
  track: DeathTrack,
  natural: number,
): { track: DeathTrack; outcome: DeathSaveOutcome } {
  if (track.dead || track.stable) {
    return { track, outcome: track.dead ? "dead" : "stable" };
  }
  if (natural === 20) {
    return { track: freshDeathTrack(), outcome: "revive" };
  }
  if (natural === 1) {
    const failures = Math.min(3, track.failures + 2);
    const next = { ...track, failures, dead: failures >= 3 };
    return { track: next, outcome: next.dead ? "dead" : "failure" };
  }
  if (natural >= 10) {
    const successes = Math.min(3, track.successes + 1);
    const next = { ...track, successes, stable: successes >= 3 };
    return { track: next, outcome: next.stable ? "stable" : "success" };
  }
  const failures = Math.min(3, track.failures + 1);
  const next = { ...track, failures, dead: failures >= 3 };
  return { track: next, outcome: next.dead ? "dead" : "failure" };
}
