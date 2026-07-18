import { stripReasoningArtifacts } from "../story-prompt.ts";

// Pure chapter-close decisions, kept free of alias imports so node test
// scripts (scripts/test-chapters.mjs) can load them directly.

// Close at a natural scene break once past the minimum, or unconditionally
// at the hard cap so slow-burn campaigns still get chapters.
export function shouldCloseChapter(
  messageCount: number,
  movedParty: boolean,
  options: { min: number; max: number },
): boolean {
  if (messageCount >= options.max) {
    return true;
  }
  return movedParty && messageCount >= options.min;
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
