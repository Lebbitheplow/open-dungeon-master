// Pure recall scoring, kept free of alias imports so node test scripts can
// load it directly. Extracted from the old turn.ts recall handler; still
// the fallback path whenever the semantic index has nothing for a chapter.
import { computeIdf, lexicalScore } from "./fusion-logic.ts";

export type RecallableChapter = {
  index: number;
  title: string;
  summary: string;
  highlights: string[];
};

// Ranks chapters by IDF-weighted term overlap over titles, summaries, and
// highlights, dropping the ones that match nothing.
//
// This used to count raw term hits with a flat +3 for the whole phrase, which
// let a chapter win on common words alone. IDF is computed across the
// chapters being searched, so a term in every chapter counts for almost
// nothing and a name in one counts for a lot. Shares its implementation with
// the fused retrieval paths so there is a single notion of "lexically close".
export function scoreChaptersByKeywords<T extends RecallableChapter>(
  chapters: T[],
  query: string,
): T[] {
  if (!chapters.length || !query.trim()) {
    return [];
  }
  const documents = chapters.map(
    (chapter) => `${chapter.title} ${chapter.summary} ${chapter.highlights.join(" ")}`,
  );
  const idf = computeIdf(documents);
  return chapters
    .map((chapter, index) => ({
      chapter,
      score: lexicalScore(query, documents[index], idf),
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.chapter);
}
