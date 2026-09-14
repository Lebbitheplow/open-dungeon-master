import { getDatabase, nowIso } from "@/lib/db/core";
import { MINUTES_PER_DAY, daysPerYear, type CalendarDefinition, type Instant } from "@/lib/dm/calendar";

// Calendar events (docs/vtt-parity-implementation-plan.md 7.2): a moment on
// the in-world clock with a title, a body, who may see it and whether it
// comes round again. The clock advancing is what fires them.

export type EventVisibility = "party" | "dm";
export type EventRepeat = "none" | "yearly" | "monthly";

export type CalendarEvent = {
  id: string;
  campaignId: string;
  atInstant: Instant;
  title: string;
  body: string;
  visibility: EventVisibility;
  repeat: EventRepeat;
  firedAt: Instant;
  firedSeq: number;
  createdAt: string;
};

type Row = {
  id: string;
  campaign_id: string;
  at_instant: number;
  title: string;
  body: string;
  visibility: string;
  repeat: string;
  fired_at: number;
  fired_seq: number;
  created_at: string;
};

function map(row: Row): CalendarEvent {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    atInstant: row.at_instant,
    title: row.title,
    body: row.body,
    visibility: row.visibility === "dm" ? "dm" : "party",
    repeat: row.repeat === "yearly" || row.repeat === "monthly" ? row.repeat : "none",
    firedAt: row.fired_at,
    firedSeq: row.fired_seq,
    createdAt: row.created_at,
  };
}

export function listCalendarEvents(campaignId: string, includeDmOnly: boolean): CalendarEvent[] {
  const rows = getDatabase()
    .prepare(
      includeDmOnly
        ? `SELECT * FROM calendar_events WHERE campaign_id = ? ORDER BY at_instant ASC, created_at ASC`
        : `SELECT * FROM calendar_events WHERE campaign_id = ? AND visibility = 'party' ORDER BY at_instant ASC, created_at ASC`,
    )
    .all(campaignId) as Row[];
  return rows.map(map);
}

export function insertCalendarEvent(input: {
  campaignId: string;
  atInstant: Instant;
  title: string;
  body?: string;
  visibility?: EventVisibility;
  repeat?: EventRepeat;
}): CalendarEvent {
  const id = crypto.randomUUID();
  getDatabase()
    .prepare(
      `INSERT INTO calendar_events (id, campaign_id, at_instant, title, body, visibility, repeat, fired_at, fired_seq, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, -1, 0, ?)`,
    )
    .run(
      id,
      input.campaignId,
      Math.max(0, Math.round(input.atInstant)),
      input.title.trim().slice(0, 120),
      (input.body ?? "").trim().slice(0, 600),
      input.visibility === "dm" ? "dm" : "party",
      input.repeat === "yearly" || input.repeat === "monthly" ? input.repeat : "none",
      nowIso(),
    );
  return map(getDatabase().prepare(`SELECT * FROM calendar_events WHERE id = ?`).get(id) as Row);
}

export function deleteCalendarEvent(campaignId: string, eventId: string): boolean {
  return getDatabase().prepare(`DELETE FROM calendar_events WHERE id = ? AND campaign_id = ?`).run(eventId, campaignId).changes > 0;
}

export function markCalendarEventFired(eventId: string, at: Instant, seq: number) {
  getDatabase().prepare(`UPDATE calendar_events SET fired_at = ?, fired_seq = ? WHERE id = ?`).run(at, seq, eventId);
}

// The instant an event next falls on at or after `from`, honouring its
// repeat: a yearly one comes round every year of the calendar, a monthly
// one every month (of the month it was set in, by length). A one-off
// answers its own instant.
export function nextOccurrence(event: CalendarEvent, calendar: CalendarDefinition, from: Instant): Instant {
  if (event.repeat === "none" || event.atInstant >= from) {
    return event.atInstant;
  }
  const period =
    event.repeat === "yearly"
      ? daysPerYear(calendar) * MINUTES_PER_DAY
      : Math.max(1, calendar.months[monthIndexOf(calendar, event.atInstant)]?.days ?? 30) * MINUTES_PER_DAY;
  const steps = Math.ceil((from - event.atInstant) / period);
  return event.atInstant + steps * period;
}

function monthIndexOf(calendar: CalendarDefinition, instant: Instant): number {
  let day = Math.floor(instant / MINUTES_PER_DAY) % Math.max(1, daysPerYear(calendar));
  for (const [index, month] of calendar.months.entries()) {
    if (day < month.days) {
      return index;
    }
    day -= month.days;
  }
  return 0;
}

// The events the clock crossed moving from `from` (exclusive) to `to`
// (inclusive) that have not already fired at that occurrence.
export function dueCalendarEvents(campaignId: string, calendar: CalendarDefinition, from: Instant, to: Instant): Array<{ event: CalendarEvent; at: Instant }> {
  if (to <= from) {
    return [];
  }
  const due: Array<{ event: CalendarEvent; at: Instant }> = [];
  for (const event of listCalendarEvents(campaignId, true)) {
    const at = nextOccurrence(event, calendar, from + 1);
    if (at > from && at <= to && event.firedAt !== at) {
      due.push({ event, at });
    }
  }
  return due;
}
