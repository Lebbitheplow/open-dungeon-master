// An entry's reading and needs for whoever asks (the search labels, the
// picker filters, the best-effort note): stored when the pack has them
// current (src/lib/content/pack-readings.ts), else read live with the same
// readers the build ran. Apart from pack-readings.ts so the content index,
// which the readers' own imports reach, never imports the readers back.

import { readEntry } from "@/lib/content/entry-reading";
import { storedNeeds, storedReading } from "@/lib/content/pack-readings";
import type { EntryReading, ReadingKind, ReadingRow } from "@/lib/content/reading-logic";
import { mechanicsNeeded, type Need } from "@/lib/content/needs-logic";

// A row's reading, stored when the pack has it current, else read live
// with the same reader the build ran.
export function readingOf(kind: ReadingKind, row: ReadingRow): EntryReading {
  return storedReading(kind, row.slug) ?? readEntry(kind, row);
}

// A row's needs, stored when the pack has them current, else read live.
export function needsOf(kind: ReadingKind | "item", row: Pick<ReadingRow, "slug" | "documentSlug" | "data">): Need[] {
  return storedNeeds(kind, row.slug) ?? mechanicsNeeded(row);
}
