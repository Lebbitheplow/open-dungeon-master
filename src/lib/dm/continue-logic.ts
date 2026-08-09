// Pure logic for continuing a scene: the party lead asks the DM to keep
// writing the narration it already published, extending it in place instead
// of replacing it or starting a new message.
//
// This is a sibling of renarrate-logic.ts and deliberately reuses its
// conversation and content assembly rather than restating it, so a continue
// and a reroll can never disagree about where "[roll:<id>]" markers go.
// Dependency-free so scripts/test-continue-scene.mjs can import it directly.

import {
  stripTrailingNarration,
  type RenarrateMessage,
} from "./renarrate-logic.ts";

// A continue is a nudge to keep going, not licence to write a second scene.
// The floor keeps a one-line ending from producing a one-line continuation;
// the cap keeps the model from running away with the story.
export const MIN_CONTINUE_WORDS = 60;
export const MAX_CONTINUE_WORDS = 320;

// Total length a message may reach through repeated continues. Well clear of
// any single narration, but bounded so a lead leaning on the button cannot
// grow one row past what the history budget can carry.
export const MAX_CONTINUED_LENGTH = 12_000;

export function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

// The last paragraph is the best available signal for the rhythm the DM was
// writing in, so the continuation is asked to match it rather than a fixed
// number that would feel abrupt after a long beat and bloated after a short
// one.
export function lastParagraphWordCount(text: string): number {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter(Boolean);
  const last = paragraphs.length ? paragraphs[paragraphs.length - 1] : text;
  return countWords(last);
}

export function targetContinueWords(text: string): number {
  const last = lastParagraphWordCount(text);
  return Math.min(MAX_CONTINUE_WORDS, Math.max(MIN_CONTINUE_WORDS, last));
}

export function buildContinueDirective(currentTake: string): string {
  const target = targetContinueWords(currentTake);
  return [
    "[System] Keep writing. Continue the narration you just gave from exactly where it stopped, in the same scene, the same moment, and the same voice.",
    `Write roughly ${target} more words.`,
    "Do not repeat, restate, or summarise anything you already wrote; the table has read it. Do not start over and do not open with a recap.",
    "Every mechanical fact stays as it is: the same dice results, the same damage, the same positions, the same decisions. Do not call any tool, do not ask for a roll, and do not resolve anything new. Do not end the scene, skip time, or move the party somewhere else.",
    "Write only the continuation itself, with no preamble.",
  ].join("\n\n");
}

// Same shape as buildRenarrateMessages: replay the prose currently on screen
// as the assistant turn, then ask for more. The tool loop breaks without
// echoing its closing narration, so without the replay the model would be
// told to "keep going" having never seen where it got to.
export function buildContinueMessages<T extends RenarrateMessage>(
  conversation: T[],
  currentTake: string,
): Array<T | { role: "assistant" | "user"; content: string }> {
  const previous = currentTake.trim();
  return [
    ...stripTrailingNarration(conversation),
    ...(previous ? [{ role: "assistant" as const, content: previous }] : []),
    { role: "user" as const, content: buildContinueDirective(currentTake) },
  ];
}

// Models often ignore "no preamble" and open with a bridging phrase that
// repeats the last line back. Strip a leading duplicate of the take's final
// sentence when one is present, so the seam does not stutter.
export function stripEchoedOpening(currentTake: string, continuation: string): string {
  const sentences = currentTake.trim().split(/(?<=[.!?])\s+/);
  const lastSentence = sentences.length ? sentences[sentences.length - 1].trim() : "";
  const next = continuation.trim();
  if (lastSentence.length > 24 && next.startsWith(lastSentence)) {
    return next.slice(lastSentence.length).trim();
  }
  return next;
}

export type MergeResult = { take: string; appended: boolean; reason?: string };

// Appends the continuation to the take with a paragraph break. Roll markers
// live outside the take (assembleVariantContent splices them around it), so
// nothing here can duplicate or disturb them.
export function mergeContinuation(currentTake: string, continuation: string): MergeResult {
  const addition = stripEchoedOpening(currentTake, continuation);
  if (!addition) {
    return { take: currentTake, appended: false, reason: "The DM added nothing new." };
  }
  const merged = `${currentTake.trim()}\n\n${addition}`;
  if (merged.length > MAX_CONTINUED_LENGTH) {
    return {
      take: currentTake,
      appended: false,
      reason: "This narration is already as long as it can get.",
    };
  }
  return { take: merged, appended: true };
}

// A continue extends the take the table is currently reading and leaves the
// other takes alone, so the reroll invariant (content === variants[index])
// still holds afterward and the lead can still browse back to an earlier
// wording. Clearing the set instead would silently throw those away.
export function replaceSelectedVariant(
  variants: string[],
  index: number,
  content: string,
): string[] {
  if (index < 0 || index >= variants.length) {
    return variants;
  }
  return variants.map((variant, position) => (position === index ? content : variant));
}
