// Pure Ask helpers, kept free of alias imports so node test scripts
// (scripts/test-ask.mjs) can load it directly.
//
// Ask lets a player put a question to the DM without spending a turn on it:
// "who was the woman at the shrine three chapters back?", "does my ranger
// read Draconic?", "how does grappling work?". Before this the only options
// were a `do` that derailed the scene or an `ooc` the DM never answers.

import { textKey } from "../language/text-logic.ts";

export const ASK_SCOPES = ["story", "rules", "sheet"] as const;
export type AskScope = (typeof ASK_SCOPES)[number];

export const ASK_VISIBILITIES = ["private", "table"] as const;
export type AskVisibility = (typeof ASK_VISIBILITIES)[number];

// The longest question, counted once its whitespace is folded (as it is
// stored). It was 500, which turned away a question carrying the scene it
// was about with only "Invalid question." (issue 207). 2,000 is the action
// box's own limit: a question may hold as much context as a move does. The
// thread hands each earlier question back whole (ask.ts threadMessages).
export const QUESTION_MAX_CHARS = 2_000;

// A question's length as the route counts it.
export function questionLength(question: string): number {
  return question.replace(/\s+/g, " ").trim().length;
}

// Why a question cannot be asked as typed, or null. The route answers with
// this sentence and the Ask box shows the same limit before it is sent.
export function questionProblem(question: string): string | null {
  const length = questionLength(question);
  if (!length) {
    return "Ask a question first.";
  }
  if (length > QUESTION_MAX_CHARS) {
    return `Questions can be up to ${QUESTION_MAX_CHARS.toLocaleString("en-US")} characters; this one has ${length.toLocaleString("en-US")}. Shorten it and ask again.`;
  }
  return null;
}

export type AskCitation = {
  kind: string;
  ref: string;
  quote: string;
};

export type AskResult = {
  answer: string;
  citations: AskCitation[];
  // What the answer drew on (filedScope).
  scope: AskScope;
};

export function isAskScope(value: unknown): value is AskScope {
  return ASK_SCOPES.includes(value as AskScope);
}

// The scope an ask is filed under: the one asked for, or for "auto" the one
// the answer names, else the story's, which gathers the most evidence. The
// label only files the ask, so an answer that names none is still kept.
export function filedScope(asked: AskScope | "auto", named?: unknown): AskScope {
  if (asked !== "auto") {
    return asked;
  }
  return isAskScope(named) ? named : "story";
}

export function clampQuestion(question: string): string {
  return question.replace(/\s+/g, " ").trim().slice(0, QUESTION_MAX_CHARS);
}

function asString(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

// Parses the model's JSON reply. Tolerates code fences and surrounding
// prose, because a small utility model will sometimes wrap its JSON.
export function parseAskJson(raw: string, asked: AskScope | "auto"): AskResult | null {
  const text = (raw ?? "").trim();
  if (!text) {
    return null;
  }
  const withoutFence = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();
  const start = withoutFence.indexOf("{");
  const end = withoutFence.lastIndexOf("}");
  if (start < 0 || end <= start) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(withoutFence.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") {
    return null;
  }
  const record = parsed as Record<string, unknown>;
  const answer = asString(record.answer, 4_000);
  if (!answer) {
    return null;
  }
  const rawCitations = Array.isArray(record.citations) ? record.citations : [];
  const citations: AskCitation[] = [];
  for (const entry of rawCitations.slice(0, 8)) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const citation = entry as Record<string, unknown>;
    const quote = asString(citation.quote, 400);
    if (!quote) {
      continue;
    }
    citations.push({
      kind: asString(citation.kind, 40) || "record",
      ref: asString(citation.ref, 120),
      quote,
    });
  }
  return { answer, citations, scope: filedScope(asked, record.scope) };
}

// ---- the latest transcript, as much of it as Ask can afford (issue 250) ----
//
// Ask used to hand its model the first 300 characters of each of the last 24
// messages. A detail the narration introduced late (the dog behind the rocks,
// after the hoofprints) was simply not in the record the model read, and the
// answer said it never happened. Now the newest message comes first and
// whole as far as the budget allows, older ones share what is left, and any
// message still too long keeps both its opening (who and where) and its end
// (what just happened), with the gap marked so the model can tell text Ask
// left out from events that never took place.

export type TranscriptLine = {
  seq: number;
  // Who spoke, as the table reads it ("DM", "Tavi", "Table note").
  who: string;
  content: string;
};

// The words that mark a gap Ask itself made. The system prompt names them.
export const OMITTED_MARK = "characters left out by Ask";

// A long text cut to `max` characters with its opening and its end kept:
// `head` characters of the start, the rest from the end, and a marker naming
// how much was skipped. Cuts land on word boundaries where one is near.
export function clipKeepingEnds(
  text: string,
  max: number,
  head = Math.round(max * 0.2),
  // What stands in the gap; a search query wants no words of its own there.
  gap: (skipped: number) => string = (skipped) => `[... ${skipped.toLocaleString("en-US")} ${OMITTED_MARK} ...]`,
): string {
  const clean = text.trim();
  if (clean.length <= max) {
    return clean;
  }
  const headLength = Math.max(0, Math.min(head, max));
  const tailLength = Math.max(0, max - headLength);
  let start = clean.slice(0, headLength);
  const lastSpace = start.lastIndexOf(" ");
  if (lastSpace > headLength * 0.6) {
    start = start.slice(0, lastSpace);
  }
  let end = clean.slice(clean.length - tailLength);
  const firstSpace = end.indexOf(" ");
  if (firstSpace >= 0 && firstSpace < tailLength * 0.2) {
    end = end.slice(firstSpace + 1);
  }
  const skipped = clean.length - start.length - end.length;
  return `${start.trimEnd()}${start ? " " : ""}${gap(skipped)} ${end.trimStart()}`.trim();
}

// The newest message's share of the budget: most of it, so the passage the
// player just read is there whole in all but the longest narration.
const NEWEST_SHARE = 0.45;
// No older message is cut below this (a line too short to say anything is
// dropped whole instead), nor given more than this.
const OLDER_MIN = 240;
const OLDER_MAX = 1_400;

// The recent transcript within `budget` characters, oldest first, each line
// "[recent:seq] who: text". The newest is allocated first; then each older
// message, newest to oldest, takes an even share of what is left until the
// budget runs out. The count of messages that did not fit is returned too,
// so the record can say there was more.
export function recentTranscript(
  lines: readonly TranscriptLine[],
  budget: number,
): { lines: string[]; dropped: number } {
  const out: string[] = [];
  let left = Math.max(0, Math.floor(budget));
  let dropped = 0;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    const label = `[recent:${line.seq}] ${line.who}: `;
    const room = left - label.length;
    const newest = index === lines.length - 1;
    const remainingCount = index + 1;
    const share = newest
      ? Math.max(Math.floor(budget * NEWEST_SHARE), Math.min(room, 1_500))
      : Math.min(OLDER_MAX, Math.max(OLDER_MIN, Math.floor(room / remainingCount)));
    const allowance = Math.min(room, share);
    if (allowance < Math.min(OLDER_MIN, line.content.trim().length)) {
      dropped = index + 1;
      break;
    }
    const text = clipKeepingEnds(line.content, allowance);
    out.unshift(`${label}${text}`);
    left -= label.length + text.length + 1;
  }
  return { lines: out, dropped };
}

// The passages of the transcript a search names: each message holding the
// query's words, as a window around the first one found, best first. The
// archive search finds sealed chapters and recorded scenes; the exchange in
// progress is in neither, so the search tool reads it here (issue 250).
export function transcriptPassages(
  lines: readonly TranscriptLine[],
  query: string,
  options: { limit?: number; window?: number } = {},
): string[] {
  const limit = options.limit ?? 3;
  const window = options.window ?? 700;
  const words = [...new Set(textKey(query).split(" "))].filter(
    (word) => word.length >= 3 && !STOP_WORDS.has(word),
  );
  if (!words.length) {
    return [];
  }
  const scored = lines
    .map((line) => {
      const lower = textKey(line.content);
      const hits = words.filter((word) => lower.includes(word));
      const first = hits.length ? Math.min(...hits.map((word) => lower.indexOf(word))) : -1;
      return { line, score: hits.length, first };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || b.line.seq - a.line.seq)
    .slice(0, limit);
  return scored.map(({ line, first }) => {
    const text = line.content.trim();
    if (text.length <= window) {
      return `[recent:${line.seq}] ${line.who}: ${text}`;
    }
    const start = Math.max(0, Math.min(first - Math.floor(window / 3), text.length - window));
    const passage = text.slice(start, start + window);
    return `[recent:${line.seq}] ${line.who}: ${start > 0 ? "... " : ""}${passage}${start + window < text.length ? " ..." : ""}`;
  });
}

const STOP_WORDS = new Set([
  "the", "and", "for", "are", "was", "were", "did", "does", "has", "have", "had", "with", "that", "this",
  "what", "who", "whom", "why", "how", "when", "where", "which", "they", "them", "their", "there", "then",
  "than", "you", "your", "our", "she", "her", "him", "his", "its", "not", "but", "any", "all", "can",
  "could", "would", "should", "will", "into", "from", "about", "just", "yet", "still", "been", "being",
]);
