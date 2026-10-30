import { allocateSeq, claimRecap } from "@/lib/db/campaigns";
import { getDatabase } from "@/lib/db/core";
import { insertCampaignMessage } from "@/lib/db/messages";
import { dmQueuePausedFor, enqueueDmJobFirst, pauseDmQueue, resumeDmQueue } from "@/lib/dm/queue";
import { runResumeRecap, type RecapSession } from "@/lib/dm/recap";
import {
  SESSION_REASON,
  heldWorkRefusal,
  recapOnStart,
  sessionEndedLine,
  sessionHoldFrom,
  sessionStartedLine,
  type SessionHold,
} from "@/lib/dm/session-hold-logic";
import { latestEventOfType, publishPersisted, publishWithSeq } from "@/lib/events";

// Between sessions (src/lib/dm/session-hold-logic.ts has the rules). The DM
// queue is held at its gate under its own reason, beside a break or a
// raised X-card: a DM turn already running finishes and its text lands,
// the next one waits for the next session, and lifting one hold never
// lifts another. Every play route already asks the break's gate before it
// changes anything (refuseDuringBreak in table-break.ts), and that gate
// asks this one first.

export { SESSION_REASON };

// The session hold on the table, if there is one. The queue's gate is the
// truth of whether play is held; the event says who ended which session.
export function sessionHoldOn(campaignId: string): SessionHold | null {
  if (!dmQueuePausedFor(campaignId, SESSION_REASON)) {
    return null;
  }
  const event = latestEventOfType(campaignId, ["session_ended"]);
  return sessionHoldFrom(event?.payload) ?? { at: Date.now(), userId: "", name: "Someone", number: sessionsEnded(campaignId) || 1 };
}

// Work that waits on the storyteller's queue is answered at once between
// sessions, in plain words, instead of hanging until the next one starts.
export function refuseBetweenSessions(campaignId: string): Response | null {
  const hold = sessionHoldOn(campaignId);
  return hold ? Response.json({ error: heldWorkRefusal(hold), sessionHold: hold }, { status: 409 }) : null;
}

// How many sessions this campaign has ended: the next to end is one more.
function sessionsEnded(campaignId: string): number {
  const row = getDatabase()
    .prepare(`SELECT COUNT(*) AS n FROM campaign_events WHERE campaign_id = ? AND type = 'session_ended'`)
    .get(campaignId) as { n: number };
  return row.n;
}

function chronicleLine(campaignId: string, content: string): number {
  const seq = allocateSeq(campaignId);
  const message = insertCampaignMessage({ campaignId, seq, authorType: "system", glyph: "cue-bell", content });
  publishWithSeq(campaignId, seq, "message_added", { message });
  return seq;
}

// Ending an ended session changes nothing: the first end stands, with its
// name and its number, so a second press or a co-GM's at the same moment
// never counts a session twice.
export function endSession(campaignId: string, by: { id: string; username: string }): { hold: SessionHold; already: boolean } {
  const current = sessionHoldOn(campaignId);
  if (current) {
    return { hold: current, already: true };
  }
  const hold: SessionHold = { at: Date.now(), userId: by.id, name: by.username, number: sessionsEnded(campaignId) + 1 };
  pauseDmQueue(campaignId, SESSION_REASON);
  publishPersisted(campaignId, "session_ended", hold);
  chronicleLine(campaignId, sessionEndedLine(hold.number));
  return { hold, already: false };
}

// Starts the next session where the last one stopped. After a real gap a
// "Previously, on..." goes first on the queue, ahead of any turn that was
// waiting at the gate, so the table reads where it stands before the story
// moves. Null when no session was ended.
export function startSession(campaignId: string, by: { id: string; username: string }): { number: number } | null {
  const current = sessionHoldOn(campaignId);
  if (!current) {
    return null;
  }
  const number = current.number + 1;
  resumeDmQueue(campaignId, SESSION_REASON);
  publishPersisted(campaignId, "session_started", { at: Date.now(), userId: by.id, name: by.username, number });
  const seq = chronicleLine(campaignId, sessionStartedLine(number));
  // The claim is the actions route's own, so the first action after the
  // start does not ask for a second recap of the same gap.
  if (recapOnStart(current.at, Date.now()) && claimRecap(campaignId, seq)) {
    const span = lastSessionSpan(campaignId, current.number);
    enqueueDmJobFirst(campaignId, () => runResumeRecap(campaignId, span ?? undefined));
  }
  return { number };
}

// Where the session that just ended began and stopped, in the table's own
// sequence: from the start that opened it (the campaign's first line, for
// the first session) to the end that closed it.
function lastSessionSpan(campaignId: string, number: number): RecapSession | null {
  const ended = latestEventOfType(campaignId, ["session_ended"]);
  if (!ended) {
    return null;
  }
  const started = getDatabase()
    .prepare(`SELECT MAX(seq) AS seq FROM campaign_events WHERE campaign_id = ? AND type = 'session_started' AND seq < ?`)
    .get(campaignId, ended.seq) as { seq: number | null };
  return { number, fromSeq: (started.seq ?? 0) + 1, toSeq: ended.seq };
}

// The hold lives in memory, so a restart would start every table's next
// session with nobody pressing Start. The persisted events still say the
// session ended, so a starting server holds the table again, as it does a
// break and a raised X-card (src/lib/dm/restart-recovery.ts). Returns those
// tables.
export function restoreSessionHolds(): string[] {
  // SQLite answers the bare `type` from the row that holds MAX(seq). Only a
  // campaign still in play is held: one ended between sessions is over.
  const latest = getDatabase()
    .prepare(
      `SELECT e.campaign_id AS campaignId, e.type, MAX(e.seq) AS seq FROM campaign_events e
        JOIN campaigns c ON c.id = e.campaign_id AND c.status = 'active'
        WHERE e.type IN ('session_ended', 'session_started') GROUP BY e.campaign_id`,
    )
    .all() as Array<{ campaignId: string; type: string; seq: number }>;
  const held = latest.filter((row) => row.type === "session_ended").map((row) => row.campaignId);
  for (const campaignId of held) {
    pauseDmQueue(campaignId, SESSION_REASON);
  }
  return held;
}
