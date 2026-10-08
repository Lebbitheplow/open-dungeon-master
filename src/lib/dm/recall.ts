import type { Campaign } from "@/lib/db/campaigns";
import { listChapters } from "@/lib/db/chapters";
import { scoreChaptersByKeywords } from "@/lib/dm/recall-logic";
import { searchScenes } from "@/lib/dm/memory-index";
import { fitChaptersToBudget } from "@/lib/dm/chapter-lod";
import { computeBudgets } from "@/lib/dm/context-budget";
import { storyContextTokens } from "@/lib/model-client";

// recall_story: the DM's long-term memory tool. A chapter number returns
// that chapter's full summary. A query runs two-phase semantic recall
// (memory-index.ts): matching chapters by summary embedding, then the most
// relevant VERBATIM transcript scenes from inside them, so a detail from
// fifty chapters ago comes back in the original words. Keyword scoring
// remains the fallback for unindexed campaigns or an unavailable embedder.
//
// A query answers with the scenes and points at their chapters without
// their summaries: the prompt's story-so-far block already carries those
// (src/lib/dm/prompt.ts), and a whole chapter is one call away by number.
// Every summary this tool does return is fitted into the same chapter budget
// that block gets.

export async function handleRecallStory(
  campaign: Campaign,
  rawArguments: string,
): Promise<Record<string, unknown>> {
  let args: { chapter?: unknown; query?: unknown };
  try {
    args = JSON.parse(rawArguments || "{}");
  } catch {
    return { error: "Invalid arguments." };
  }
  const closed = listChapters(campaign.id).filter((chapter) => chapter.status === "closed");
  if (!closed.length) {
    return { error: "No closed chapters yet; the story is still in its first chapter." };
  }
  const budget = computeBudgets(storyContextTokens(campaign.settings)).chapters;
  const fitted = (chapters: typeof closed) =>
    fitChaptersToBudget(chapters, budget).map(({ index, title, summary, highlights, shortened }) => ({
      chapter: index,
      title,
      summary,
      highlights,
      ...(shortened ? { shortened: true } : {}),
    }));
  const shortenedNote =
    "A chapter marked shortened did not fit this table's context window whole: its summary is cut to the first sentence.";
  const requested = Number(args.chapter);
  if (Number.isInteger(requested) && requested > 0) {
    const match = closed.find((chapter) => chapter.index === requested);
    if (match) {
      const [chapter] = fitted([match]);
      // A budget too small even for the first sentence still names it.
      return chapter
        ? { ...chapter, ...(chapter.shortened ? { note: shortenedNote } : {}) }
        : { chapter: match.index, title: match.title, shortened: true, note: shortenedNote };
    }
    return {
      error: `No closed chapter ${requested}.`,
      availableChapters: closed.map((chapter) => `${chapter.index}. ${chapter.title}`),
    };
  }
  const query = String(args.query ?? "").trim();
  if (!query) {
    return {
      error: "Give a chapter number or a query.",
      availableChapters: closed.map((chapter) => `${chapter.index}. ${chapter.title}`),
    };
  }

  // Phase 1+2: semantic scenes; never let an embedder failure break recall.
  let scenes: Awaited<ReturnType<typeof searchScenes>> = [];
  try {
    scenes = await searchScenes(campaign.id, query);
  } catch (error) {
    console.error("[recall] semantic search failed", error);
  }
  if (scenes.length) {
    const chapterIndexes = [...new Set(scenes.map((scene) => scene.chapterIndex))];
    const chapters = chapterIndexes
      .map((index) => closed.find((chapter) => chapter.index === index))
      .filter((chapter): chapter is (typeof closed)[number] => Boolean(chapter))
      .map((chapter) => ({ chapter: chapter.index, title: chapter.title }));
    return {
      chapters,
      scenes: scenes.map((scene) => ({
        chapter: scene.chapterIndex,
        transcript: scene.text,
        // Who was on screen, so an NPC is not made to remember a moment
        // they were absent for (src/lib/dm/witness-logic.ts).
        present: scene.witnesses,
      })),
      note: "The transcript excerpts are the actual past play, verbatim, nearest to your query first; some may not concern it. Stay strictly consistent with every one that does. 'present' lists the tracked NPCs who were there; anyone not listed has no on-screen reason to know what happened in that excerpt. To read a whole chapter, call recall_story with its chapter number.",
    };
  }

  const scored = scoreChaptersByKeywords(closed, query, campaign.gameSettings.tableLanguage);
  if (!scored.length) {
    return {
      error: "Nothing matched.",
      availableChapters: closed.map((chapter) => `${chapter.index}. ${chapter.title}`),
    };
  }
  const matches = fitted(scored.slice(0, 2));
  return { matches, ...(matches.some((chapter) => chapter.shortened) ? { note: shortenedNote } : {}) };
}
