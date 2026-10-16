import type { Entry, Shelf } from "./model.ts";

// Which of an entry's texts is its account (audit finding WF-13). Every
// entry has its record's own text and WorldForge's article beside it, and
// when both were filled, a reader that took the article first showed an
// old text after the record's was edited. The rule, one per shelf:
//
//   - lore: the lore entry's own body is the account, the one text players,
//     the lore panel and search already read. WorldForge keeps no article
//     beside it. An older article an import left is kept until the author
//     chooses, and never shown in its place.
//   - places: two texts with two jobs, each shown under its own name. The
//     place's row holds what the DM reads on arrival (2,000 characters);
//     the article is the wiki's full account.
//   - the Cast and factions: the row holds one line the table sees; the
//     article is the full account.
//
// Pure, no "@/" imports, so the database layer's startup repair can use it.

type Texts = { shelf: Shelf; text: string; entry: Pick<Entry, "article"> };

// What the record's own row holds: a place's arrival text
// (src/lib/db/world-forge.ts writeRecord) and a lore entry's body
// (src/lib/dm/world-lore-logic.ts LORE_BODY_MAX, checked equal by
// scripts/test-world-one-text.mjs).
export const ROW_TEXT = { location: 2_000, lore: 20_000 } as const;

// Whether the account lives in the record's own row.
export const accountInRow = (shelf: Shelf) => shelf === "lore";

// The text that says what the entry is: the one the wiki shows first, the
// DM is given, search reads and an export writes.
export function accountOf(entity: Texts): string {
  return accountInRow(entity.shelf) ? entity.text || entity.entry.article : entity.entry.article || entity.text;
}

// A lore entry's older article that the account does not already hold, for
// the author to keep or remove. "" when there is none.
export function olderText(entity: Texts): string {
  if (!accountInRow(entity.shelf) || !entity.entry.article.trim()) return "";
  return settleLoreTexts(entity.text, entity.entry.article, Number.POSITIVE_INFINITY) ? "" : entity.entry.article;
}

// A lore body and an article beside it, as one text when one holds the
// other: an import that cut a long text to fit the row left the cut copy as
// the body and the whole as the article, so the whole becomes the body.
// Null when they say different things, or the whole is over `max`: then
// both are kept and the author chooses.
export function settleLoreTexts(body: string, article: string, max: number): { body: string; article: "" } | null {
  const own = body.trim();
  const other = article.trim();
  if (!other) return { body, article: "" };
  if (own.startsWith(other)) return { body, article: "" };
  if ((!own || other.startsWith(own)) && other.length <= max) return { body: other, article: "" };
  return null;
}

// The start of a long text for a short slot, ending where a sentence or a
// paragraph does rather than mid-word: what a place's arrival text holds
// when its article is longer than the row.
export function leadOf(text: string, max: number): string {
  const whole = text.trim();
  if (whole.length <= max) return whole;
  const head = whole.slice(0, max);
  const ends = [...head.matchAll(/[.!?]["')\]]?(?=\s)|\n/g)].map((match) => match.index + match[0].length);
  const end = ends.length ? ends[ends.length - 1] : 0;
  if (end >= max / 2) return head.slice(0, end).trim();
  const space = head.lastIndexOf(" ");
  return `${head.slice(0, space > max / 2 ? space : max - 1).trimEnd()}…`;
}
