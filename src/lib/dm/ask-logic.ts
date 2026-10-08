// Pure Ask helpers, kept free of alias imports so node test scripts
// (scripts/test-ask.mjs) can load it directly.
//
// Ask lets a player put a question to the DM without spending a turn on it:
// "who was the woman at the shrine three chapters back?", "does my ranger
// read Draconic?", "how does grappling work?". Before this the only options
// were a `do` that derailed the scene or an `ooc` the DM never answers.

export const ASK_SCOPES = ["story", "rules", "sheet"] as const;
export type AskScope = (typeof ASK_SCOPES)[number];

export const ASK_VISIBILITIES = ["private", "table"] as const;
export type AskVisibility = (typeof ASK_VISIBILITIES)[number];

export const QUESTION_MAX_CHARS = 500;

export type AskCitation = {
  kind: string;
  ref: string;
  quote: string;
};

export type AskResult = {
  answer: string;
  citations: AskCitation[];
  // What the answer drew on: the scope asked for, or, for "auto", the one
  // the model says it answered from. Nothing routes a question by its words,
  // which only ever worked in English.
  scope: AskScope;
};

export function isAskScope(value: unknown): value is AskScope {
  return ASK_SCOPES.includes(value as AskScope);
}

export function clampQuestion(question: string): string {
  return question.replace(/\s+/g, " ").trim().slice(0, QUESTION_MAX_CHARS);
}

function asString(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

// Parses the model's JSON reply. Tolerates code fences and surrounding
// prose, because a small utility model will sometimes wrap its JSON. An
// "auto" question needs the scope the reply names; without one the reply is
// unusable, like an answerless one.
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
  const scope = asked === "auto" ? record.scope : asked;
  if (!isAskScope(scope)) {
    return null;
  }
  return { answer, citations, scope };
}
