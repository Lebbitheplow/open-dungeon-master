import { stripReasoningArtifacts } from "../story-prompt.ts";
import { normalizeCandidate, type FactCandidate } from "./fact-logic.ts";

// Pure chapter-close decisions, kept free of alias imports so node test
// scripts (scripts/test-chapters.mjs) can load them directly.

// Chapters are paced by the STORY, not by message volume: a chapter closes
// once the DM has reported enough finished story-arc beats (complete_beat),
// beatsRequired of them, so each chapter reads as a real episode rather
// than a single scene. The message counts are only guardrails around that
// signal - a floor so beats finished in three exchanges do not produce a
// stub chapter, and a hard cap so a campaign whose model never calls the
// tool (or that has no arc at all) still gets chapters. A party that spends
// twenty messages searching one room completes no beat and therefore stays
// in the same chapter.
//
// The arcExhausted clause closes promptly on a finished act even when the
// beat count is short: the next act (or sequel saga) is only planned at
// chapter close, so an exhausted arc coasting toward the cap would leave
// the DM steering by nothing. It applies even at zero completed beats,
// because a chapter can OPEN with an exhausted arc (the planning pass
// failed at the previous close) and closing again is precisely the retry.
export function shouldCloseChapter(
  messageCount: number,
  beatsCompleted: number,
  arcExhausted: boolean,
  options: { min: number; max: number; beatsRequired: number },
): boolean {
  if (messageCount >= options.max) {
    return true;
  }
  if (messageCount < options.min) {
    return false;
  }
  if (arcExhausted) {
    return true;
  }
  return beatsCompleted >= options.beatsRequired;
}

// Parse the model's chapter JSON with a never-wedge fallback: any failure
// still yields a usable title so the campaign is never stuck mid-close.
// The facts array is a later addition; legacy output without it (and models
// that drop it) parse exactly as before with facts: [].
export function parseChapterJson(
  raw: string,
  chapterIndex: number,
): { title: string; summary: string; highlights: string[]; facts: FactCandidate[] } {
  const fallback = {
    title: `Chapter ${chapterIndex}`,
    summary: "",
    highlights: [] as string[],
    facts: [] as FactCandidate[],
  };
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
      facts?: unknown;
    };
    const title = String(parsed.title ?? "").trim().slice(0, 80);
    const summary = String(parsed.summary ?? "").trim();
    const highlights = Array.isArray(parsed.highlights)
      ? parsed.highlights.map((entry) => String(entry).trim()).filter(Boolean).slice(0, 6)
      : [];
    const facts = Array.isArray(parsed.facts)
      ? parsed.facts
          .map((entry) => normalizeCandidate((entry ?? {}) as Record<string, unknown>))
          .filter((entry): entry is FactCandidate => entry !== null)
          .slice(0, 8)
      : [];
    return { title: title || fallback.title, summary, highlights, facts };
  } catch {
    return fallback;
  }
}
