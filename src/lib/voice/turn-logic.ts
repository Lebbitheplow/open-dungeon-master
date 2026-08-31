// Who may speak out loud right now.
//
// The campaign already has the right primitive and this deliberately does not
// invent a second one. `Floor` in src/lib/db/campaigns.ts is a four-arm union
// (open, hold, spotlight, initiative) that already decides who may ACT, with
// DM controls behind /api/campaigns/[id]/floor and a floor_changed event on
// the stream. Voice turn-taking is the same question asked about microphones,
// so it reads the same floor rather than keeping its own idea of whose turn
// it is, which would be two sources of truth that could disagree mid-fight.
//
// Pure by design, like src/lib/dm/viewer.ts: no "@/" imports and no I/O, so
// scripts/test-voice-turn.mjs can drive it directly.

export const VOICE_FLOOR_MODES = ["open", "hold", "spotlight", "initiative"] as const;
export type VoiceFloorMode = (typeof VOICE_FLOOR_MODES)[number];

// How hard the floor is enforced on voice.
//
// "soft" is the default on purpose. Hard-muting a friend mid-sentence is an
// aggressive thing for software to do to a game night, and most tables want
// to be TOLD whose turn it is, not policed. "strict" exists for tables that
// asked for it (big groups, play-by-post-ish discipline), and when it is on
// the mute is real: the producer is paused server-side, because a greyed-out
// button that still transmits is theatre.
export const TURN_ENFORCEMENTS = ["off", "soft", "strict"] as const;
export type TurnEnforcement = (typeof TURN_ENFORCEMENTS)[number];

// A seat as the turn rules see it.
export type VoiceSeat = {
  userId: string;
  // Holds a DM seat: caps.adjudicates from src/lib/dm/viewer.ts, which already
  // covers the DM, a co-DM and the AI table's lead. Never subject to a floor
  // they control.
  adjudicates: boolean;
};

export type TransmitBlock = "" | "dm_holds_floor" | "not_your_turn" | "spotlight_elsewhere";

export type TransmitVerdict = {
  mayTransmit: boolean;
  // Why not. The UI says this rather than just grey out a button, because
  // "you are muted" and "the DM is talking" feel completely different.
  block: TransmitBlock;
};

const ALLOWED: TransmitVerdict = { mayTransmit: true, block: "" };

// Whether a seat may speak, given the floor. `floorUserIds` is whoever the
// floor currently names: the spotlighted players, or the initiative turn's
// player. Empty for open and hold.
//
// Note this answers the question for BOTH soft and strict. Soft mode still
// wants a verdict, because the whole point of soft is to show whose turn it
// is; the difference is only whether the server acts on it (see
// forcedSilentUserIds).
export function mayTransmit(
  mode: VoiceFloorMode,
  floorUserIds: string[],
  seat: VoiceSeat,
  enforcement: TurnEnforcement,
): TransmitVerdict {
  if (enforcement === "off") {
    return ALLOWED;
  }
  // The DM is never subject to the floor they control. This mirrors
  // FLOOR_EXEMPT_KINDS in src/lib/campaign-types.ts, where "narrate" is exempt
  // for the same reason.
  if (seat.adjudicates) {
    return ALLOWED;
  }
  if (mode === "open") {
    return ALLOWED;
  }
  if (mode === "hold") {
    return { mayTransmit: false, block: "dm_holds_floor" };
  }
  if (floorUserIds.includes(seat.userId)) {
    return ALLOWED;
  }
  return {
    mayTransmit: false,
    block: mode === "initiative" ? "not_your_turn" : "spotlight_elsewhere",
  };
}

// The seats the SERVER should actually silence, by pausing their producer.
// Only ever non-empty under "strict": under "soft" the floor is advisory and
// the UI carries it, and under "off" there is nothing to carry.
//
// Returned as ids rather than applied here so this module stays pure and the
// caller (src/lib/voice/turns.ts) owns the mediasoup side.
export function forcedSilentUserIds(
  mode: VoiceFloorMode,
  floorUserIds: string[],
  seats: VoiceSeat[],
  enforcement: TurnEnforcement,
): string[] {
  if (enforcement !== "strict") {
    return [];
  }
  return seats
    .filter((seat) => !mayTransmit(mode, floorUserIds, seat, enforcement).mayTransmit)
    .map((seat) => seat.userId);
}

// ---- hand raising ----

// Asking for the floor without talking over whoever has it. The queue is
// ordered oldest first, because the point of a queue is that waiting longer
// gets you closer to the front.
export type RaisedHand = {
  userId: string;
  // ISO timestamp, or null when the hand is down.
  raisedAt: string | null;
};

export function handQueue<T extends RaisedHand>(hands: T[]): T[] {
  return hands
    .filter((hand) => hand.raisedAt)
    .sort((a, b) => String(a.raisedAt).localeCompare(String(b.raisedAt)));
}

// A raised hand is answered by the floor moving to that person, so granting
// one is the ordinary spotlight call rather than a parallel mechanism. This
// says who the floor would name; the caller posts it to the existing floor
// route (src/app/api/campaigns/[campaignId]/floor/route.ts).
export function nextInLine<T extends RaisedHand>(hands: T[]): T | null {
  return handQueue(hands)[0] ?? null;
}

// A hand should drop by itself once its owner gets the floor, otherwise the
// queue fills with stale hands nobody remembers raising.
export function handsToLower(
  floorUserIds: string[],
  hands: RaisedHand[],
): string[] {
  const holding = new Set(floorUserIds);
  return handQueue(hands)
    .filter((hand) => holding.has(hand.userId))
    .map((hand) => hand.userId);
}

// ---- labels ----

// What the table is told about the current floor. Kept here next to the rules
// so the words and the behaviour cannot drift apart.
export const FLOOR_VOICE_LABELS: Record<VoiceFloorMode, string> = {
  open: "Anyone can speak",
  hold: "The DM has the floor",
  spotlight: "The spotlight is on",
  initiative: "Speaking in initiative order",
};

export const TRANSMIT_BLOCK_LABELS: Record<Exclude<TransmitBlock, "">, string> = {
  dm_holds_floor: "The DM has the floor",
  not_your_turn: "Wait for your turn in initiative",
  spotlight_elsewhere: "The spotlight is on someone else",
};
