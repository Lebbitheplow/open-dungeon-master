// Pure world-fact logic, kept free of alias imports so node test scripts
// (scripts/test-facts.mjs) can load it directly.
//
// A fact is one past-tense sentence about the world with a category and a
// subject ("who or what it is about"). The subject is the dedup and
// supersede key: "Marla holds the vault key" and "Marla lost the vault key"
// are both subject "marla", so recording the second retires the first
// instead of letting the sheet contradict itself.

import { textKey } from "../language/text-logic.ts";

export const FACT_CATEGORIES = [
  "location",
  "npc",
  "promise",
  "world",
  "party",
  "lore",
] as const;
export type FactCategory = (typeof FACT_CATEGORIES)[number];

// Who may read a fact outside the DM prompt: the whole party, the DM prompt
// only, or an explicit list of campaign character ids. "storyteller" is a DM
// secret kept even from the lead who steers an AI table: the storyteller
// tier (src/lib/dm/viewer.ts), for what exists to be kept from the
// characters (#503's stored intents and pacts).
export type FactKnownBy = "party" | "dm" | "storyteller" | string[];

// The storyteller's own secret (src/lib/dm/viewer.ts): never the lead's.
export function isStorytellerFact(knownBy: unknown): knownBy is "storyteller" {
  return knownBy === "storyteller";
}

// A fact kept out of the players' views: a DM secret, or the storyteller's.
export function isSecretFact(knownBy: unknown): boolean {
  return knownBy === "dm" || isStorytellerFact(knownBy);
}

export type FactCandidate = {
  category: FactCategory;
  subject: string;
  fact: string;
};

// The slice of a stored fact the pure helpers need.
export type FactLike = {
  category: FactCategory;
  subject: string;
  fact: string;
  pinned: boolean;
  knownBy: FactKnownBy;
};

export const FACT_MAX_CHARS = 300;
export const SUBJECT_MAX_CHARS = 80;

export function isFactCategory(value: unknown): value is FactCategory {
  return FACT_CATEGORIES.includes(value as FactCategory);
}

export function normalizeSubject(subject: string): string {
  return textKey(subject).slice(0, SUBJECT_MAX_CHARS);
}

function contentTokens(text: string): Set<string> {
  return new Set(
    textKey(text)
      .split(" ")
      .filter((token) => token.length > 2),
  );
}

// Token-overlap similarity in [0, 1] over words longer than two characters.
export function factSimilarity(a: string, b: string): number {
  const tokensA = contentTokens(a);
  const tokensB = contentTokens(b);
  if (!tokensA.size || !tokensB.size) {
    return 0;
  }
  let shared = 0;
  for (const token of tokensA) {
    if (tokensB.has(token)) {
      shared += 1;
    }
  }
  return shared / Math.min(tokensA.size, tokensB.size);
}

const DUPLICATE_SIMILARITY = 0.7;

// Parses and bounds one raw extracted entry; null when unusable.
export function normalizeCandidate(entry: {
  category?: unknown;
  subject?: unknown;
  fact?: unknown;
}): FactCandidate | null {
  const category = String(entry.category ?? "").trim().toLowerCase();
  const fact = String(entry.fact ?? "").trim().slice(0, FACT_MAX_CHARS);
  if (!isFactCategory(category) || !fact) {
    return null;
  }
  return {
    category,
    subject: normalizeSubject(String(entry.subject ?? "")),
    fact,
  };
}

// Classifies a candidate against the campaign's active facts:
// - "duplicate": same category+subject saying the same thing; skip it.
// - "supersedes": same category+subject saying something new; retire the
//   old rows and insert.
// - "new": nothing on file about this subject.
export function classifyCandidate(
  candidate: FactCandidate,
  existing: Array<{ category: FactCategory; subject: string; fact: string }>,
): "duplicate" | "supersedes" | "new" {
  const subject = normalizeSubject(candidate.subject);
  let sawSubject = false;
  for (const fact of existing) {
    if (fact.category !== candidate.category) {
      continue;
    }
    const sameSubject = subject && normalizeSubject(fact.subject) === subject;
    if (sameSubject) {
      sawSubject = true;
    }
    // Subjectless facts still dedup on near-identical wording.
    if (
      (sameSubject || !subject) &&
      factSimilarity(candidate.fact, fact.fact) >= DUPLICATE_SIMILARITY
    ) {
      return "duplicate";
    }
  }
  return sawSubject ? "supersedes" : "new";
}

export const CATEGORY_LABELS: Record<FactCategory, string> = {
  location: "Places",
  npc: "People",
  promise: "Promises and debts",
  world: "World state",
  party: "The party",
  lore: "Lore and rules",
};

export const RENDER_CHAR_BUDGET = 2000;
export const PER_CATEGORY_CAP = 6;

// Renders the fact sheet for GAME STATE: pinned facts always survive, the
// rest fill per-category slots newest-first until the character budget runs
// out. DM-only facts come back as a separate block so the prompt can flag
// them as secret. Facts are assumed newest-first on input.
export function renderFactsForPrompt(facts: FactLike[]): {
  party: string;
  dmOnly: string;
} {
  const partyLines: string[] = [];
  const dmLines: string[] = [];
  let budget = RENDER_CHAR_BUDGET;
  const perCategory = new Map<string, number>();

  const push = (fact: FactLike) => {
    const line = `- [${CATEGORY_LABELS[fact.category]}] ${
      fact.subject ? `${fact.subject}: ` : ""
    }${fact.fact}`;
    if (!fact.pinned) {
      const used = perCategory.get(fact.category) ?? 0;
      if (used >= PER_CATEGORY_CAP || line.length > budget) {
        return;
      }
      perCategory.set(fact.category, used + 1);
      budget -= line.length;
    }
    if (isSecretFact(fact.knownBy)) {
      dmLines.push(line);
    } else {
      partyLines.push(line);
    }
  };

  for (const fact of facts.filter((fact) => fact.pinned)) {
    push(fact);
  }
  for (const fact of facts.filter((fact) => !fact.pinned)) {
    push(fact);
  }
  return { party: partyLines.join("\n"), dmOnly: dmLines.join("\n") };
}

// Serialization helpers for the known_by column.
export function parseKnownBy(raw: string): FactKnownBy {
  if (raw === "party" || raw === "dm" || raw === "storyteller") {
    return raw;
  }
  if (raw.startsWith("[")) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.map((id) => String(id)).filter(Boolean);
      }
    } catch {
      // fall through
    }
  }
  return "party";
}

export function serializeKnownBy(knownBy: FactKnownBy): string {
  return Array.isArray(knownBy) ? JSON.stringify(knownBy) : knownBy;
}

// Whether a member (with the given owned character ids) may read a fact.
// DM-only facts are spoilers (off-screen developments); they stay out of
// every player view unless the lead explicitly asks for secrets. A
// storyteller secret needs the storyteller tier on top (viewer.ts
// storytellerSees): never the lead's, at any table.
export function factVisibleTo(
  knownBy: FactKnownBy,
  ownedCharacterIds: string[],
  includeDmSecrets: boolean,
  includeStorytellerSecrets = false,
): boolean {
  if (knownBy === "party") {
    return true;
  }
  if (knownBy === "dm") {
    return includeDmSecrets;
  }
  if (isStorytellerFact(knownBy)) {
    return includeDmSecrets && includeStorytellerSecrets;
  }
  return knownBy.some((id) => ownedCharacterIds.includes(id));
}
