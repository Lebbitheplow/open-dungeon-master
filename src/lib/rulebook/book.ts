// The rulebook on the server: the SRD 5.1 pages (srd-5.1.json, built by
// scripts/import-srd-rulebook.mjs), the contents, one page with its
// neighbours, and search. The book is read once per process and never
// changes while it runs; the search index is built on the first search.
import data from "./srd-5.1.json";
import { buildIndex, queryTerms, searchRulebook, type RulebookIndex } from "./search";
import type {
  ContentsChapter,
  QuickLink,
  RulebookContents,
  RulebookData,
  RulebookPage,
  RulebookPageResponse,
  SearchResponse,
} from "./types";

const book = data as RulebookData;

// The rules a table reaches for in the middle of a session. Every anchor is
// asserted to exist by scripts/test-rulebook.mjs.
export const QUICK_LINKS: QuickLink[] = [
  { label: "Conditions", page: "conditions" },
  { label: "Actions in combat", page: "combat", at: "actions-in-combat" },
  { label: "Opportunity attacks", page: "combat", at: "opportunity-attacks" },
  { label: "Grappling", page: "combat", at: "grappling" },
  { label: "Cover", page: "combat", at: "cover" },
  { label: "Death saves", page: "combat", at: "death-saving-throws" },
  { label: "Advantage", page: "using-ability-scores", at: "advantage-and-disadvantage" },
  { label: "Hiding", page: "using-ability-scores", at: "hiding" },
  { label: "Concentration", page: "spellcasting", at: "concentration" },
  { label: "Resting", page: "adventuring", at: "resting" },
  { label: "Exhaustion", page: "conditions", at: "exhaustion" },
  { label: "Travel pace", page: "adventuring", at: "travel-pace" },
];

const byId = new Map<string, { page: RulebookPage; index: number }>(
  book.pages.map((page, index) => [page.id, { page, index }]),
);
const chapterById = new Map(book.chapters.map((chapter) => [chapter.id, chapter]));

let contents: RulebookContents | null = null;
let index: RulebookIndex | null = null;

export function rulebookContents(): RulebookContents {
  if (contents) return contents;
  const chapters: ContentsChapter[] = book.chapters.map((chapter) => ({
    id: chapter.id,
    numeral: chapter.numeral,
    title: chapter.title,
    blurb: chapter.blurb,
    entries: chapter.pages.map((id) => {
      const { page, index: at } = byId.get(id)!;
      return {
        id: page.id,
        title: page.title,
        kind: page.kind,
        ...(page.meta ? { meta: page.meta } : {}),
        ...(page.group ? { group: page.group } : {}),
        ...(page.family ? { family: page.family } : {}),
        folio: at + 1,
      };
    }),
  }));
  contents = { source: book.source, chapters, quick: QUICK_LINKS, pageCount: book.pages.length };
  return contents;
}

export function rulebookPage(id: string): RulebookPageResponse | null {
  const found = byId.get(id);
  if (!found) return null;
  const { chapter: chapterId, ...page } = found.page;
  const chapter = chapterById.get(chapterId)!;
  const link = (at: number) => {
    const neighbour = book.pages[at];
    return neighbour ? { id: neighbour.id, title: neighbour.title } : null;
  };
  return {
    page: { ...page, folio: found.index + 1 },
    chapter: { id: chapter.id, numeral: chapter.numeral, title: chapter.title },
    prev: link(found.index - 1),
    next: link(found.index + 1),
  };
}

export function rulebookSearch(query: string, limit?: number): SearchResponse {
  index ??= buildIndex(book.pages, book.chapters);
  return { hits: searchRulebook(index, query, limit), terms: queryTerms(query) };
}

export function rulebookPages(): RulebookPage[] {
  return book.pages;
}
