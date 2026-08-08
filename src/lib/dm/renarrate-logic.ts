// Pure logic for narration rerolls: the party lead asks the DM to say the
// same thing differently. A reroll re-runs ONLY the final narration call of a
// finished turn against that turn's stored conversation, so nothing
// mechanical can move: no tools, no dice, no sheet or encounter mutation.
// Everything here is dependency-free so scripts/test-renarrate.mjs can import
// it directly.

// The structural floor ChatMessage (src/lib/model-client.ts) satisfies; the
// helpers below stay generic over it so the rim can hand them real
// ChatMessages and get real ChatMessages back, without this file importing an
// "@/" alias.
export type RenarrateMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: unknown;
  tool_calls?: unknown;
  tool_call_id?: string;
};

// Five total (the original plus four rerolls) matches NE-P's swipe cap and
// keeps variants_json small enough to ride an SSE payload comfortably.
export const MAX_VARIANTS = 5;

// A guidance line is a nudge, not a second prompt; anything longer starts
// competing with the campaign's own system prompt for the model's attention.
export const MAX_GUIDANCE_LENGTH = 200;

// Duplicated from finalize() in src/lib/dm/turn.ts rather than imported: this
// module stays alias-free. If that fallback line changes, change it here too.
export const EMPTY_NARRATION_FALLBACK =
  "The moment hangs there, waiting on the party's next move.";

// Sent as a trailing "[System]" user message, matching how turn.ts nudges the
// model mid-conversation. It is emphatic about the mechanical state because
// the model is looking at a full tool history and would otherwise happily
// call a tool or re-resolve a roll it can see in front of it.
export const RENARRATE_DIRECTIVE =
  "[System] Narrate this moment again, in different words. Every mechanical fact stays exactly as it already is: the same events, the same dice results, the same damage, the same positions, the same decisions. Do not call any tool, do not ask for a roll, and do not carry the scene any further than it already went. Only the prose changes.";

export function clampGuidance(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().slice(0, MAX_GUIDANCE_LENGTH);
}

// The stored conversation is the prompt the final narration call ran on: the
// tool loop breaks without echoing its last assistant reply. Popping any
// trailing assistant turn anyway makes the reroll idempotent for the shapes
// that do echo one (the spotlight follow-up), so the model is always being
// asked to write the narration rather than to comment on it. Only trailing
// assistant messages are dropped, so no tool result is ever orphaned.
export function stripTrailingNarration<T extends RenarrateMessage>(conversation: T[]): T[] {
  let end = conversation.length;
  while (end > 0 && conversation[end - 1].role === "assistant") {
    end -= 1;
  }
  return conversation.slice(0, end);
}

// `previousTake` is the prose currently on screen, replayed as the assistant
// turn the directive then asks the model to redo. The tool loop breaks
// without echoing its closing narration, so without this the model would be
// told to "narrate it again" having never seen what it wrote, and could
// answer with a meta line or drift into different events.
export function buildRenarrateMessages<T extends RenarrateMessage>(
  conversation: T[],
  guidance: string,
  previousTake: string,
): Array<T | { role: "assistant" | "user"; content: string }> {
  const clamped = clampGuidance(guidance);
  const previous = previousTake.trim();
  return [
    ...stripTrailingNarration(conversation),
    ...(previous ? [{ role: "assistant" as const, content: previous }] : []),
    {
      role: "user" as const,
      content: clamped
        ? `${RENARRATE_DIRECTIVE}\nThe party lead asked for this pass: ${clamped}`
        : RENARRATE_DIRECTIVE,
    },
  ];
}

// A turn can narrate across several model calls; only the last one is being
// rerolled, so the earlier segments (which the model still sees as assistant
// turns in the stored conversation) stay untouched.
export function replaceFinalNarration(narrationParts: string[], narration: string): string[] {
  const trimmed = narration.trim();
  if (!trimmed) {
    return narrationParts;
  }
  if (!narrationParts.length) {
    return [trimmed];
  }
  return [...narrationParts.slice(0, -1), trimmed];
}

// Byte-for-byte the assembly finalize() performs in src/lib/dm/turn.ts, so a
// variant's "[roll:<id>]" markers land in exactly the same place as the
// original's and the chat keeps rendering the same dice cards inline.
export function assembleVariantContent(
  narrationParts: string[],
  rollIds: string[],
  narration: string,
): string {
  const parts = replaceFinalNarration(narrationParts, narration);
  let content = parts.join("\n\n").trim();
  if (!content) {
    content = EMPTY_NARRATION_FALLBACK;
  }
  if (rollIds.length && parts.length > 1) {
    const lastPart = parts[parts.length - 1];
    const earlier = parts.slice(0, -1).join("\n\n");
    content = `${earlier}\n\n${rollIds.map((id) => `[roll:${id}]`).join("\n")}\n\n${lastPart}`;
  } else if (rollIds.length) {
    content = `${rollIds.map((id) => `[roll:${id}]`).join("\n")}\n\n${content}`;
  }
  return content;
}

// The inverse of assembleVariantContent: recovers just the final narration
// segment from a stored variant, since everything ahead of it (earlier
// segments, the roll markers) is fixed by the turn. Falls back to the whole
// content for messages assembled some other way (a lore-check rewrite).
export function extractFinalTake(
  narrationParts: string[],
  rollIds: string[],
  content: string,
): string {
  const earlier = narrationParts.slice(0, -1);
  const markers = rollIds.length
    ? `${rollIds.map((id) => `[roll:${id}]`).join("\n")}\n\n`
    : "";
  const prefix = earlier.length ? `${earlier.join("\n\n")}\n\n${markers}` : markers;
  return prefix && content.startsWith(prefix) ? content.slice(prefix.length) : content;
}

// Variant 0 is always the prose the table already read, so selecting back to
// it restores the message exactly as it was published.
export function seedVariants(variants: string[], content: string): string[] {
  return variants.length ? variants : [content];
}

export type AppendedVariants = {
  variants: string[];
  index: number;
  capped: boolean;
};

export function appendVariant(variants: string[], next: string): AppendedVariants {
  if (variants.length >= MAX_VARIANTS) {
    return { variants, index: variants.length - 1, capped: true };
  }
  const appended = [...variants, next];
  return { variants: appended, index: appended.length - 1, capped: false };
}

// -1 for anything out of range; the route turns that into a 400 rather than
// silently clamping, so a stale client cannot quietly select the wrong prose.
export function resolveVariantIndex(variants: string[], index: number): number {
  if (!Number.isInteger(index) || index < 0 || index >= variants.length) {
    return -1;
  }
  return index;
}
