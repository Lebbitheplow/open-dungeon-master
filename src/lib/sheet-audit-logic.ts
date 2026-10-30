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
  if (entry.kind === "concentration_clock") {
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

// The field names a sheet change writes, as a lead reads them. The undo's
// conflict warning named the raw kind and keys ("A newer lead_edit change
// ... also touched: deathSaves"), right where the lead decides whether to
// revert anyway (issue #622).
const FIELD_WORDS: Record<string, string> = {
  currentHp: "hit points",
  maxHp: "hit point maximum",
  tempHp: "temporary hit points",
  deathSaves: "death saves",
  conditionMeta: "conditions",
  spellSlots: "spell slots",
  hitDiceRemaining: "hit dice",
  wildShape: "Wild Shape",
};

export function fieldWords(key: string): string {
  return FIELD_WORDS[key] ?? key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
}

// Why an undo would overwrite a later change: who it was to, the later
// change's own reason, and the fields both wrote, in words.
export function undoConflictLine(name: string, reason: string, keys: readonly string[]): string {
  const fields = [...new Set(keys.map(fieldWords))].join(", ");
  return `A later change to ${name} (${reason.trim() || "no reason given"}) also changed their ${fields}.`;
}
