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

// The readers' revision, stored with the readings a pack build writes
// (scripts/lib/pack-readings.mjs). Raise it whenever any reader's answer
// changes: a pack whose readings an older revision wrote is read live
// (src/lib/content/pack-readings.ts), and scripts/test-pack-readings.mjs
// fails while an installed pack's stored readings differ from the readers'.
//   2: an SRD entry reads as checked (the SRD 5.1 text audit).
//   3: the SRD 5.1 text audit's fixes changed spell and monster readings
//      (spells read as hand-written rows, corrected monster blocks).
export const READER_REVISION = 3;
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

// The SRD's own documents in the pack. Every SRD spell, creature and item
// was held up against the SRD 5.1 text the app bundles by issue #570's audit
// (scripts/test-enforce-srd-*.mjs, docs/srd-text-audit.md), which fails
// where the engine reads one differently.
const SRD_DOCUMENTS = new Set(["wotc-srd", "srd-2014"]);

// Whether a person has checked this entry's parsed reading against its
// text: an SRD entry (the audit above), or one in a reader's golden set
// (test-reader-golden.mjs keeps checked-readings.json equal to their ids).
export function readingChecked(kind: ReadingKind, row: Pick<ReadingRow, "documentSlug" | "slug">): boolean {
  return SRD_DOCUMENTS.has(row.documentSlug) || CHECKED.has(readingId(kind, row));
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

// What the table reads beside such a reading.
export const BEST_EFFORT_LABEL = "Best effort";
// The same, as a chip beside the other lowercase chips (the reference's
// "ritual", the forge's "CR 2").
export const BEST_EFFORT_CHIP = "best effort";
// Short enough for a card's face; the details carry the note.
export const BEST_EFFORT_SHORT = "Best effort: read from its text, not yet checked.";
export const BEST_EFFORT_NOTE =
  "Best effort: the app read this entry's rules from its text, and nobody has checked that reading yet. If it plays differently from what the text says, the text and the GM win, and a workshop copy can fix it for your table.";

// Whether the table should be told a reading is the parser's best effort:
// read from prose (or tried and missed something the text holds), and
// nobody has checked it.
export function readingIsBestEffort(entry: Pick<EntryReading, "source" | "unread" | "checked">): boolean {
  if (entry.checked || entry.source === "hand-written") {
    return false;
  }
  return entry.source === "parsed" || entry.unread.length > 0;
}
