import { listChapters } from "@/lib/db/chapters";
import { scoreChaptersByKeywords } from "@/lib/dm/recall-logic";
import { searchScenes } from "@/lib/dm/memory-index";

// recall_story: the DM's long-term memory tool. A chapter number returns
// that chapter's full summary. A query runs two-phase semantic recall
// (memory-index.ts): matching chapters by summary embedding, then the most
// relevant VERBATIM transcript scenes from inside them, so a detail from
// fifty chapters ago comes back in the original words. Keyword scoring
// remains the fallback for unindexed campaigns or an unavailable embedder.

export async function handleRecallStory(
  campaignId: string,
  rawArguments: string,
): Promise<Record<string, unknown>> {
  let args: { chapter?: unknown; query?: unknown };
  try {
    args = JSON.parse(rawArguments || "{}");
  } catch {
    return { error: "Invalid arguments." };
  }
  const closed = listChapters(campaignId).filter((chapter) => chapter.status === "closed");
  if (!closed.length) {
    return { error: "No closed chapters yet; the story is still in its first chapter." };
  }
  const describe = (chapter: (typeof closed)[number]) => ({
    chapter: chapter.index,
    title: chapter.title,
    summary: chapter.summary,
    highlights: chapter.highlights,
  });
  const requested = Number(args.chapter);
  if (Number.isInteger(requested) && requested > 0) {
    const match = closed.find((chapter) => chapter.index === requested);
    return match
      ? describe(match)
      : {
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
    scenes = await searchScenes(campaignId, query);
  } catch (error) {
    console.error("[recall] semantic search failed", error);
  }
  if (scenes.length) {
    const chapterIndexes = [...new Set(scenes.map((scene) => scene.chapterIndex))];
    const matches = chapterIndexes
      .map((index) => closed.find((chapter) => chapter.index === index))
      .filter((chapter): chapter is (typeof closed)[number] => Boolean(chapter))
      .slice(0, 2)
      .map(describe);
    return {
      matches,
      scenes: scenes.map((scene) => ({
        chapter: scene.chapterIndex,
        transcript: scene.text,
      })),
      note: "The transcript excerpts are the actual past play, verbatim; stay strictly consistent with them.",
    };
  }

  const scored = scoreChaptersByKeywords(closed, query);
  if (!scored.length) {
    return {
      error: "Nothing matched.",
      availableChapters: closed.map((chapter) => `${chapter.index}. ${chapter.title}`),
    };
  }
  return { matches: scored.slice(0, 2).map(describe) };
}
