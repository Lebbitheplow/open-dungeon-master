// Pure recall scoring, kept free of alias imports so node test scripts can
// load it directly. Extracted from the old turn.ts recall handler; still
// the fallback path whenever the semantic index has nothing for a chapter.

export type RecallableChapter = {
  index: number;
  title: string;
  summary: string;
  highlights: string[];
};

// Term-overlap scoring over titles, summaries, and highlights: 1 point per
// matched term, +3 for the whole phrase. Zero-score chapters are dropped.
export function scoreChaptersByKeywords<T extends RecallableChapter>(
  chapters: T[],
  query: string,
): T[] {
  const lowered = query.trim().toLowerCase();
  const terms = lowered.split(/\s+/).filter((term) => term.length > 2);
  return chapters
    .map((chapter) => {
      const haystack =
        `${chapter.title} ${chapter.summary} ${chapter.highlights.join(" ")}`.toLowerCase();
      const score = terms.reduce(
        (sum, term) => sum + (haystack.includes(term) ? 1 : 0),
        haystack.includes(lowered) ? 3 : 0,
      );
      return { chapter, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.chapter);
}
