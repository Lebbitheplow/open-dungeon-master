import { allocateSeq } from "@/lib/db/campaigns";
import { getDatabase, nowIso, parseJson } from "@/lib/db/core";
import { describeDuration, normalizeClock, type CampaignClock, type Instant } from "@/lib/dm/calendar";
import type { RecordedClockMove } from "@/lib/dm/clock-rewind-logic";

// A GM turn's moves of the in-world clock not yet taken back, as the
// campaign snapshot and the clock_changed event carry them to the event log
// (issue #622): where it falls in the log, and how much time passed.
export type ClockTurn = { turnId: string; seq: number; passed: string };

// The clock moves each turn made: the clock as a move found it and where it
// left the instant. "Revert this turn" puts the time back from them
// (src/lib/db/clock.ts rewindTurnClock). Before them the clock was never
// moved back, though pass_time said that was the audit trail's job, so a
// reverted rest left the night spent (issue #622). A move made outside every
// turn (the GM's own clock controls) is not one a turn can take back, and is
// not kept.

type MoveRow = { turn_id: string; before_json: string; after_instant: number; seq: number };

export function recordClockMove(campaignId: string, turnId: string, before: CampaignClock, afterInstant: Instant) {
  getDatabase()
    .prepare(
      `INSERT INTO clock_moves (id, campaign_id, turn_id, before_json, after_instant, seq, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(crypto.randomUUID(), campaignId, turnId, JSON.stringify(before), afterInstant, allocateSeq(campaignId), nowIso());
}

function asMove(row: MoveRow): RecordedClockMove {
  return { before: normalizeClock(parseJson(row.before_json, null)), afterInstant: row.after_instant };
}

// The turn's moves not yet taken back, oldest first.
export function liveClockMoves(campaignId: string, turnId: string): RecordedClockMove[] {
  const rows = getDatabase()
    .prepare(
      `SELECT turn_id, before_json, after_instant, seq FROM clock_moves
       WHERE campaign_id = ? AND turn_id = ? AND reverted_at IS NULL
       ORDER BY rowid ASC`,
    )
    .all(campaignId, turnId) as MoveRow[];
  return rows.map(asMove);
}

// One turn's live moves as the event log lists them: at its latest move,
// with the time from its first move's start to its last move's end.
function asClockTurn(turnId: string, rows: MoveRow[]): ClockTurn {
  const moves = rows.map(asMove);
  const minutes = moves[moves.length - 1].afterInstant - moves[0].before.instant;
  return { turnId, seq: Math.max(...rows.map((row) => row.seq)), passed: describeDuration(minutes) };
}

export function clockTurnOf(campaignId: string, turnId: string): ClockTurn | null {
  const rows = getDatabase()
    .prepare(
      `SELECT turn_id, before_json, after_instant, seq FROM clock_moves
       WHERE campaign_id = ? AND turn_id = ? AND reverted_at IS NULL
       ORDER BY rowid ASC`,
    )
    .all(campaignId, turnId) as MoveRow[];
  return rows.length ? asClockTurn(turnId, rows) : null;
}

// The campaign's recent turns whose time is not back yet, for the event log
// (the snapshot's clockTurns): the newest `limit` moves' turns.
export function listLiveClockTurns(campaignId: string, limit = 50): ClockTurn[] {
  const rows = getDatabase()
    .prepare(
      `SELECT turn_id, before_json, after_instant, seq FROM clock_moves
       WHERE campaign_id = ? AND reverted_at IS NULL
       ORDER BY rowid DESC LIMIT ?`,
    )
    .all(campaignId, limit) as MoveRow[];
  const byTurn = new Map<string, MoveRow[]>();
  for (const row of rows.reverse()) {
    byTurn.set(row.turn_id, [...(byTurn.get(row.turn_id) ?? []), row]);
  }
  return [...byTurn].map(([turnId, moves]) => asClockTurn(turnId, moves));
}

// The turn's moves have been through a revert: put back, or left standing
// because the clock had moved on since. Either way no later revert of the
// same turn reads them again.
export function markClockMovesReverted(campaignId: string, turnId: string) {
  getDatabase()
    .prepare(`UPDATE clock_moves SET reverted_at = ? WHERE campaign_id = ? AND turn_id = ? AND reverted_at IS NULL`)
    .run(nowIso(), campaignId, turnId);
}
