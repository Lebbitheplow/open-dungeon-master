// Level-of-detail rendering for sealed chapters, ported from
// NarrativeEngine-P's lodRenderer (src/services/payload/lodRenderer.ts, MIT,
// Copyright (c) 2026 Sagesheep).
//
// The problem it solves: by chapter 40 a flat list of chapter summaries is
// either a wall of stale text eating the budget, or an arbitrary truncation
// that drops the chapter where the party's patron betrayed them. LOD renders
// recent and important chapters at full summary and everything else at a
// one-line synopsis, then degrades under budget pressure by tiering down
// before dropping anything.
//
// Two properties are load-bearing and both come from NE-P:
//
// 1. There is no chapter-level "full" tier. The verbatim transcript IS the
//    full tier and it is owned by the history budget; chapters only ever
//    render as summary or synopsis. Adding a third tier here would duplicate
//    what history already carries.
// 2. Output is byte-identical for identical inputs. No Date, no random, no
//    dependence on object key order, so the rendered block can sit in a
//    model's cached prompt prefix and actually hit.
//
// Dependency-free so scripts/test-chapter-lod.mjs can import it directly.

export type LodTier = "summary" | "synopsis" | "dropped";

// A sealed chapter, reduced to what rendering needs. `importance` is the
// chapter's peak scene importance (src/lib/dm/importance-logic.ts scores
// scenes from hard signals: deaths, level-ups, crits, major loot). Absent
// means "not scored", which is treated as ordinary rather than important.
export type LodChapter = {
  id: string;
  index: number;
  title: string;
  summary: string;
  importance?: number;
};

export type LodConfig = {
  // How many of the most recent chapters (by effective age) render in full.
  summaryChapters: number;
  // Subtracted from position-from-end when the chapter contains a scene at or
  // above IMPORTANCE_THRESHOLD, which is what lets an old but pivotal chapter
  // outrank a recent but forgettable one.
  importanceBonus: number;
};

// NE-P's defaults. Seven is generous enough that a normal session never
// notices the tiering, and the bonus of two means a pivotal chapter stays in
// full detail about two chapters longer than it otherwise would.
export const DEFAULT_LOD_CONFIG: LodConfig = { summaryChapters: 7, importanceBonus: 2 };

// NE-P's cutoff for "this scene mattered".
export const IMPORTANCE_THRESHOLD = 8;

export function estimateLodTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// First sentence of the summary, falling back to the title. Deliberately
// simple: the synopsis tier exists to say "this happened, here is the shape
// of it", not to re-summarize.
export function firstSentence(summary: string): string {
  const trimmed = summary?.trim() ?? "";
  if (!trimmed) {
    return "";
  }
  const match = trimmed.match(/^[^.!?]*[.!?]?/);
  const sentence = match ? match[0].trim() : trimmed;
  return sentence || trimmed;
}

function renderSummary(chapter: LodChapter): string {
  return `Chapter ${chapter.index} - ${chapter.title}\n${chapter.summary.trim()}`;
}

function renderSynopsis(chapter: LodChapter): string {
  const body = firstSentence(chapter.summary) || chapter.title;
  return `Chapter ${chapter.index} - ${chapter.title}\n${body}`;
}

// Effective age: position from the newest end, pulled forward when the
// chapter contains a high-importance scene. Lower is "newer" for tier
// selection. Purely positional, which is what keeps it robust to ODM closing
// chapters on story progress rather than on a scene count: chapters vary a
// lot in length here, and a rule based on scene counts would misbehave.
export function effectiveAge(
  chapter: LodChapter,
  orderedOldestFirst: LodChapter[],
  importanceBonus: number,
): number {
  const position = orderedOldestFirst.findIndex((entry) => entry.id === chapter.id);
  const positionFromEnd = orderedOldestFirst.length - 1 - position;
  const important = (chapter.importance ?? 0) >= IMPORTANCE_THRESHOLD;
  return positionFromEnd - (important ? importanceBonus : 0);
}

export type LodResult = {
  text: string;
  tokens: number;
  tierById: Record<string, LodTier>;
};

export function renderChapterLod(
  chapters: LodChapter[],
  budgetTokens: number,
  config: LodConfig = DEFAULT_LOD_CONFIG,
): LodResult {
  // Oldest first, by chapter index, with a stable tie-break so two chapters
  // sharing an index cannot reorder between runs.
  const ordered = chapters
    .slice()
    .sort((a, b) => (a.index !== b.index ? a.index - b.index : a.id.localeCompare(b.id)));

  const tierById: Record<string, LodTier> = {};
  if (!ordered.length) {
    return { text: "", tokens: 0, tierById };
  }

  const ages = new Map<string, number>();
  for (const chapter of ordered) {
    ages.set(chapter.id, effectiveAge(chapter, ordered, config.importanceBonus));
  }
  // Newest (lowest effective age) first, tie-broken by id for determinism.
  const byAge = ordered.slice().sort((a, b) => {
    const diff = (ages.get(a.id) ?? 0) - (ages.get(b.id) ?? 0);
    return diff !== 0 ? diff : a.id.localeCompare(b.id);
  });
  const summarySet = new Set(
    byAge.slice(0, Math.max(0, config.summaryChapters)).map((chapter) => chapter.id),
  );
  for (const chapter of ordered) {
    tierById[chapter.id] = summarySet.has(chapter.id) ? "summary" : "synopsis";
  }

  const renderOne = (chapter: LodChapter) =>
    tierById[chapter.id] === "summary" ? renderSummary(chapter) : renderSynopsis(chapter);
  const rebuild = () =>
    ordered
      .filter((chapter) => tierById[chapter.id] !== "dropped")
      .map(renderOne)
      .join("\n\n");

  let text = rebuild();
  let tokens = estimateLodTokens(text);

  // Cascade one: demote the oldest full summaries to synopsis. Tiering down
  // costs detail; dropping costs the event entirely, so every summary is
  // demoted before anything is dropped.
  for (let index = 0; index < ordered.length && tokens > budgetTokens; index += 1) {
    if (tierById[ordered[index].id] === "summary") {
      tierById[ordered[index].id] = "synopsis";
      text = rebuild();
      tokens = estimateLodTokens(text);
    }
  }

  // Cascade two: drop the oldest synopses. Oldest-first because the recent
  // past is what the next turn is most likely to need.
  for (let index = 0; index < ordered.length && tokens > budgetTokens; index += 1) {
    if (tierById[ordered[index].id] === "synopsis") {
      tierById[ordered[index].id] = "dropped";
      text = rebuild();
      tokens = estimateLodTokens(text);
    }
  }

  return { text, tokens, tierById };
}
