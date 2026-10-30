import type { AuditEntry } from "@/app/campaigns/[campaignId]/useCampaignStream";
import type { CharacterEvent } from "@/lib/db/character-events";
import type { ClockTurn } from "@/lib/db/clock-moves";
import { quietTick } from "@/lib/sheet-audit-logic";

// What the event log lists and which turns it offers to revert. Pure, so a
// suite reads it without a browser (scripts/test-event-log-logic.mjs). The
// clock turns (src/lib/db/clock-moves.ts) come from the campaign snapshot
// and the clock_changed event; an older host sends none, and the log keeps
// its old rule.

export type FeedItem =
  | { type: "audit"; seq: number; entry: AuditEntry }
  // A run of changes that only counted time down, from one turn.
  | { type: "ticks"; seq: number; turnId: string; entries: AuditEntry[] }
  | { type: "time"; seq: number; move: ClockTurn }
  | { type: "milestone"; seq: number; event: CharacterEvent };

// Newest first: the sheet changes, the milestones and the time the turns
// moved on, with each run of one turn's quiet ticks (src/lib/
// sheet-audit-logic.ts) folded into one item: the turn's revert puts them
// back, but none is news.
export function buildFeed(auditLog: AuditEntry[], characterEvents: CharacterEvent[], clockTurns: ClockTurn[] = []): FeedItem[] {
  const items: FeedItem[] = [
    ...auditLog.map((entry) => ({ type: "audit" as const, seq: entry.seq, entry })),
    ...characterEvents.map((event) => ({ type: "milestone" as const, seq: event.seq, event })),
    ...clockTurns.map((move) => ({ type: "time" as const, seq: move.seq, move })),
  ].sort((a, b) => b.seq - a.seq);
  const feed: FeedItem[] = [];
  for (const item of items) {
    if (item.type !== "audit" || !quietTick(item.entry)) {
      feed.push(item);
      continue;
    }
    const turnId = item.entry.turnId ?? "";
    const last = feed.at(-1);
    if (last?.type === "ticks" && last.turnId === turnId) {
      last.entries.push(item.entry);
      continue;
    }
    feed.push({ type: "ticks", seq: item.seq, turnId, entries: [item.entry] });
  }
  return feed;
}

// The turn an item belongs to, if any.
export function turnOfItem(item: FeedItem): string | null {
  if (item.type === "audit") {
    return item.entry.turnId ?? null;
  }
  if (item.type === "ticks") {
    return item.turnId || null;
  }
  return item.type === "time" ? item.move.turnId : null;
}

// The turns the log offers "Revert this turn" for, with how many live sheet
// changes each would undo: two or more, as before; or any number (none
// included) when the turn moved the clock and the time is not back yet,
// since an undo of one change never moves the clock (issue #622).
export function revertableTurns(auditLog: AuditEntry[], clockTurns: ClockTurn[] = []): Map<string, number> {
  const live = new Map<string, number>();
  for (const entry of auditLog) {
    if (entry.turnId && entry.undoable && !entry.revertedAt && entry.kind !== "undo") {
      live.set(entry.turnId, (live.get(entry.turnId) ?? 0) + 1);
    }
  }
  const timed = new Set(clockTurns.map((move) => move.turnId));
  const turns = new Map<string, number>();
  for (const [turnId, count] of live) {
    if (count >= 2 || timed.has(turnId)) {
      turns.set(turnId, count);
    }
  }
  for (const turnId of timed) {
    if (!turns.has(turnId)) {
      turns.set(turnId, 0);
    }
  }
  return turns;
}
