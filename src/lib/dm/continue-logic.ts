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

// NE-P's floor, and its reasoning is worth keeping verbatim: it "guards the
// death spiral where a short (or meta-junk) segment begets an even shorter
// target". Without it, one clipped ending makes every subsequent continue
// shorter than the last.
export const MIN_CONTINUE_WORDS = 120;

// NE-P targets a 70 to 100 percent band of the segment being extended rather
// than a single number, so the continuation reads as the same passage
// carrying on instead of a separate paragraph bolted on. There is
// deliberately no ceiling: the continuation should match what it extends.
export const CONTINUE_LOWER_RATIO = 0.7;

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

export type ContinueTarget = { lower: number; upper: number };

export function targetContinueWords(text: string): ContinueTarget {
  const last = lastParagraphWordCount(text);
  const upper = Math.max(MIN_CONTINUE_WORDS, last);
  const lower = Math.max(MIN_CONTINUE_WORDS, Math.round(last * CONTINUE_LOWER_RATIO));
  return { lower, upper };
}

// Adapted from NE-P's buildSceneContinueDirective
// (src/services/turn/sceneContinue.ts, MIT). Their comment says "do not
// rewrite, do not improve", and the instructions that look redundant are the
// ones earning their place: the anti-meta rule exists because a reply that
// ended with "what do you do?" otherwise gets continued as more meta, and the
// everything-except-the-player framing is what keeps a continue from stalling
// into scenery description.
//
// Two deliberate ODM divergences, both narrowing:
//   - No dice. NE-P allows up to three tool calls during a continue; ODM
//     treats a continue as prose-only, because a tool call here would resolve
//     mechanics outside any turn and outside the engine boundary contract.
//   - Party-wide phrasing. NE-P is single-player, so its PC line names one
//     character; ODM has a table, and the DM must not speak for any of them.
export function buildContinueDirective(currentTake: string): string {
  const { lower, upper } = targetContinueWords(currentTake);
  const lengthLine =
    lower >= upper
      ? `- Write roughly ${upper} words of new story.`
      : `- Write between ${lower} and ${upper} words of new story, comparable to the passage you are extending.`;
  return [
    "[SCENE CONTINUE - the party lead pressed Continue: they want MORE of the current scene. This is not a new turn and not a new scene.",
    "- Write the next passage of the story: new in-fiction narrative prose that moves the current beat forward.",
    "- Pick up exactly where your previous reply ended, same scene, same moment, mid-beat. Do not restart, re-describe, or summarize anything that already happened.",
    "- NEVER write meta commentary. Nothing about the story being paused or awaiting input; no \"your move\", \"your call\", or \"what do you do\" prompts. If your previous reply ended in meta text like that, ignore that ending entirely and resume the fiction from the last in-fiction moment.",
    "- Everyone and everything EXCEPT the player characters may act: NPCs speak and move, the environment shifts, tension builds. The moment keeps unfolding in real time.",
    "- Do not open a new scene, skip time, change location, or introduce new arrivals, random events, or encounters. Deepen and extend only what is already present in the scene.",
    "- Do not act, speak, or decide for any player character beyond what their player already committed to. End at the point where the party would next need to choose or respond, a story beat that invites a response, never an explicit prompt for input.",
    lengthLine,
    "- Do not initiate or invent dice rolls, and do not call any tool. Narrate only from results already in history: the same dice, the same damage, the same positions, the same decisions.",
    "- Reply with story prose only. Do not acknowledge, mention, or answer this instruction.]",
  ].join("\n");
}

// Same shape as buildRenarrateMessages: replay the prose currently on screen
// as the assistant turn, then ask for more. The tool loop breaks without
// echoing its closing narration, so without the replay the model would be
// told to "keep going" having never seen where it got to.
//
// The directive is a USER message, not a system one, and NE-P documents why:
// provider format converters hoist every system message into the top-level
// system block, which teleports a trailing system directive to the front of
// the payload. The model then sees the sequence ending user then assistant
// and re-answers the wrong message. A user-role directive survives every
// converter and ends the sequence on the natural "respond to this" turn.
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
