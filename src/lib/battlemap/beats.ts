// The beat sheet (docs/visual-overhaul-plan.md sections 5.1 and 5.5). One
// resolved action on the board is five beats long, and every piece of the
// presentation (the card, the die, the impact, the status word, the clear)
// reads its length from here, so nothing on the stage keeps its own clock.
//
// Pure: no DOM, no React. scripts/test-beats.mjs drives it directly.

export type BeatName = "announce" | "roll" | "impact" | "status" | "clear";

export type BeatSheet = Record<BeatName, number>;

export const BEAT_ORDER: readonly BeatName[] = ["announce", "roll", "impact", "status", "clear"];

// The full set: a turn played at the table's pace.
export const BEATS: BeatSheet = {
  announce: 420,
  roll: 820,
  impact: 420,
  status: 1500,
  clear: 260,
};

// The quick set: a table that asked for less waiting (low effects), and any
// effect that arrives while others are already queued behind it.
export const QUICK_BEATS: BeatSheet = {
  announce: 180,
  roll: 350,
  impact: 260,
  status: 900,
  clear: 90,
};

// Reduced motion plays no travel at all: the caption and the number show for
// their hold and nothing moves. 320 ms is the hold BoardFx has always used.
export const REDUCED_HOLD = 320;
export const REDUCED_BEATS: BeatSheet = {
  announce: 0,
  roll: 0,
  impact: 0,
  status: REDUCED_HOLD,
  clear: 0,
};

export type BeatOptions = { quick?: boolean; reduced?: boolean };

export function beatSheet(options: BeatOptions = {}): BeatSheet {
  if (options.reduced) {
    return REDUCED_BEATS;
  }
  return options.quick ? QUICK_BEATS : BEATS;
}

export function beatTotal(sheet: BeatSheet): number {
  return BEAT_ORDER.reduce((sum, name) => sum + sheet[name], 0);
}

// When each beat starts, measured from the start of the announce.
export function beatOffsets(sheet: BeatSheet): BeatSheet {
  const out = {} as BeatSheet;
  let at = 0;
  for (const name of BEAT_ORDER) {
    out[name] = at;
    at += sheet[name];
  }
  return out;
}

// How long a floating number stays up: through the impact, the clear and one
// more impact, which is the 1100 ms rise the mockup draws on the full set.
export function numberRise(sheet: BeatSheet): number {
  return sheet.impact + sheet.clear + sheet.impact;
}

// How long one board effect holds the stage, from the moment it starts to
// the moment the next one on the same target may begin. `delay` is how long
// the delivery takes to arrive (src/lib/battlemap/delivery.ts).
export function effectHold(kind: string, sheet: BeatSheet, delay = 0): number {
  if (sheet === REDUCED_BEATS) {
    return REDUCED_HOLD;
  }
  switch (kind) {
    case "attack":
    case "spell":
    case "hazard":
    case "heal":
    case "template":
      return delay + numberRise(sheet);
    case "condition":
    case "death":
      return sheet.status;
    case "teleport":
      return sheet.impact * 2;
    case "door":
    case "gutter":
      return sheet.impact + sheet.clear;
    case "ping":
      return sheet.impact;
    default:
      return sheet.impact + sheet.clear;
  }
}

// The skill-check card's beat (section 5.4), as fractions of its run so the
// quick set shortens it without re-authoring the keyframes: the die tumbles,
// the total lands at 72 %, the glow bursts, the verdict pops.
export const CHECK_BEAT_MS = 1500;
export const CHECK_LANDING = { total: 1080, verdict: 1180 } as const;

export function checkBeat(options: BeatOptions = {}): { run: number; total: number; verdict: number } {
  if (options.reduced) {
    return { run: 0, total: 0, verdict: 0 };
  }
  const scale = options.quick ? QUICK_BEATS.status / BEATS.status : 1;
  return {
    run: Math.round(CHECK_BEAT_MS * scale),
    total: Math.round(CHECK_LANDING.total * scale),
    verdict: Math.round(CHECK_LANDING.verdict * scale),
  };
}
