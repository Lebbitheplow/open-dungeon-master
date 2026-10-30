// Between sessions (issue 586). A table that meets on a schedule had no way
// to say "that is where we stop until Friday": the campaign stayed in play
// all week, one player alone could carry the party's story on with the AI
// (a table that waits for everyone waits only for whoever is online), and
// the home screen called it "active". Ending the session holds the table
// where it stands until whoever steers the story, or the party lead, starts
// the next one. It is the table break's gate (src/lib/dm/table-break.ts)
// under a reason of its own: nothing is saved or unloaded, because every
// change is already stored as it happens, and starting again picks up
// exactly there with a recap when the gap was long. The campaign's status
// stays "active"; End campaign is still the only way to finish it.
//
// The rules here are shared by the route and the table's own controls.

export type SessionHold = {
  // When the session ended (ms since the epoch).
  at: number;
  // Who ended it, by account, and the name the table knows them by.
  userId: string;
  name: string;
  // Which session ended: the first is 1.
  number: number;
};

// Whoever steers the story (the GM at a table a person runs, the party
// lead at an AI-run one) or the party lead, who owns the table. A player
// who is neither waits for one of them, as they wait on a break.
export function maySteerSessions(viewer: { steersStory: boolean; isLead: boolean }): boolean {
  return viewer.steersStory || viewer.isLead;
}

// The DM queue's pause reason for it (src/lib/dm/queue.ts), beside a
// break's and the X-card's.
export const SESSION_REASON = "session";

// What a refused move reads while the table is between sessions.
export function sessionRefusal(hold: Pick<SessionHold, "number">): string {
  return `Session ${hold.number} is over. Use OOC for table talk until the next session starts.`;
}

// What work that waits on the storyteller reads between sessions (an Ask,
// a lore check, a fresh take on a passage, a rewind, an arc edit, a beat
// expanded): the queue runs nothing until the next session starts.
export function heldWorkRefusal(hold: Pick<SessionHold, "number">): string {
  return `Session ${hold.number} is over, and the storyteller rests until the next session starts.`;
}

// The chronicle's own lines at each end, so the story reads in sessions.
export function sessionEndedLine(number: number): string {
  return `Session ${number} ends.`;
}

export function sessionStartedLine(number: number): string {
  return `Session ${number} begins.`;
}

// A "Previously, on..." opens the next session only after a real gap: a
// session ended by mistake and started again a minute later needs none.
// The same gap the first action after a long silence answers with one
// (the actions route).
export const RECAP_AFTER_MS = 6 * 60 * 60 * 1000;

export function recapOnStart(endedAt: number, now: number): boolean {
  return now - endedAt >= RECAP_AFTER_MS;
}

export function sessionHoldFrom(payload: unknown): SessionHold | null {
  const value = payload as Partial<SessionHold> | null;
  if (!value || typeof value.userId !== "string") {
    return null;
  }
  const at = Number(value.at);
  const number = Number(value.number);
  return {
    at: Number.isFinite(at) ? at : Date.now(),
    userId: value.userId,
    name: String(value.name ?? "Someone"),
    number: Number.isInteger(number) && number > 0 ? number : 1,
  };
}

// The next time the table meets: the earliest scheduled session not
// cancelled and not yet over, so one under way tonight still counts.
export type NextSession = { id: string; title: string; startsAt: string; durationMin: number; coming: number };

export function pickNextSession(
  sessions: Array<{
    id: string;
    title: string;
    startsAt: string;
    durationMin: number;
    cancelledAt: string | null;
    rsvps?: Array<{ response: string }>;
    coming?: number;
  }>,
  now: number,
): NextSession | null {
  const next = sessions
    .filter((session) => !session.cancelledAt)
    .filter((session) => {
      const start = Date.parse(session.startsAt);
      return Number.isFinite(start) && start + Math.max(0, session.durationMin) * 60_000 > now;
    })
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))[0];
  if (!next) {
    return null;
  }
  const coming = next.coming ?? (next.rsvps ?? []).filter((rsvp) => rsvp.response === "yes").length;
  return { id: next.id, title: next.title, startsAt: next.startsAt, durationMin: next.durationMin, coming };
}

// "Fri, Nov 6, 7:00 PM" in the reader's own locale and time zone; the
// server stores UTC and never formats a time for a person.
export function sessionWhenLocal(startsAt: string, locale?: string): string {
  const date = new Date(startsAt);
  if (!Number.isFinite(date.getTime())) {
    return "";
  }
  return date.toLocaleString(locale, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

// The line the banner and the home screen say about it.
export function nextSessionWords(next: NextSession | null, when: string): string {
  if (!next) {
    return "No next session is set yet.";
  }
  const coming = next.coming === 1 ? "1 coming" : `${next.coming} coming`;
  return `Next session: ${when} · ${coming}`;
}
