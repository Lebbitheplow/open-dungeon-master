import { getDatabase } from "@/lib/db/core";
import { dmQueuePausedFor, pauseDmQueue, resumeDmQueue } from "@/lib/dm/queue";
import { BREAK_REASON, breakRefusal, type TableBreak } from "@/lib/dm/table-break-logic";
import { sessionHoldOn } from "@/lib/dm/session-hold";
import { sessionRefusal } from "@/lib/dm/session-hold-logic";
import { latestEventOfType, publishPersisted } from "@/lib/events";

// The table break (src/lib/dm/table-break-logic.ts has the rules). It holds
// the DM queue at its gate under its own reason, beside any raised X-card:
// a DM turn already running finishes and its text lands, the next one waits
// for Resume, and lowering one pause never lowers the other. The floor is
// left as it was (an open table, a spotlight, initiative mid-fight), so
// Resume picks up exactly there. Narration audio that lands during the break
// is held on every screen and plays after it (useNarrationAudio).

export { BREAK_REASON };

// The break on the table, if there is one. The queue's gate is the truth of
// whether the table is paused; the event says who paused and when.
export function tableBreakOn(campaignId: string): TableBreak | null {
  if (!dmQueuePausedFor(campaignId, BREAK_REASON)) {
    return null;
  }
  const event = latestEventOfType(campaignId, ["table_paused"]);
  return breakFrom(event?.payload) ?? { at: Date.now(), userId: "", name: "Someone" };
}

// The one gate a new play mutation passes (table audit 2026-10-26, T05).
// While the table is on a break only table talk goes through
// (table-break-logic.ts), so a route that would start something in play (an
// action, a move, a turn ended, a trade, a parked roll resolved, the DM's
// adjudication or narration, the floor or the initiative order moved) asks
// this first and answers its 409, the break's own words beside the break
// itself, before it changes anything. Ask it after the body is read, so
// nothing awaits between the answer and the write. Null while the table
// plays. Only six routes asked before, each in its own words; a purchase, a
// fresh adjudication and a parked initiative roll went straight through.
//
// What the break lets finish never asks: a storyteller turn already running
// reaches the engine directly (src/lib/dm/turn.ts), not through a route, and
// its text lands. `finishing` says the same of work begun before the break
// that does come through a route: a connected agent program's turn
// (src/lib/dm/agent-turn.ts agentTurnBegunBefore).
//
// Between sessions (src/lib/dm/session-hold.ts) the same gate holds, in its
// own words, so ending a session closed every one of these routes at once.
export function refuseDuringBreak(
  campaignId: string,
  finishing?: (hold: { at: number }) => boolean,
): Response | null {
  const sessionHold = sessionHoldOn(campaignId);
  if (sessionHold) {
    return finishing?.(sessionHold)
      ? null
      : Response.json({ error: sessionRefusal(sessionHold), sessionHold }, { status: 409 });
  }
  const tableBreak = tableBreakOn(campaignId);
  if (!tableBreak || finishing?.(tableBreak)) {
    return null;
  }
  return Response.json({ error: breakRefusal(tableBreak), tableBreak }, { status: 409 });
}

function breakFrom(payload: unknown): TableBreak | null {
  const value = payload as Partial<TableBreak> | null;
  if (!value || typeof value.userId !== "string") {
    return null;
  }
  const at = Number(value.at);
  return { at: Number.isFinite(at) ? at : Date.now(), userId: value.userId, name: String(value.name ?? "Someone") };
}

// Pausing a paused table changes nothing: the first break stands, with its
// name and its clock.
export function pauseTable(campaignId: string, by: { id: string; username: string }): { tableBreak: TableBreak; already: boolean } {
  const current = tableBreakOn(campaignId);
  if (current) {
    return { tableBreak: current, already: true };
  }
  const tableBreak: TableBreak = { at: Date.now(), userId: by.id, name: by.username };
  pauseDmQueue(campaignId, BREAK_REASON);
  publishPersisted(campaignId, "table_paused", tableBreak);
  return { tableBreak, already: false };
}

// Lifts the break, and only the break: a raised X-card keeps the queue held.
// False when there was no break to lift.
export function resumeTable(campaignId: string, by: { id: string; username: string }): boolean {
  const current = tableBreakOn(campaignId);
  if (!current) {
    return false;
  }
  resumeDmQueue(campaignId, BREAK_REASON);
  publishPersisted(campaignId, "table_resumed", {
    at: Date.now(),
    userId: by.id,
    name: by.username,
    pausedBy: current.userId,
  });
  return true;
}

// The pause is held in memory, so a restart would end every break without
// anyone resuming it, and the queue would run the next turn with the
// player still away. The persisted events still say the table is paused,
// so a starting server pauses it again for every table whose latest break
// event is a pause (src/lib/dm/restart-recovery.ts), as it raises the
// X-card again. Returns those tables.
export function restoreTableBreaks(): string[] {
  // SQLite answers the bare `type` from the row that holds MAX(seq).
  const latest = getDatabase()
    .prepare(
      `SELECT campaign_id AS campaignId, type, MAX(seq) AS seq FROM campaign_events
        WHERE type IN ('table_paused', 'table_resumed') GROUP BY campaign_id`,
    )
    .all() as Array<{ campaignId: string; type: string; seq: number }>;
  const paused = latest.filter((row) => row.type === "table_paused").map((row) => row.campaignId);
  for (const campaignId of paused) {
    pauseDmQueue(campaignId, BREAK_REASON);
  }
  return paused;
}
