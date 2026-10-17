// The last step before any model call: does the whole request fit the
// window the model actually has? Messages, tool definitions and the framing a
// chat template adds are all counted, and the reply keeps the room it needs.
// What does not fit is fitted here, in a fixed order, or the call is refused
// with the numbers that say why, before the backend truncates the prompt in
// silence (docs/agent-context-efficiency-audit-2026-10-17.md F01, F04).
//
// The order, least loss first:
// 1. drop the oldest history lines (a summary or recall_story covers them);
// 2. clip the newest history line at its middle, keeping both ends, so a
//    long move keeps the question it ends on;
// 3. shrink the long fields of tool results older than the latest call (the
//    numbers stay, the prose around them is cut);
// 4. clip the longest message that is not the system prompt (utility work,
//    where one message carries the whole input).
// The system prompt is never cut: it holds the rules, the safety lines and
// the engine boundary, and a request that cannot carry them whole is refused.
//
// Dependency-free apart from pure helpers, so scripts/test-request-fit.mjs
// can drive it directly.

import { estimateTokens } from "./context-budget.ts";
import { clipKeepingEnds } from "./ask-logic.ts";

export type FitMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: unknown;
  tool_calls?: unknown;
  tool_call_id?: string;
  provider_items?: unknown;
};

// Role markers and separators a chat template wraps around each message,
// which the character count cannot see.
export const MESSAGE_FRAMING_TOKENS = 6;
// The template's own header and the tool section's preamble.
export const REQUEST_FRAMING_TOKENS = 64;
// The least a clipped history line keeps, in characters: under this a move
// says nothing usable.
const MIN_CLIPPED_LINE_CHARS = 1_200;
// A tool result's string fields past this are cut to their ends.
const TOOL_FIELD_MAX_CHARS = 400;
const TOOL_ARRAY_MAX_ITEMS = 12;

export function contentText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((part) => (part && typeof part === "object" && (part as { type?: string }).type === "text" ? String((part as { text?: unknown }).text ?? "") : ""))
      .join("\n\n");
  }
  return "";
}

// An image part costs the backend far more than its URL; a flat charge
// keeps a portrait from passing as a few hundred characters of base64.
const IMAGE_PART_TOKENS = 800;

function imageParts(content: unknown): number {
  return Array.isArray(content)
    ? content.filter((part) => part && typeof part === "object" && (part as { type?: string }).type === "image_url").length
    : 0;
}

export function messageTokens(message: FitMessage): number {
  return (
    estimateTokens(contentText(message.content)) +
    imageParts(message.content) * IMAGE_PART_TOKENS +
    (message.tool_calls ? estimateTokens(JSON.stringify(message.tool_calls)) : 0) +
    (message.provider_items ? estimateTokens(JSON.stringify(message.provider_items)) : 0) +
    MESSAGE_FRAMING_TOKENS
  );
}

export function toolDefinitionTokens(tools: readonly unknown[] | undefined): number {
  return tools?.length ? estimateTokens(JSON.stringify(tools)) : 0;
}

export function requestTokens(messages: readonly FitMessage[], tools?: readonly unknown[]): number {
  return messages.reduce((sum, message) => sum + messageTokens(message), 0) + toolDefinitionTokens(tools) + REQUEST_FRAMING_TOKENS;
}

export type FitOptions = {
  // The model's whole context window.
  windowTokens: number;
  tools?: readonly unknown[];
  // The least room the reply must keep; under this the call is refused.
  minOutputTokens: number;
  // The most the call asks for; the reply cap sent is the smaller of this
  // and what the window leaves.
  maxOutputTokens: number;
  // The transcript lines inside the messages, [start, end): the oldest may be
  // dropped, the newest is clipped instead. Absent for a request with no
  // transcript of its own (utility work).
  history?: { start: number; end: number };
  // Messages at or after this index are this call's own work (the turn's tool
  // calls and their results): never dropped, and only the results before the
  // latest call are shrunk.
  protectFrom?: number;
  // Above 1 when the backend has reported more tokens than the estimate
  // counted (src/lib/dm/token-calibration.ts); the estimate is scaled by it.
  calibration?: number;
};

export type FitReport = {
  promptTokens: number;
  // Transcript lines left out to fit.
  dropped: number;
  // Messages cut short to fit.
  clipped: number;
};

export type FitResult =
  | (FitReport & { ok: true; messages: FitMessage[]; outputTokens: number })
  | (FitReport & {
      ok: false;
      // As far as fitting got: what a caller sends when the window is only
      // an assumption (src/lib/dm/model.ts).
      messages: FitMessage[];
      needTokens: number;
      windowTokens: number;
      reason: string;
    });

function scaled(tokens: number, calibration: number): number {
  return Math.ceil(tokens * calibration);
}

// A tool result read by the model: the long strings cut to their ends, long
// lists to their first entries. Numbers, booleans and ids are untouched, so
// what the engine resolved is still exactly what the model reads.
export function shrinkToolResult(content: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return clipKeepingEnds(content, TOOL_FIELD_MAX_CHARS * 3, TOOL_FIELD_MAX_CHARS, gap);
  }
  const shrink = (value: unknown): unknown => {
    if (typeof value === "string") {
      return value.length > TOOL_FIELD_MAX_CHARS
        ? clipKeepingEnds(value, TOOL_FIELD_MAX_CHARS - GAP_MARKER_CHARS, Math.round(TOOL_FIELD_MAX_CHARS * 0.4), gap)
        : value;
    }
    if (Array.isArray(value)) {
      const kept = value.slice(0, TOOL_ARRAY_MAX_ITEMS).map(shrink);
      return value.length > TOOL_ARRAY_MAX_ITEMS ? [...kept, `(${value.length - TOOL_ARRAY_MAX_ITEMS} more left out to fit the window)`] : kept;
    }
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, field]) => [key, shrink(field)]));
    }
    return value;
  };
  return JSON.stringify(shrink(parsed));
}

const gap = (skipped: number) => `[... ${skipped.toLocaleString("en-US")} characters left out to fit the model's window ...]`;

function withContent(message: FitMessage, text: string): FitMessage {
  return { ...message, content: text };
}

// Clips a message's text so it costs at most `tokens`, keeping both ends;
// the head is the smaller part (what a line ends on is what it asks).
// Room for the gap marker clipKeepingEnds writes between the two ends.
const GAP_MARKER_CHARS = 90;

function clipTo(message: FitMessage, tokens: number, floorChars: number): FitMessage | null {
  const text = contentText(message.content);
  const chars = Math.max(floorChars, (tokens - MESSAGE_FRAMING_TOKENS) * 4 - GAP_MARKER_CHARS);
  if (chars >= text.length) {
    return null;
  }
  return withContent(message, clipKeepingEnds(text, chars, Math.round(chars * 0.3), gap));
}

export function fitRequest(input: readonly FitMessage[], options: FitOptions): FitResult {
  const calibration = Math.max(1, options.calibration ?? 1);
  const window = Math.max(0, Math.floor(options.windowTokens));
  // A call that asks for a short reply needs no more room than it asks for.
  const maxOutput = Math.max(0, Math.floor(options.maxOutputTokens));
  const minOutput = Math.min(maxOutput, Math.max(0, Math.floor(options.minOutputTokens)));
  const messages = [...input];
  let dropped = 0;
  let clipped = 0;
  const cost = () => scaled(requestTokens(messages, options.tools), calibration);
  const room = () => window - minOutput;
  const done = (): FitResult | null => {
    const promptTokens = cost();
    if (promptTokens > room()) {
      return null;
    }
    return { ok: true, messages, outputTokens: Math.min(maxOutput, window - promptTokens), promptTokens, dropped, clipped };
  };

  const early = done();
  if (early) {
    return early;
  }

  // 1. The oldest transcript lines, keeping the newest.
  if (options.history) {
    let end = Math.min(options.history.end, messages.length);
    const start = Math.max(1, options.history.start);
    while (end - start > 1 && cost() > room()) {
      // Drop a whole exchange unit: an assistant's tool calls go with their
      // results, so no call is ever left unanswered.
      let unit = 1;
      if (messages[start]?.tool_calls) {
        while (start + unit < end && messages[start + unit]?.role === "tool") unit += 1;
      }
      if (end - start - unit < 1) break;
      messages.splice(start, unit);
      end -= unit;
      dropped += unit;
    }
    const fitted = done();
    if (fitted) return fitted;
    // 2. The newest line itself, at its middle.
    const newest = end - 1;
    if (newest >= start && messages[newest]) {
      const over = cost() - room();
      const target = scaled(messageTokens(messages[newest]), calibration) - over;
      const cut = clipTo(messages[newest], Math.floor(target / calibration), MIN_CLIPPED_LINE_CHARS);
      if (cut) {
        messages[newest] = cut;
        clipped += 1;
      }
    }
    const afterClip = done();
    if (afterClip) return afterClip;
  }

  // 3. Tool results before the latest call: their long fields shrink.
  const protectFrom = options.protectFrom ?? messages.length;
  let lastCall = -1;
  for (let index = messages.length - 1; index >= protectFrom; index -= 1) {
    if (messages[index].role === "assistant" && messages[index].tool_calls) {
      lastCall = index;
      break;
    }
  }
  for (let index = protectFrom; index < messages.length && cost() > room(); index += 1) {
    if (lastCall >= 0 && index > lastCall) break;
    const message = messages[index];
    if (message.role !== "tool") continue;
    const text = contentText(message.content);
    const shrunk = shrinkToolResult(text);
    if (shrunk.length < text.length) {
      messages[index] = withContent(message, shrunk);
      clipped += 1;
    }
  }
  const afterTools = done();
  if (afterTools) return afterTools;

  // 4. Work with no transcript of its own: the longest message that is not
  // the system prompt, clipped at its middle.
  if (!options.history && options.protectFrom === undefined) {
    for (let pass = 0; pass < 4 && cost() > room(); pass += 1) {
      let longest = -1;
      for (let index = 0; index < messages.length; index += 1) {
        if (messages[index].role === "system") continue;
        if (longest < 0 || messageTokens(messages[index]) > messageTokens(messages[longest])) longest = index;
      }
      if (longest < 0) break;
      const over = cost() - room();
      const target = scaled(messageTokens(messages[longest]), calibration) - over;
      const cut = clipTo(messages[longest], Math.floor(target / calibration), 400);
      if (!cut) break;
      messages[longest] = cut;
      clipped += 1;
    }
    const afterLongest = done();
    if (afterLongest) return afterLongest;
  }

  const promptTokens = cost();
  const needTokens = promptTokens + minOutput;
  const tools = scaled(toolDefinitionTokens(options.tools), calibration);
  return {
    ok: false,
    messages,
    promptTokens,
    dropped,
    clipped,
    needTokens,
    windowTokens: window,
    reason:
      `The request needs about ${needTokens.toLocaleString("en-US")} tokens (` +
      `${(promptTokens - tools).toLocaleString("en-US")} of instructions and messages, ` +
      (tools ? `${tools.toLocaleString("en-US")} of tool definitions, ` : "") +
      `${minOutput.toLocaleString("en-US")} kept for the reply) and the model's window is ${window.toLocaleString("en-US")}.`,
  };
}

// How much of one request's start another shares, by the same estimate: the
// most a server's prompt cache could reuse from the previous turn (the
// context audit's F08). A diagnostic, never a sizing input.
export function sharedPrefixTokens(previous: readonly FitMessage[], current: readonly FitMessage[]): number {
  const flatten = (messages: readonly FitMessage[]) =>
    messages.map((message) => `${message.role}\u0000${contentText(message.content)}`).join("\u0001");
  const a = flatten(previous);
  const b = flatten(current);
  const limit = Math.min(a.length, b.length);
  let at = 0;
  while (at < limit && a.charCodeAt(at) === b.charCodeAt(at)) {
    at += 1;
  }
  return estimateTokens(b.slice(0, at));
}
