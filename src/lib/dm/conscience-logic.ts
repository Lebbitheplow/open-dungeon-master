// A lasting companion's conscience (issue 503 Phase 1), the pure half: the
// ladder from content to the breaking point, what moves it each way, and the
// ultimatum it sets on the way down. The server stores and moves it; the AI
// cannot set a rung, only record what happened (relationship_beat) and play
// what the rung says. The rim is src/lib/dm/conscience.ts.
//
// Two things put a companion on a rung, and the lower of the two is where
// they stand:
//   - their standing with the party: wary is uneasy, disliked is a warning,
//     hostile is the breaking point, read from the worst approval they hold
//     toward anyone they travel with;
//   - what they have seen (`held`): a serious breach of a red line steps them
//     down one rung from where they stand, an atrocity against one takes
//     them straight to the breaking point, and a deed that honours what they
//     hold (or amends for what was done) steps them back up one, at most once
//     an exchange.
// An ultimatum is the third rung: a condition and a deadline on the
// campaign's clock. Climbing back above it meets it; the deadline passing
// with the companion still there takes them to the breaking point.
//
// Pure, with relative imports only, so scripts/test-conscience.mjs loads it
// directly.

import { friendshipTier } from "./relationship-logic.ts";
import type { ConscienceSetting } from "../schemas/game-settings-options.ts";

export type { ConscienceSetting };

export const CONSCIENCE_RUNGS = ["content", "uneasy", "warning", "ultimatum", "breaking"] as const;
export type ConscienceRung = (typeof CONSCIENCE_RUNGS)[number];

export const RUNG_LABEL: Record<ConscienceRung, string> = {
  content: "Content",
  uneasy: "Uneasy",
  warning: "Warning",
  ultimatum: "Ultimatum",
  breaking: "Breaking point",
};

// The same, as the DM's note says it in a sentence.
export const RUNG_WORD: Record<ConscienceRung, string> = {
  content: "content",
  uneasy: "uneasy",
  warning: "warning",
  ultimatum: "ultimatum",
  breaking: "breaking point",
};

export const ULTIMATUM = 3;
export const BREAKING = 4;
const TOP = CONSCIENCE_RUNGS.length - 1;

// How long an ultimatum gives when the DM names no deadline, in hours on
// the campaign's clock, and the most it may give.
export const DEFAULT_DEADLINE_HOURS = 24;
export const MAX_DEADLINE_HOURS = 24 * 7;

export type Ultimatum = {
  // What they demand, in the DM's words (the table's language).
  condition: string;
  // Clock instants, in minutes (src/lib/dm/calendar.ts).
  set: number;
  due: number;
  // The DM-only calendar event that mirrors it, "" before it is written.
  eventId: string;
};

export type Conscience = {
  held: number;
  // The rung the table last saw, so a move is reported once.
  shown: number;
  ultimatum: Ultimatum | null;
  // The exchange that last stepped them up: once per exchange, so one
  // apology repeated does not walk them to content.
  climbedTurn: string;
  // What last moved them, for the DM's line.
  cause: string;
};

export const CONTENT: Conscience = { held: 0, shown: 0, ultimatum: null, climbedTurn: "", cause: "" };

export function rungName(index: number): ConscienceRung {
  return CONSCIENCE_RUNGS[Math.max(0, Math.min(TOP, Math.round(index)))];
}

// Where their standing alone puts them; null (nobody to stand with) is
// content.
export function standingRung(worstApproval: number | null): number {
  if (worstApproval === null) {
    return 0;
  }
  const tier = friendshipTier(worstApproval);
  return tier === "hostile" ? BREAKING : tier === "disliked" ? 2 : tier === "wary" ? 1 : 0;
}

export function effectiveRung(conscience: Conscience, worstApproval: number | null): number {
  return Math.max(conscience.held, standingRung(worstApproval));
}

export type LadderStep = "atrocity" | "breach" | "honour";

// One deed's step. A breach steps down from where they stand now (so a
// companion the party's standing already holds at a warning goes to an
// ultimatum); honouring steps back up from what the deeds left, never past
// what their standing allows, once an exchange.
export function stepLadder(
  conscience: Conscience,
  step: LadderStep | null,
  worstApproval: number | null,
  turnId: string,
  cause: string,
): Conscience {
  if (!step) {
    return conscience;
  }
  const now = effectiveRung(conscience, worstApproval);
  if (step === "atrocity") {
    return { ...conscience, held: BREAKING, cause };
  }
  if (step === "breach") {
    return { ...conscience, held: Math.min(TOP, now + 1), cause };
  }
  if (conscience.climbedTurn === turnId || conscience.held === 0) {
    return conscience;
  }
  const held = Math.max(0, Math.min(conscience.held, now - 1));
  return held === conscience.held ? conscience : { ...conscience, held, climbedTurn: turnId, cause };
}

export type Settled = {
  conscience: Conscience;
  from: ConscienceRung;
  to: ConscienceRung;
  // They stand on the ultimatum rung with no condition set yet: the rim sets
  // the one the DM named, or the plain default.
  needsUltimatum: boolean;
  // The ultimatum they had was met (they climbed above it) or lapsed (its
  // deadline passed): the rim tidies the calendar event behind it.
  ultimatumMet: Ultimatum | null;
  ultimatumLapsed: Ultimatum | null;
};

// Where they stand now, with the ultimatum's life settled against the clock:
// a deadline passed on the ultimatum rung is the breaking point, climbing
// above it meets it, and reaching the breaking point by another road leaves
// it moot.
export function settleConscience(conscience: Conscience, worstApproval: number | null, now: number): Settled {
  const from = rungName(conscience.shown);
  let next = conscience;
  let ultimatumMet: Ultimatum | null = null;
  let ultimatumLapsed: Ultimatum | null = null;
  let rung = effectiveRung(next, worstApproval);
  if (next.ultimatum && rung === ULTIMATUM && now >= next.ultimatum.due) {
    ultimatumLapsed = next.ultimatum;
    next = { ...next, held: BREAKING, ultimatum: null, cause: "the deadline passed unmet" };
    rung = BREAKING;
  } else if (next.ultimatum && rung < ULTIMATUM) {
    ultimatumMet = next.ultimatum;
    next = { ...next, ultimatum: null };
  } else if (next.ultimatum && rung > ULTIMATUM) {
    ultimatumLapsed = next.ultimatum;
    next = { ...next, ultimatum: null };
  }
  next = { ...next, shown: rung };
  return {
    conscience: next,
    from,
    to: rungName(rung),
    needsUltimatum: rung === ULTIMATUM && !next.ultimatum,
    ultimatumMet,
    ultimatumLapsed,
  };
}

export function deadlineHours(raw: unknown): number {
  const hours = Math.round(Number(raw));
  return Number.isFinite(hours) && hours >= 1 ? Math.min(MAX_DEADLINE_HOURS, hours) : DEFAULT_DEADLINE_HOURS;
}

export function withUltimatum(conscience: Conscience, condition: string, now: number, hours: number): Conscience {
  return { ...conscience, ultimatum: { condition: condition.trim().slice(0, 160), set: now, due: now + hours * 60, eventId: "" } };
}

// The plain demand when the DM named none: amends for what moved them.
export function defaultCondition(cause: string): string {
  return cause ? `Make amends for ${cause}, and never again` : "Make amends, and never again";
}

// Minutes left on an ultimatum, never below zero.
export function minutesLeft(ultimatum: Ultimatum, now: number): number {
  return Math.max(0, ultimatum.due - now);
}

// "5 h 20 min", "3 days 2 h", "12 min": how long is left, for the Bonds row
// and the DM's line.
export function durationLabel(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  const days = Math.floor(total / 1440);
  const hours = Math.floor((total % 1440) / 60);
  const mins = total % 60;
  if (days) {
    return hours ? `${days} day${days === 1 ? "" : "s"} ${hours} h` : `${days} day${days === 1 ? "" : "s"}`;
  }
  if (hours) {
    return mins ? `${hours} h ${mins} min` : `${hours} h`;
  }
  return `${mins} min`;
}

// ---- storage ----

export function parseConscience(raw: string): Conscience {
  if (!raw) {
    return CONTENT;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<Conscience> & { ultimatum?: Partial<Ultimatum> | null };
    const rung = (value: unknown) => Math.max(0, Math.min(TOP, Math.round(Number(value) || 0)));
    const ultimatum =
      parsed.ultimatum && typeof parsed.ultimatum.condition === "string" && Number.isFinite(Number(parsed.ultimatum.due))
        ? {
            condition: parsed.ultimatum.condition.slice(0, 160),
            set: Math.max(0, Math.round(Number(parsed.ultimatum.set) || 0)),
            due: Math.max(0, Math.round(Number(parsed.ultimatum.due))),
            eventId: typeof parsed.ultimatum.eventId === "string" ? parsed.ultimatum.eventId : "",
          }
        : null;
    return {
      held: rung(parsed.held),
      shown: rung(parsed.shown),
      ultimatum,
      climbedTurn: typeof parsed.climbedTurn === "string" ? parsed.climbedTurn : "",
      cause: typeof parsed.cause === "string" ? parsed.cause.slice(0, 160) : "",
    };
  } catch {
    return CONTENT;
  }
}

// ---- what the DM is told ----

// How each rung is played, said to the DM beside the companion's values in
// the moment part of GAME STATE.
export function rungGuidance(rung: ConscienceRung, setting: ConscienceSetting): string {
  switch (rung) {
    case "content":
      return "content";
    case "uneasy":
      return "uneasy: they voice objections and let their discomfort show";
    case "warning":
      return "warning: they confront the party and name plainly what must stop";
    case "ultimatum":
      return "ultimatum: they have set a condition and a deadline and hold the party to it";
    case "breaking":
      return setting === "talk"
        ? "breaking point: they can no longer stand with the party, but this table keeps its companions, so they stay and say so bitterly"
        : "breaking point: they can no longer stand with the party; what they do about it, and when, is the server's, and it tells you";
  }
}

// Whether the player's command over a companion ends here: only where the
// table lets companions turn, from the warning on.
export function commandEnds(setting: ConscienceSetting, rung: number): boolean {
  return setting === "turn" && rung >= 2;
}

// The rules the DM is given beside the relationship rules: how a deed is
// recorded, and, where a lasting companion travels with the party and the
// table runs a conscience, how the ladder is played. Static per table, so it
// sits in the cached prefix; the rungs themselves are in the moment.
export function conscienceRules(setting: ConscienceSetting, companions: boolean, deeds: readonly string[]): string {
  const lines = [
    `Deeds (${deeds.join(", ")}): record one with relationship_beat the moment a character commits it, in a fight too (deeds are the only beats offered mid-fight). Name the subject and every other tracked NPC or companion who saw it or will hear of it in witnesses, and say how grave in severity (minor, serious, atrocity). Each witness takes it by their own nature and what they hold to. amends records a character making up for what they did.`,
  ];
  if (setting !== "off" && companions) {
    lines.push(
      "Companion conscience: each lasting companion holds values (GAME STATE lists them; a red line is one they will not see crossed) and stands on a rung the server moves: content, uneasy, warning, ultimatum, breaking point. You never set a rung: deeds and standing do, and a deed that honours what they hold, or amends, steps them back up. Narrating a deed that crosses a companion's red line in front of them without relationship_beat is a missed tool call, like narrating damage without its tool.",
      "Play the rung GAME STATE gives each companion: objections when uneasy; at a warning a confrontation naming what must stop; at an ultimatum their condition and deadline, held to every turn. Against a companion at a warning, a further breach brings an ultimatum: pass demand (what they demand, in their words) and deadlineHours with that relationship_beat, and voice it when the result says it is set.",
      "A DM-only fact headed 'Unrecorded deed' or 'Deed' names a deed the story showed that nothing recorded: if a tracked NPC or companion saw it, record it with relationship_beat now.",
      setting === "talk"
        ? "This table keeps its companions: none leaves over what the party does, whatever their rung. Never dismiss_companion one over it."
        : "Whether a companion leaves is the server's: at its breaking point it walks out, slips away, reports the party or turns on it, and a result or GAME STATE says so. Narrate exactly that; never dismiss_companion one over conscience or standing. One who left may come back, and GAME STATE says how.",
    );
  }
  return lines.map((line) => `- ${line}`).join("\n");
}
