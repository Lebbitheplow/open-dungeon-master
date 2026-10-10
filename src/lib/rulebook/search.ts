// Searching the rulebook. Every page is cut at its headings into passages
// (the same cut markdown.ts makes, so a hit's anchor is one the reader drew),
// and a query matches a passage when every word in it appears in the page
// title, the passage heading or the passage text. The last word may be half
// typed. Titles and headings outrank body text, so "grapple" lands on
// Grappling in Combat before the monsters that grapple.
//
// Words are compared by Snowball's English stem and stop list
// (src/lib/language): the rulebook is the English SRD at every table, so it
// is read in English whatever language the table plays in. Each hit carries
// the page's words that matched, which the reader marks as written: the
// browser never stems anything.
import { blockText, parseBook, stripInline, type BookBlock } from "./markdown";
import type { RulebookKind, RulebookPage, SearchHit } from "./types";
import { stemWord, stopWordsFor } from "../language/language";
import { compareNames, words as textWords } from "../language/text-logic";

export function stem(word: string): string {
  return stemWord(word.toLowerCase(), "english");
}

export function words(text: string): string[] {
  return textWords(text).map((word) => word.toLowerCase());
}

// The query as the stems it will be matched by, stop words dropped unless
// they are all there is.
export function queryTerms(query: string): string[] {
  const all = words(query);
  const stop = stopWordsFor("english");
  const kept = all.filter((word) => !stop.has(word));
  return [...new Set((kept.length ? kept : all).map(stem))];
}

type Passage = {
  page: RulebookPage;
  heading?: string;
  at?: string;
  text: string;
  lower: string;
  counts: Map<string, number>;
  headingStems: Set<string>;
};

type PageEntry = {
  page: RulebookPage;
  // Every word on the page, as written (lower case), with its stem: what a
  // hit hands the reader to mark.
  wordStems: Map<string, string>;
  titleStems: Set<string>;
  titleLower: string;
  passages: Passage[];
};

export type RulebookIndex = {
  pages: PageEntry[];
  chapters: Map<string, { numeral: string; title: string }>;
};

function countStems(text: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const word of words(text)) {
    const key = stem(word);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function passage(page: RulebookPage, heading: string | undefined, at: string | undefined, parts: string[]): Passage {
  const text = parts.filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  return {
    page,
    heading,
    at,
    text,
    lower: text.toLowerCase(),
    counts: countStems(`${heading ?? ""} ${text}`),
    headingStems: new Set(words(heading ?? "").map(stem)),
  };
}

// A page's passages: its opening text, then one per heading (and one per
// titled sidebar, which is where the SRD keeps rules like Combat Step by Step).
function passagesOf(page: RulebookPage, blocks: BookBlock[]): Passage[] {
  const out: Passage[] = [];
  let heading: string | undefined;
  let at: string | undefined;
  let parts: string[] = [];
  const close = () => {
    if (heading || parts.length) out.push(passage(page, heading, at, parts));
  };
  for (const block of blocks) {
    if (block.kind === "heading") {
      close();
      heading = stripInline(block.text);
      at = block.anchor;
      parts = [];
      continue;
    }
    if (block.kind === "sidebar" && block.title && block.anchor) {
      out.push(passage(page, stripInline(block.title), block.anchor, block.blocks.map(blockText)));
      continue;
    }
    parts.push(blockText(block));
  }
  close();
  return out;
}

export function buildIndex(
  pages: RulebookPage[],
  chapters: Array<{ id: string; numeral: string; title: string }>,
): RulebookIndex {
  return {
    pages: pages.map((page) => {
      const passages = passagesOf(page, parseBook(page.md));
      const wordStems = new Map<string, string>();
      for (const text of [page.title, ...passages.flatMap((item) => [item.heading ?? "", item.text])]) {
        for (const word of words(text)) {
          if (!wordStems.has(word)) wordStems.set(word, stem(word));
        }
      }
      return {
        page,
        wordStems,
        titleStems: new Set(words(page.title).map(stem)),
        titleLower: page.title.toLowerCase(),
        passages,
      };
    }),
    chapters: new Map(chapters.map((chapter) => [chapter.id, { numeral: chapter.numeral, title: chapter.title }])),
  };
}

// Rules text outranks an entry that merely mentions a word, all else equal.
const KIND_WEIGHT: Record<RulebookKind, number> = { rules: 14, class: 8, race: 8, spell: 4, item: 2, monster: 0 };

function hasTerm(stems: Map<string, number> | Set<string>, term: string, prefix: boolean): boolean {
  if (stems.has(term)) return true;
  if (!prefix || term.length < 2) return false;
  for (const key of stems.keys()) if (key.startsWith(term)) return true;
  return false;
}

function countTerm(counts: Map<string, number>, term: string, prefix: boolean): number {
  const exact = counts.get(term) ?? 0;
  if (exact || !prefix) return exact;
  let total = 0;
  for (const [key, count] of counts) if (key.startsWith(term)) total += count;
  return total;
}

// About 200 characters around the first matching word, cut at word edges.
export function snippetFor(text: string, terms: string[], width = 200): string {
  let first = -1;
  const pattern = /[a-z0-9]+(?:['’][a-z]+)?/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const key = stem(match[0]);
    if (terms.some((term) => key === term || key.startsWith(term))) {
      first = match.index;
      break;
    }
  }
  if (text.length <= width) return text;
  if (first < 0) first = 0;
  let start = Math.max(0, first - Math.floor(width / 3));
  if (start > 0) {
    const space = text.indexOf(" ", start);
    start = space === -1 ? start : space + 1;
  }
  let end = Math.min(text.length, start + width);
  if (end < text.length) {
    const space = text.lastIndexOf(" ", end);
    end = space > start ? space : end;
  }
  return `${start > 0 ? "… " : ""}${text.slice(start, end).trim()}${end < text.length ? " …" : ""}`;
}

export function searchRulebook(index: RulebookIndex, query: string, limit = 40): SearchHit[] {
  const terms = queryTerms(query);
  if (!terms.length) return [];
  const phrase = query.trim().toLowerCase();
  // The last word may still be being typed.
  const typed = /[a-z0-9]$/i.test(query.trim());
  const isPrefix = (position: number) => typed && position === terms.length - 1;
  const matching = (key: string) =>
    terms.some((term, position) => key === term || (isPrefix(position) && term.length >= 2 && key.startsWith(term)));
  const hits: SearchHit[] = [];

  for (const entry of index.pages) {
    const { page } = entry;
    const chapter = index.chapters.get(page.chapter);
    const pageHits: SearchHit[] = [];
    let marked: string[] | null = null;
    const pageWords = () => (marked ??= [...entry.wordStems].filter(([, key]) => matching(key)).map(([word]) => word));
    const titleAll = terms.every((term, position) => hasTerm(entry.titleStems, term, isPrefix(position)));
    entry.passages.forEach((item, passageIndex) => {
      const matches = terms.every(
        (term, position) =>
          hasTerm(entry.titleStems, term, isPrefix(position)) || hasTerm(item.counts, term, isPrefix(position)),
      );
      if (!matches) return;
      let score = KIND_WEIGHT[page.kind];
      const opening = passageIndex === 0 && !item.heading;
      if (opening || (passageIndex === 0 && titleAll)) {
        if (entry.titleLower === phrase) score += 1000;
        else if (titleAll) score += 220;
      }
      terms.forEach((term, position) => {
        if (hasTerm(entry.titleStems, term, isPrefix(position))) score += opening ? 40 : 6;
        if (hasTerm(item.headingStems, term, isPrefix(position))) score += 30;
        score += Math.min(countTerm(item.counts, term, isPrefix(position)), 6) * 2;
      });
      const headingLower = item.heading?.toLowerCase();
      if (headingLower === phrase) score += 600;
      else if (item.heading && terms.every((term, position) => hasTerm(item.headingStems, term, isPrefix(position)))) score += 160;
      if (phrase.length > 3 && item.lower.includes(phrase)) score += 40;
      pageHits.push({
        page: page.id,
        title: page.title,
        kind: page.kind,
        chapter: chapter?.title ?? "",
        numeral: chapter?.numeral ?? "",
        heading: item.heading,
        at: item.at,
        snippet: snippetFor(item.text, terms),
        words: pageWords(),
        score,
      });
    });
    pageHits.sort((a, b) => b.score - a.score);
    hits.push(...pageHits.slice(0, 3));
  }
  hits.sort((a, b) => b.score - a.score || compareNames(a.title, b.title));
  return hits.slice(0, limit);
}
