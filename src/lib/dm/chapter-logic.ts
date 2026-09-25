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
// The arcExhausted clause closes promptly on an act this chapter finished
// even when the beat count is short: the next act (or sequel saga) is
// planned at chapter close, so an exhausted arc coasting toward the cap
// would leave the DM steering by nothing. It needs at least one beat from
// this chapter. A chapter that OPENS exhausted (the planning pass failed at
// the previous close) must not close again as its retry: that produced a
// string of eight-message stub chapters whenever the arc model was flaky
// (issue #31). chapter-close.ts plans the next act in place instead.
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
  if (arcExhausted && beatsCompleted >= 1) {
    return true;
  }
  return beatsCompleted >= options.beatsRequired;
}

// Whether a beat that just landed counts toward the chapter's quota. Two
// beats that land within `spacing` messages of each other are one moment of
// play ("reach the village", then "speak to its elder" in the next reply),
// and one moment is one chapter beat no matter how the arc was sliced. The
// arc itself still advances; only the chapter's count holds. A null
// distance means no beat has landed in this chapter yet.
export function beatCountsToward(
  messagesSinceLastBeat: number | null,
  spacing: number,
): boolean {
  return messagesSinceLastBeat === null || messagesSinceLastBeat >= spacing;
}

// Whether this turn spends the backstop beat judge (arc.ts
// judgeBeatCompleted). It never runs in the turn a beat was just reported:
// the tool has already moved [NOW] to the next beat, and asking the judge
// about that one against the same messages is how one arrival used to close
// a whole chapter. It also waits out the spacing after any beat, so the
// scene that landed the last beat can never be read as landing the next.
export function shouldJudgeBeat(input: {
  messageCount: number;
  beatsDone: number;
  beatCompletedThisTurn: boolean;
  messagesSinceLastBeat: number | null;
  messagesSinceLastJudge: number;
  options: { min: number; beatsRequired: number; judgeEvery: number; spacing: number };
}): boolean {
  const { options } = input;
  if (input.beatCompletedThisTurn || input.beatsDone >= options.beatsRequired) {
    return false;
  }
  if (input.messageCount < options.min) {
    return false;
  }
  if (input.messagesSinceLastBeat !== null && input.messagesSinceLastBeat < options.spacing) {
    return false;
  }
  return input.messagesSinceLastJudge >= options.judgeEvery;
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
