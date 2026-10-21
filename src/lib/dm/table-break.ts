import { getDatabase } from "@/lib/db/core";
import { dmQueuePausedFor, pauseDmQueue, resumeDmQueue } from "@/lib/dm/queue";
import type { TableBreak } from "@/lib/dm/table-break-logic";
import { latestEventOfType, publishPersisted } from "@/lib/events";

// The table break (src/lib/dm/table-break-logic.ts has the rules). It holds
// the DM queue at its gate under its own reason, beside any raised X-card:
// a DM turn already running finishes and its text lands, the next one waits
// for Resume, and lowering one pause never lowers the other. The floor is
// left as it was (an open table, a spotlight, initiative mid-fight), so
// Resume picks up exactly there. Narration audio that lands during the break
// is held on every screen and plays after it (useNarrationAudio).

export const BREAK_REASON = "table-break";

// The break on the table, if there is one. The queue's gate is the truth of
// whether the table is paused; the event says who paused and when.
export function tableBreakOn(campaignId: string): TableBreak | null {
  if (!dmQueuePausedFor(campaignId, BREAK_REASON)) {
    return null;
  }
  const event = latestEventOfType(campaignId, ["table_paused"]);
  return breakFrom(event?.payload) ?? { at: Date.now(), userId: "", name: "Someone" };
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
