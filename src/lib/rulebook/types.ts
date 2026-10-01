// The rulebook: the System Reference Document 5.1 as a book of pages
// (src/lib/rulebook/srd-5.1.json, built by scripts/import-srd-rulebook.mjs).
// These are the shapes the book is stored in and the shapes its three API
// routes send (contents, one page, search).

export type RulebookKind = "rules" | "race" | "class" | "spell" | "item" | "monster";

export type RulebookPage = {
  id: string;
  chapter: string;
  title: string;
  kind: RulebookKind;
  md: string;
  // The entry's first italic line: "3rd-level evocation", "Huge dragon,
  // chaotic evil", "Wondrous item, uncommon".
  meta?: string;
  // How the contents groups a long chapter: a spell's level, else a letter.
  group?: string;
  // A monster's family in the SRD ("Demon", "Chromatic").
  family?: string;
};

export type RulebookChapter = {
  id: string;
  numeral: string;
  title: string;
  blurb: string;
  pages: string[];
};

export type RulebookSource = {
  title: string;
  publisher: string;
  license: string;
  licenseUrl: string;
  conversion: string;
};

export type RulebookData = {
  source: RulebookSource;
  chapters: RulebookChapter[];
  pages: RulebookPage[];
};

// A page as the contents lists it: no text. The folio is its page number in
// the whole book, counted from 1.
export type ContentsEntry = Omit<RulebookPage, "md" | "chapter"> & { folio: number };

export type ContentsChapter = Omit<RulebookChapter, "pages"> & { entries: ContentsEntry[] };

// The rules a table reaches for mid-session, one tap from the contents.
export type QuickLink = { label: string; page: string; at?: string };

export type RulebookContents = {
  source: RulebookSource;
  chapters: ContentsChapter[];
  quick: QuickLink[];
  pageCount: number;
};

export type PageLink = { id: string; title: string };

export type RulebookPageResponse = {
  page: Omit<RulebookPage, "chapter"> & { folio: number };
  chapter: { id: string; numeral: string; title: string };
  prev: PageLink | null;
  next: PageLink | null;
};

export type SearchHit = {
  page: string;
  title: string;
  kind: RulebookKind;
  chapter: string;
  numeral: string;
  // The heading the passage sits under, and its anchor on the page. Absent
  // when the passage is the page's opening text.
  heading?: string;
  at?: string;
  snippet: string;
  score: number;
};

export type SearchResponse = { hits: SearchHit[]; terms: string[] };
