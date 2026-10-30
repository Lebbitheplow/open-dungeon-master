import { getDatabase, nowIso, parseJson } from "@/lib/db/core";
import { normalizeClock, type CampaignClock, type Instant } from "@/lib/dm/calendar";
import type { RecordedClockMove } from "@/lib/dm/clock-rewind-logic";

// The clock moves each turn made: the clock as a move found it and where it
// left the instant. "Revert this turn" puts the time back from them
// (src/lib/db/clock.ts rewindTurnClock). Before them the clock was never
// moved back, though pass_time said that was the audit trail's job, so a
// reverted rest left the night spent (issue #622). A move made outside every
// turn (the GM's own clock controls) is not one a turn can take back, and is
// not kept.

type MoveRow = { before_json: string; after_instant: number };

export function recordClockMove(campaignId: string, turnId: string, before: CampaignClock, afterInstant: Instant) {
  getDatabase()
    .prepare(
      `INSERT INTO clock_moves (id, campaign_id, turn_id, before_json, after_instant, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(crypto.randomUUID(), campaignId, turnId, JSON.stringify(before), afterInstant, nowIso());
}

// The turn's moves not yet taken back, oldest first.
export function liveClockMoves(campaignId: string, turnId: string): RecordedClockMove[] {
  const rows = getDatabase()
    .prepare(
      `SELECT before_json, after_instant FROM clock_moves
       WHERE campaign_id = ? AND turn_id = ? AND reverted_at IS NULL
       ORDER BY rowid ASC`,
    )
    .all(campaignId, turnId) as MoveRow[];
  return rows.map((row) => ({
    before: normalizeClock(parseJson(row.before_json, null)),
    afterInstant: row.after_instant,
  }));
}

// The turn's moves have been through a revert: put back, or left standing
// because the clock had moved on since. Either way no later revert of the
// same turn reads them again.
export function markClockMovesReverted(campaignId: string, turnId: string) {
  getDatabase()
    .prepare(`UPDATE clock_moves SET reverted_at = ? WHERE campaign_id = ? AND turn_id = ? AND reverted_at IS NULL`)
    .run(nowIso(), campaignId, turnId);
}
