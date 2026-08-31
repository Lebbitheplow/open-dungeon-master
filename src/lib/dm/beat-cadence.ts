// The story-capture nudge: noticing when a human DM has been narrating out
// loud long enough that the campaign's memory has stopped being fed.
//
// Every memory engine in ODM is downstream of narration text. Chapters
// accumulate from messages, scene chunks are embedded from them, facts and
// lore are extracted when a chapter closes, and recall reads all three. A DM
// who says it at the table and types only "roll perception" feeds none of it,
// and the recap, the chapter summaries, the export and Ask all quietly get
// worse. This module is the part that notices.
//
// It decides nothing on its own: it returns a level and a reason, and the
// console renders a dot or a banner from that. Never a modal, and the remedy
// always travels with the interruption (see the plan's rule 7).
//
// Pure by design, with no imports at all, so the client recomputes it on
// every event without a request and scripts/test-beat-cadence.mjs can import
// it directly.

// How much table activity may pass with nothing written down. Two units
// because a session has two very different tempos: talking, measured in what
// the players typed, and fighting, measured in dice. Twelve rolls is roughly
// two rounds of a four-person fight, which is the plan's "2 rounds".
export type BeatCadenceThreshold = { messages: number; rolls: number };

export const DEFAULT_BEAT_CADENCE: BeatCadenceThreshold = { messages: 10, rolls: 12 };

// "quiet" shows nothing, "due" a dot on the DM tab, "overdue" the banner.
export type BeatCadenceLevel = "quiet" | "due" | "overdue";

export type CadenceMessage = { authorType: string; createdAt: string };
export type CadenceRoll = { createdAt: string };

export type BeatCadence = {
  level: BeatCadenceLevel;
  playerMessages: number;
  rolls: number;
  // One sentence naming what actually triggered it, so the banner says
  // something true rather than "you should write more".
  reason: string;
};

// Exported so a seat that is not the DM can be handed the same shape without
// pretending to compute anything.
export const QUIET_BEAT_CADENCE: BeatCadence = {
  level: "quiet",
  playerMessages: 0,
  rolls: 0,
  reason: "",
};

const QUIET = QUIET_BEAT_CADENCE;

// The moment story text last reached the transcript. A beat and a typed
// narration both count, because both are prose the memory engines can read;
// that is why a DM who types their scenes is never nudged at all.
//
// Timestamps rather than seq: rolls carry no seq, and every row the client
// holds carries a server-written ISO string, which compares correctly as text.
export function lastStoryCaptureAt(messages: CadenceMessage[]): string {
  let latest = "";
  for (const message of messages) {
    if (message.authorType === "dm" && message.createdAt > latest) {
      latest = message.createdAt;
    }
  }
  return latest;
}

function countAfter<T extends { createdAt: string }>(rows: T[], since: string): number {
  return rows.filter((row) => row.createdAt > since).length;
}

// A threshold of 0 means "never nudge me", which is how the setting turns the
// whole feature off without a second flag.
function ratio(count: number, threshold: number): number {
  return threshold > 0 ? count / threshold : 0;
}

export function beatCadence(input: {
  messages: CadenceMessage[];
  rolls: CadenceRoll[];
  threshold: BeatCadenceThreshold;
  // ISO timestamp the DM snoozed until, if they have.
  snoozedUntil?: string | null;
  now: string;
}): BeatCadence {
  const { messages, rolls, threshold, snoozedUntil, now } = input;
  if (threshold.messages <= 0 && threshold.rolls <= 0) {
    return QUIET;
  }
  if (snoozedUntil && now < snoozedUntil) {
    return QUIET;
  }

  const since = lastStoryCaptureAt(messages);
  const playerMessages = countAfter(
    messages.filter((message) => message.authorType === "player"),
    since,
  );
  const rollCount = countAfter(rolls, since);

  const messageRatio = ratio(playerMessages, threshold.messages);
  const rollRatio = ratio(rollCount, threshold.rolls);
  const worst = Math.max(messageRatio, rollRatio);
  if (worst < 1) {
    return QUIET;
  }

  // Whichever signal is further past its threshold is the one worth naming.
  const byMessages = messageRatio >= rollRatio;
  const reason = byMessages
    ? `${playerMessages} player ${playerMessages === 1 ? "action" : "actions"} since anything was written down.`
    : `${rollCount} ${rollCount === 1 ? "roll" : "rolls"} since anything was written down.`;

  return {
    level: worst >= 2 ? "overdue" : "due",
    playerMessages,
    rolls: rollCount,
    reason,
  };
}

// Snoozing buys a fixed stretch of wall clock rather than a message count:
// the DM is asking for quiet through the scene they are in the middle of.
export const BEAT_SNOOZE_MS = 20 * 60 * 1000;

export function snoozeUntil(nowMs: number): string {
  return new Date(nowMs + BEAT_SNOOZE_MS).toISOString();
}
