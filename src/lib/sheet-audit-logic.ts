// What the audit trail's readers count as a change. Pure, and shared by the
// server (the campaign snapshot, the beat drafts) and the event log
// (src/app/campaigns/[campaignId]/event-log-logic.ts).

type AuditRow = { kind: string; delta: Record<string, unknown> };

// A change that only counted time down: a condition's rounds, a spell's
// minutes, a mark a turn's start sets. A fight writes several each round,
// one per character, and each is a real change a turn's revert puts back
// (issue #622), but none is news: the log folds them into one line, and
// they never take a real change's place in a window of recent changes.
export function quietTick(entry: AuditRow): boolean {
  if (entry.kind === "concentration") {
    return true;
  }
  if (entry.kind !== "condition_clock") {
    return false;
  }
  const none = (value: unknown) => !Array.isArray(value) || !value.length;
  return none(entry.delta.ended) && none(entry.delta.added);
}

// The window of a log, oldest first, that holds its newest `keep` real
// changes and the quiet ticks that fall among them. Ticks count toward no
// window: a long fight's rounds would otherwise push the changes a lead
// wants to see out of it. `maxRows` bounds the whole, newest kept, so a
// stretch of ticks with no change in it cannot grow without end.
export function changesWindow<T extends AuditRow>(entries: T[], keep: number, maxRows = 1000): T[] {
  let changes = 0;
  let start = 0;
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    if (!quietTick(entries[index])) {
      changes += 1;
      if (changes === keep) {
        start = index;
        break;
      }
    }
  }
  return entries.slice(Math.max(start, entries.length - maxRows));
}
