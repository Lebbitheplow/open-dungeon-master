import type { CampaignClock, Instant } from "@/lib/dm/calendar";

// Putting back the time a turn moved the clock on, for "Revert this turn"
// (issue #622). Pure over the clock as it stands and the moves the turn made
// (src/lib/db/clock-moves.ts records them), so the route decides nothing the
// tests cannot read.
//
// What comes back is what the moving itself changed (src/lib/db/clock.ts
// advanceClock): the instant, the Wild Shapes whose hours ran out, the days
// of food and water counted, the hit dice window it closed, the diseases and
// poisons it ran on, and the downtime the days paid for. What the world did
// with the time (its weather, its calendar's events, a companion who left)
// stays: the chapter rewind is what takes those back.

export type RecordedClockMove = {
  // The clock as the move found it.
  before: CampaignClock;
  // Where the move left the instant.
  afterInstant: Instant;
};

export type ClockRewind =
  // The clock as it was before the turn's first move.
  | { restored: CampaignClock }
  // The clock moved again since (another turn, the GM's own controls): it
  // stays, with only the Wild Shapes whose hours this turn spent written
  // back, so the next move ends a form the revert gave back.
  | { kept: CampaignClock };

// The Wild Shape ends the moves took off the clock, back on it, unless a
// newer shape for that character is there now.
function withLapsedShapes(current: CampaignClock, moves: RecordedClockMove[]): Record<string, Instant> | undefined {
  const shapeEnds: Record<string, Instant> = { ...(current.shapeEnds ?? {}) };
  for (const move of moves) {
    for (const [characterId, ends] of Object.entries(move.before.shapeEnds ?? {})) {
      if (ends <= move.afterInstant && shapeEnds[characterId] === undefined) {
        shapeEnds[characterId] = ends;
      }
    }
  }
  return Object.keys(shapeEnds).length ? shapeEnds : undefined;
}

type Restored = "shapeEnds" | "supplies" | "shortRest" | "afflictions" | "downtime";

// Sets `key` to `value`, or leaves it off when there is none, so a restored
// clock reads as the one that was saved.
function put<K extends Restored>(clock: CampaignClock, key: K, value: CampaignClock[K] | undefined) {
  if (value === undefined) {
    delete clock[key];
  } else {
    clock[key] = value;
  }
}

// Null when the turn moved no time. The moves come oldest first.
export function rewindClock(current: CampaignClock, moves: RecordedClockMove[]): ClockRewind | null {
  if (!moves.length) {
    return null;
  }
  const first = moves[0].before;
  const last = moves[moves.length - 1];
  const next: CampaignClock = { ...current };
  put(next, "shapeEnds", withLapsedShapes(current, moves));
  if (current.instant !== last.afterInstant) {
    return { kept: next };
  }
  next.instant = first.instant;
  put(next, "supplies", first.supplies);
  put(next, "shortRest", first.shortRest);
  put(next, "afflictions", first.afflictions);
  put(next, "downtime", first.downtime);
  return { restored: next };
}
