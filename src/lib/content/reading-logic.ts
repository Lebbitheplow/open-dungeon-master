// What the engine reads from a content entry's text, said once for every
// kind of entry (issue #570, "Rules and content"). Each reader below is the
// same function the game plays the entry with; this module only records
// where its answer came from and what the text holds that the answer lacks:
//
//   source    "hand-written": a row someone typed (spell-mech-*.ts, the
//             authored files, the bundled SRD options), which the engine
//             trusts over the text;
//             "parsed": read from the entry's prose by a parser;
//             "missing": nothing the engine can play was read.
//   unread    what the text plainly holds that the reading does not carry
//             ("save", "buff", "Fire Breath"), so a reader's misses can be
//             counted and listed instead of found at the table.
//   checked   a person has held this reading up against the text: every
//             hand-written row, every entry in a reader's golden set
//             (scripts/fixtures/reader-golden/), a corrected monster block.
//
// Pure: the pack build stores these, scripts/test-reader-golden.mjs holds
// each reader to its golden set without a pack, and the server reads an
// entry live when its pack has no stored reading.

import checkedJson from "@/lib/content/checked-readings.json";

export const READING_KINDS = ["spell", "monster", "feat", "race", "class", "background", "archetype"] as const;
export type ReadingKind = (typeof READING_KINDS)[number];
export type ReadingSource = "hand-written" | "parsed" | "missing";

export type EntryReading = {
  source: ReadingSource;
  // The reader's answer, as the engine plays it; null when missing.
  mechanics: unknown;
  unread: string[];
  checked: boolean;
};

// A content row as every reader takes it: the pack's columns, its parsed
// data_json, and the few columns some readers need.
export type ReadingRow = {
  slug: string;
  name: string;
  documentSlug: string;
  data: Record<string, unknown>;
  aliases?: string[];
  cr?: number | null;
  classSlug?: string | null;
};

// "<kind>:<document>/<slug>", the key of the golden sets and of the
// checked list.
export function readingId(kind: ReadingKind, row: Pick<ReadingRow, "documentSlug" | "slug">): string {
  return `${kind}:${row.documentSlug}/${row.slug}`;
}

const CHECKED = new Set((checkedJson as { ids: string[] }).ids);

// Whether a person has checked this entry's parsed reading against its
// text. The golden sets are the list (test-reader-golden.mjs keeps
// checked-readings.json equal to their ids).
export function readingChecked(kind: ReadingKind, row: Pick<ReadingRow, "documentSlug" | "slug">): boolean {
  return CHECKED.has(readingId(kind, row));
}

// A reading from its parts: the source follows from what answered, and
// a hand-written row is checked by definition.
export function reading(input: {
  handWritten: unknown;
  parsed: unknown;
  unread: string[];
  checked: boolean;
}): EntryReading {
  if (input.handWritten !== null && input.handWritten !== undefined) {
    return { source: "hand-written", mechanics: input.handWritten, unread: [], checked: true };
  }
  const found = input.parsed !== null && input.parsed !== undefined;
  return {
    source: found ? "parsed" : "missing",
    mechanics: found ? input.parsed : null,
    unread: [...new Set(input.unread)].sort(),
    checked: input.checked,
  };
}

// Whether the table should be told a reading is the parser's best effort:
// read from prose (or tried and missed something the text holds), and
// nobody has checked it.
export function readingIsBestEffort(entry: Pick<EntryReading, "source" | "unread" | "checked">): boolean {
  if (entry.checked || entry.source === "hand-written") {
    return false;
  }
  return entry.source === "parsed" || entry.unread.length > 0;
}
