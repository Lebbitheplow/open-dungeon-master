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
};

export function isAskScope(value: unknown): value is AskScope {
  return ASK_SCOPES.includes(value as AskScope);
}

export function clampQuestion(question: string): string {
  return question.replace(/\s+/g, " ").trim().slice(0, QUESTION_MAX_CHARS);
}

// Rules questions are about the system; sheet questions are about the
// asker's own character; everything else is about the world and the story.
// Deliberately keyword-driven and cheap: this only picks which evidence to
// gather, and gathering slightly wrong evidence costs a worse answer, not a
// broken one.
const RULES_HINT =
  /\b(rule|rules|how do(es)?|mechanic|advantage|disadvantage|grapple|grappling|opportunity attack|concentration|save|saving throw|proficienc|initiative|condition|exhaustion|cover|stealth rules|resistance|attunement|short rest|long rest|spell slot|ritual|counterspell|difficulty class|\bdc\b|\bac\b)\b/i;
const SHEET_HINT =
  /\b(my|mine|i have|do i|can i|am i|my character|my sheet|my spells?|my inventory|my gold|my hp|my ac|my level|know how to|proficient|trained in)\b/i;

export function inferScope(question: string): AskScope {
  // Sheet wins over rules: "how does my Bardic Inspiration work" is best
  // answered from the character who actually has it.
  if (SHEET_HINT.test(question)) {
    return "sheet";
  }
  if (RULES_HINT.test(question)) {
    return "rules";
  }
  return "story";
}

// Whether a question is worth spending archive retrieval on. Recall hints
// or a proper noun mean there is probably something on the record to find;
// "how does grappling work" should never cost an embedding pass.
const RECALL_HINT =
  /\b(earlier|previous|previously|before|past|history|remember|recall|happened|ago|last time|back then|who|where|when|whose|lore|chapter|said|promised|owe)\b/i;
const QUESTION_WORDS = new Set([
  "what", "when", "where", "who", "why", "how", "can", "does", "do", "is",
  "are", "was", "were", "tell", "please", "should", "could", "would", "will",
  "may", "did", "the", "and", "but", "my", "our", "their", "his", "her",
]);

export function shouldSearchArchive(question: string, force = false): boolean {
  if (force) {
    return true;
  }
  if (RECALL_HINT.test(question)) {
    return true;
  }
  // A capitalized word that is not just the sentence opener suggests a name.
  return (question.match(/\b[A-Z][a-z]{2,}\b/g) ?? []).some(
    (word) => !QUESTION_WORDS.has(word.toLowerCase()),
  );
}

function asString(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

// Parses the model's JSON reply. Tolerates code fences and surrounding
// prose, because a small utility model will sometimes wrap its JSON.
export function parseAskJson(raw: string): AskResult | null {
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
  return { answer, citations };
}
