// Who hears whom, and how loudly.
//
// This is the module the whole feature is arranged around. Breakout channels,
// proximity, the DM's omniscient hearing and downed-character deafness are not
// four subsystems: they are four rules feeding one matrix, which
// src/lib/voice/apply.ts then turns into pause/resume calls on mediasoup
// consumers. Adding a fifth rule means adding a case here, not a new pipeline.
//
// Pure by design, like src/lib/dm/viewer.ts: no "@/" imports and no I/O, so
// scripts/test-voice-audibility.mjs can import it directly. That is also why
// the two geometry helpers below are restated rather than imported from
// src/lib/battlemap/types.ts; the test asserts they still agree.

// Feet per tile. Must match TILE_FEET in src/lib/battlemap/types.ts.
export const TILE_FEET = 5;

// D&D measures diagonals as one square, so distance is Chebyshev rather than
// Euclidean. Must match chebyshev() in src/lib/battlemap/types.ts.
export function tileDistance(ax: number, ay: number, bx: number, by: number): number {
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}

// How far a voice carries, by how it is pitched. The D&D-native version of a
// volume slider, and the reason the range is the SPEAKER's rather than the
// listener's: shouting is something you do, not something done to you.
export const SAY_RANGES = { whisper: 5, normal: 0, shout: 120 } as const;
export type SayRange = keyof typeof SAY_RANGES;

// A wall on the line does not block sound, it muffles it. Hearing a
// conversation through a door is a real thing, and audio that vanished at a
// doorway would read as a bug rather than a rule. Fog of war deliberately
// never gates audio at all: not being able to SEE someone has nothing to do
// with whether you can hear them.
export const WALL_ATTENUATION = 0.35;

// Below this a voice is not worth sending: it is inaudible in practice, and
// forwarding it would spend bandwidth to deliver silence.
export const MIN_AUDIBLE_GAIN = 0.08;

// Volume at exactly the maximum range. Deliberately NOT zero: "within 30 feet"
// includes 30 feet, so a fade that reached silence at the boundary would make
// the last tile of the range inaudible and quietly turn a 30-foot rule into a
// 25-foot one. Someone standing at the edge is faint, and one step further is
// gone.
export const EDGE_GAIN = 0.25;

export type AudibilityRules = {
  proximity: boolean;
  hearingRangeFeet: number;
  sayRange: boolean;
  wallsAttenuate: boolean;
  downedGoDeaf: boolean;
};

export type AudibilitySeat = {
  userId: string;
  channelId: string;
  // Holds a DM seat (caps.adjudicates). Hears everyone and is heard by
  // everyone, in every channel, at every distance.
  adjudicates: boolean;
  // Where their character stands, in tiles. Null when they have no token on
  // the active map, which is the normal case outside combat.
  position: { x: number; y: number } | null;
  sayRange: SayRange;
  // At 0 hit points.
  downed: boolean;
};

// listener id -> speaker id -> gain in 0..1. A speaker absent from a
// listener's map is inaudible to them, which is what apply.ts pauses.
export type AudibilityMatrix = Map<string, Map<string, number>>;

export type AudibilityOptions = {
  // True when a wall stands between the two tiles. Supplied by the caller so
  // this module needs no terrain and stays pure; the caller wires
  // hasLineOfSight from src/lib/battlemap/los.ts.
  blocked?: (ax: number, ay: number, bx: number, by: number) => boolean;
};

// How far this speaker's voice carries, in feet.
function rangeFeet(speaker: AudibilitySeat, rules: AudibilityRules): number {
  if (!rules.sayRange || speaker.sayRange === "normal") {
    return rules.hearingRangeFeet;
  }
  return SAY_RANGES[speaker.sayRange];
}

// Full volume up to two thirds of the range, then a linear fade to EDGE_GAIN
// at the boundary. A hard cutoff would make a step of one tile flip a voice
// between present and gone, which sounds broken even though it is technically
// what "30 feet" means; fading to zero exactly AT the range has the same
// effect one tile earlier.
function distanceGain(distanceFeet: number, range: number): number {
  if (distanceFeet > range) {
    return 0;
  }
  const full = range * (2 / 3);
  if (distanceFeet <= full) {
    return 1;
  }
  const fade = range - full;
  if (fade <= 0) {
    return 1;
  }
  return 1 - (1 - EDGE_GAIN) * ((distanceFeet - full) / fade);
}

// The gain from one speaker to one listener, or 0 for inaudible.
function gainBetween(
  listener: AudibilitySeat,
  speaker: AudibilitySeat,
  rules: AudibilityRules,
  options: AudibilityOptions,
): number {
  // Rule 2, before everything else: a DM hears every voice and is heard by
  // every ear, whatever channel or corner of the map either is in. Taken from
  // caps.adjudicates so nothing here compares user ids.
  if (listener.adjudicates || speaker.adjudicates) {
    return 1;
  }

  // Rule 1, the base layer: you hear your own channel. A breakout room is
  // exactly this and nothing more, which is why moving somebody is a
  // recompute rather than a renegotiation.
  if (listener.channelId !== speaker.channelId) {
    return 0;
  }

  // Rule 6: unconscious characters stop hearing the table.
  if (rules.downedGoDeaf && listener.downed) {
    return 0;
  }

  // Rules 3 to 5 need a map. Without positions there is no geometry to apply,
  // which is the ordinary case outside combat, so everyone in the channel
  // simply hears everyone.
  if (!rules.proximity || !listener.position || !speaker.position) {
    return 1;
  }

  const distance =
    tileDistance(
      listener.position.x,
      listener.position.y,
      speaker.position.x,
      speaker.position.y,
    ) * TILE_FEET;

  let gain = distanceGain(distance, rangeFeet(speaker, rules));
  if (gain <= 0) {
    return 0;
  }
  if (
    rules.wallsAttenuate &&
    options.blocked?.(
      listener.position.x,
      listener.position.y,
      speaker.position.x,
      speaker.position.y,
    )
  ) {
    gain *= WALL_ATTENUATION;
  }
  return gain < MIN_AUDIBLE_GAIN ? 0 : gain;
}

export function computeAudibility(
  seats: AudibilitySeat[],
  rules: AudibilityRules,
  options: AudibilityOptions = {},
): AudibilityMatrix {
  const matrix: AudibilityMatrix = new Map();
  for (const listener of seats) {
    const heard = new Map<string, number>();
    for (const speaker of seats) {
      // Nobody consumes their own producer, so self is simply absent.
      if (speaker.userId === listener.userId) {
        continue;
      }
      const gain = gainBetween(listener, speaker, rules, options);
      if (gain > 0) {
        heard.set(speaker.userId, gain);
      }
    }
    matrix.set(listener.userId, heard);
  }
  return matrix;
}

// What changed since the matrix currently applied to mediasoup. Returned as
// explicit lists so apply.ts issues only the calls that matter: a table where
// nobody moved costs nothing, and one where a token stepped one tile costs a
// handful of pause/resume calls rather than a full rebuild.
export type AudibilityDiff = {
  // listener -> speakers to start hearing
  resume: Map<string, string[]>;
  // listener -> speakers to stop hearing
  pause: Map<string, string[]>;
  // listener -> speaker -> new gain, for those whose volume moved
  gains: Map<string, Map<string, number>>;
};

// Gains are floats off a fade curve, so comparing them exactly would report a
// change on every recompute. A hundredth of full volume is inaudible.
const GAIN_EPSILON = 0.01;

export function diffAudibility(
  previous: AudibilityMatrix,
  next: AudibilityMatrix,
): AudibilityDiff {
  const resume = new Map<string, string[]>();
  const pause = new Map<string, string[]>();
  const gains = new Map<string, Map<string, number>>();

  for (const [listener, heard] of next) {
    const before = previous.get(listener) ?? new Map<string, number>();
    const toResume: string[] = [];
    const changed = new Map<string, number>();
    for (const [speaker, gain] of heard) {
      const had = before.get(speaker);
      if (had === undefined) {
        toResume.push(speaker);
        changed.set(speaker, gain);
      } else if (Math.abs(had - gain) > GAIN_EPSILON) {
        changed.set(speaker, gain);
      }
    }
    const toPause = [...before.keys()].filter((speaker) => !heard.has(speaker));
    if (toResume.length) {
      resume.set(listener, toResume);
    }
    if (toPause.length) {
      pause.set(listener, toPause);
    }
    if (changed.size) {
      gains.set(listener, changed);
    }
  }

  // A listener who left entirely: everything they were hearing stops.
  for (const [listener, before] of previous) {
    if (!next.has(listener) && before.size) {
      pause.set(listener, [...before.keys()]);
    }
  }

  return { resume, pause, gains };
}
