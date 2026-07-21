import { stripReasoningArtifacts } from "../story-prompt.ts";

// Pure chapter-close decisions, kept free of alias imports so node test
// scripts (scripts/test-chapters.mjs) can load them directly.

// Chapters are paced by the STORY, not by message volume: a chapter closes
// when the DM reports a finished story-arc beat (complete_beat). The
// message counts are only guardrails around that signal - a floor so a beat
// finished in three exchanges does not produce a stub chapter, and a hard
// cap so a campaign whose model never calls the tool (or that has no arc at
// all) still gets chapters. A party that spends twenty messages searching
// one room completes no beat and therefore stays in the same chapter.
export function shouldCloseChapter(
  messageCount: number,
  beatCompleted: boolean,
  options: { min: number; max: number },
): boolean {
  if (messageCount >= options.max) {
    return true;
  }
  return beatCompleted && messageCount >= options.min;
}

// Parse the model's chapter JSON with a never-wedge fallback: any failure
// still yields a usable title so the campaign is never stuck mid-close.
export function parseChapterJson(
  raw: string,
  chapterIndex: number,
): { title: string; summary: string; highlights: string[] } {
  const fallback = { title: `Chapter ${chapterIndex}`, summary: "", highlights: [] as string[] };
  const cleaned = stripReasoningArtifacts(raw || "")
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) {
    return fallback;
  }
  try {
    const parsed = JSON.parse(cleaned.slice(start, end + 1)) as {
      title?: unknown;
      summary?: unknown;
      highlights?: unknown;
    };
    const title = String(parsed.title ?? "").trim().slice(0, 80);
    const summary = String(parsed.summary ?? "").trim();
    const highlights = Array.isArray(parsed.highlights)
      ? parsed.highlights.map((entry) => String(entry).trim()).filter(Boolean).slice(0, 6)
      : [];
    return { title: title || fallback.title, summary, highlights };
  } catch {
    return fallback;
  }
}
