// How a closing chapter's play is fitted to the summarizer, and what stands
// in when no summary could be written
// (docs/agent-context-efficiency-audit-2026-10-17.md F05, F06).
//
// The summarizer used to see the last 24,000 characters of the chapter while
// the coverage mark moved past all of it, so the start of a long chapter was
// in no summary at all; and a summary that failed (or was switched off) still
// moved the mark and emptied the running summary, so the next turn lost the
// chapter. Now the play is cut into spans the utility model's window holds,
// the earlier spans are condensed first, and a close with no summary keeps
// the running summary and leaves the mark where it was.
//
// Pure, so scripts/test-chapter-memory.mjs can drive it.

import { clipLine, estimateTokens } from "./context-budget.ts";

// The most raw play the closing call reads at once, whatever the window: the
// same 24,000 characters the summarizer always read at the chapter's end.
export const FINAL_SPAN_TOKENS = 6_000;
// The least a span may be when the window is small, so a span is never a
// handful of lines that say nothing on their own.
export const MIN_SPAN_TOKENS = 1_500;
// At most this many earlier spans are condensed before the closing call;
// a longer chapter makes its spans larger instead (within the window).
export const MAX_CONDENSED_SPANS = 6;
// Room the summarizer's JSON needs: a 250-word summary, six highlights and
// up to eight facts.
export const CHAPTER_REPLY_TOKENS = 1_600;
export const SPAN_REPLY_TOKENS = 450;

// How much play one call may carry: the window less the instructions and
// context around it, the reply, and a margin for what the estimate misses.
export function transcriptBudgetTokens(windowTokens: number, fixedTokens: number, replyTokens: number): number {
  const margin = Math.max(256, Math.floor(windowTokens * 0.05));
  return Math.max(0, windowTokens - fixedTokens - replyTokens - margin);
}

// Lines grouped in order into spans of at most `maxTokens`; a single line
// longer than that is cut to it, both ends kept.
export function chunkLines(lines: readonly string[], maxTokens: number): string[][] {
  const spans: string[][] = [];
  let current: string[] = [];
  let tokens = 0;
  const limit = Math.max(1, maxTokens);
  for (const raw of lines) {
    const line = estimateTokens(raw) > limit ? clipLine(raw, limit * 4) : raw;
    const cost = estimateTokens(line) + 1;
    if (current.length && tokens + cost > limit) {
      spans.push(current);
      current = [];
      tokens = 0;
    }
    current.push(line);
    tokens += cost;
  }
  if (current.length) {
    spans.push(current);
  }
  return spans;
}

// The span size for a chapter of `totalTokens` play: the final span's size,
// grown so no more than MAX_CONDENSED_SPANS earlier spans need condensing,
// never past what one call can carry.
export function spanTokensFor(totalTokens: number, budgetTokens: number): number {
  const wanted = Math.max(FINAL_SPAN_TOKENS, Math.ceil(totalTokens / (MAX_CONDENSED_SPANS + 1)));
  return Math.max(MIN_SPAN_TOKENS, Math.min(wanted, budgetTokens));
}

// What a chapter keeps when no summary could be written: the running summary
// (which covers its start), the milestones the server recorded, and where
// play stood when it closed. Bounded; marked as written without the
// summarizer so nobody mistakes it for one.
export function extractiveChapterSummary(input: {
  running: string;
  milestones: readonly string[];
  lastNarration: string;
}): string {
  const parts: string[] = [];
  const running = input.running.trim();
  if (running) {
    parts.push(clipLine(running, 1_500));
  }
  if (input.milestones.length) {
    parts.push(`Recorded: ${input.milestones.slice(0, 8).join("; ")}`);
  }
  const last = input.lastNarration.trim();
  if (last) {
    parts.push(`Where it ended: ${clipLine(last, 500)}`);
  }
  return parts.length ? `${parts.join("\n\n")}\n\n(Kept from the record; the chapter summary could not be written.)` : "";
}
