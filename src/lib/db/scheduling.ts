import { randomUUID } from "node:crypto";
import { getDatabase, nowIso } from "@/lib/db/core";

// Real-world session planning: dates the humans agree to sit down, with
// RSVPs. Times are stored as ISO UTC and rendered in each player's locale;
// the server never does timezone math beyond "is this in the past".

export type RsvpResponse = "yes" | "no" | "maybe";

// A human-enough rendering for notification prose. Times are UTC on the
// wire; the schedule list itself renders in each player's locale.
export function sessionWhen(startsAt: string): string {
  return `${startsAt.slice(0, 16).replace("T", " ")} UTC`;
}

export type ScheduledSession = {
  id: string;
  campaignId: string;
  title: string;
  startsAt: string;
  durationMin: number;
  note: string;
  createdByUserId: string;
  createdAt: string;
  cancelledAt: string | null;
  rsvps: Array<{ userId: string; response: RsvpResponse }>;
};

type SessionRow = {
  id: string;
  campaign_id: string;
  title: string;
  starts_at: string;
  duration_min: number;
  note: string;
  created_by_user_id: string;
  created_at: string;
  cancelled_at: string | null;
};

function withRsvps(row: SessionRow): ScheduledSession {
  const rsvps = getDatabase()
    .prepare(`SELECT user_id, response FROM session_rsvps WHERE session_id = ?`)
    .all(row.id) as Array<{ user_id: string; response: RsvpResponse }>;
  return {
    id: row.id,
    campaignId: row.campaign_id,
    title: row.title,
    startsAt: row.starts_at,
    durationMin: row.duration_min,
    note: row.note,
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at,
    cancelledAt: row.cancelled_at,
    rsvps: rsvps.map((entry) => ({ userId: entry.user_id, response: entry.response })),
  };
}

export function createScheduledSession(
  campaignId: string,
  createdByUserId: string,
  input: { title: string; startsAt: string; durationMin: number; note: string },
): ScheduledSession {
  const id = randomUUID();
  getDatabase()
    .prepare(
      `INSERT INTO scheduled_sessions
         (id, campaign_id, title, starts_at, duration_min, note, created_by_user_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      campaignId,
      input.title,
      input.startsAt,
      input.durationMin,
      input.note,
      createdByUserId,
      nowIso(),
    );
  return getScheduledSession(campaignId, id) as ScheduledSession;
}

export function getScheduledSession(
  campaignId: string,
  sessionId: string,
): ScheduledSession | null {
  const row = getDatabase()
    .prepare(`SELECT * FROM scheduled_sessions WHERE id = ? AND campaign_id = ?`)
    .get(sessionId, campaignId) as SessionRow | undefined;
  return row ? withRsvps(row) : null;
}

// Everything still worth showing: upcoming sessions, anything from the last
// day (so "we played yesterday" lingers briefly), and recent cancellations.
export function listScheduledSessions(campaignId: string): ScheduledSession[] {
  const horizon = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const rows = getDatabase()
    .prepare(
      `SELECT * FROM scheduled_sessions
       WHERE campaign_id = ? AND starts_at >= ?
       ORDER BY starts_at ASC LIMIT 20`,
    )
    .all(campaignId, horizon) as SessionRow[];
  return rows.map(withRsvps);
}

export function updateScheduledSession(
  campaignId: string,
  sessionId: string,
  patch: { title?: string; startsAt?: string; durationMin?: number; note?: string },
): ScheduledSession | null {
  const existing = getScheduledSession(campaignId, sessionId);
  if (!existing || existing.cancelledAt) {
    return null;
  }
  // Rescheduling re-arms the reminder job: the notes already sent were about
  // the old time (src/lib/jobs.ts walks reminded_stage forward only).
  const moved = (patch.startsAt ?? existing.startsAt) !== existing.startsAt;
  getDatabase()
    .prepare(
      `UPDATE scheduled_sessions SET title = ?, starts_at = ?, duration_min = ?, note = ?,
         reminded_stage = CASE WHEN ? THEN 0 ELSE reminded_stage END
       WHERE id = ? AND campaign_id = ?`,
    )
    .run(
      patch.title ?? existing.title,
      patch.startsAt ?? existing.startsAt,
      patch.durationMin ?? existing.durationMin,
      patch.note ?? existing.note,
      moved ? 1 : 0,
      sessionId,
      campaignId,
    );
  return getScheduledSession(campaignId, sessionId);
}

export function cancelScheduledSession(
  campaignId: string,
  sessionId: string,
): ScheduledSession | null {
  const result = getDatabase()
    .prepare(
      `UPDATE scheduled_sessions SET cancelled_at = ?
       WHERE id = ? AND campaign_id = ? AND cancelled_at IS NULL`,
    )
    .run(nowIso(), sessionId, campaignId);
  return result.changes > 0 ? getScheduledSession(campaignId, sessionId) : null;
}

// The reminder job's worklist: live sessions still owed a note, starting
// inside the window the job cares about. Which note (if any) is due is the
// pure helper's call (src/lib/jobs.ts dueReminderStage); this only narrows
// the scan. ISO strings compare lexicographically, so BETWEEN is sound.
export function listSessionsAwaitingReminder(
  notBeforeIso: string,
  notAfterIso: string,
): Array<{
  id: string;
  campaignId: string;
  title: string;
  startsAt: string;
  remindedStage: number;
  cancelledAt: string | null;
}> {
  const rows = getDatabase()
    .prepare(
      `SELECT id, campaign_id, title, starts_at, reminded_stage, cancelled_at
       FROM scheduled_sessions
       WHERE cancelled_at IS NULL AND reminded_stage < 2
         AND starts_at >= ? AND starts_at <= ?`,
    )
    .all(notBeforeIso, notAfterIso) as Array<{
    id: string;
    campaign_id: string;
    title: string;
    starts_at: string;
    reminded_stage: number;
    cancelled_at: string | null;
  }>;
  return rows.map((row) => ({
    id: row.id,
    campaignId: row.campaign_id,
    title: row.title,
    startsAt: row.starts_at,
    remindedStage: row.reminded_stage,
    cancelledAt: row.cancelled_at,
  }));
}

export function setSessionReminderStage(sessionId: string, stage: number): void {
  getDatabase()
    .prepare(`UPDATE scheduled_sessions SET reminded_stage = ? WHERE id = ?`)
    .run(stage, sessionId);
}

export function setRsvp(
  sessionId: string,
  userId: string,
  response: RsvpResponse,
): void {
  getDatabase()
    .prepare(
      `INSERT INTO session_rsvps (session_id, user_id, response, responded_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(session_id, user_id) DO UPDATE SET response = excluded.response,
         responded_at = excluded.responded_at`,
    )
    .run(sessionId, userId, response, nowIso());
}
