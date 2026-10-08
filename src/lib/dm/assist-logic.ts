// Shaping for the DM's assist rail: turning a player's stated intent into a
// shortlist of adjudications, and reading back what the model proposed.
//
// The shortlist is ranked by meaning, not by words: the intent and each
// catalog entry are embedded (src/lib/embeddings.ts, on the server with no
// model call) and ordered by similarity, so a DM typing in Italian gets the
// same help as one typing in English. This replaced a list of English stop
// words and synonyms, which suggested nothing for any other language. The
// model call that follows picks from the whole catalog, not from the
// shortlist, so a shortlist that missed still leaves the right action
// reachable.
//
// Pure and dependency-free apart from the catalog's own types, so
// scripts/test-assist.mjs can import it.

import type { CatalogEntry } from "@/lib/dm/catalog-types";

// What an entry is embedded as: its name as words, its label and its summary.
export function catalogEntryText(entry: CatalogEntry): string {
  return `${entry.name.replace(/_/g, " ")}: ${entry.label}. ${entry.summary}`;
}

// The actions this moment of play allows: a fight tool with no fight running
// is not the answer to anything.
export function availableEntries(entries: readonly CatalogEntry[], inEncounter: boolean): CatalogEntry[] {
  return entries.filter((entry) => inEncounter || !entry.needsEncounter);
}

function dot(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    sum += a[index] * b[index];
  }
  return sum;
}

// Nearest first, by cosine (the vectors are unit-normalized). Order only:
// no similarity value decides anything, so no threshold depends on the
// embedding model or the language. Ties keep catalog order, which groups by
// category and puts the common things first inside each one.
export function rankBySimilarity(
  intent: Float32Array,
  entries: readonly CatalogEntry[],
  vectors: ReadonlyMap<string, Float32Array>,
  limit: number,
): CatalogEntry[] {
  return entries
    .map((entry, index) => ({ entry, index, vector: vectors.get(entry.name) }))
    .filter((item): item is { entry: CatalogEntry; index: number; vector: Float32Array } => item.vector !== undefined)
    .map(({ entry, index, vector }) => ({ entry, index, score: dot(intent, vector) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .map(({ entry }) => entry);
}

export type ParsedSuggestion = {
  name: string;
  args: Record<string, unknown>;
  why: string;
};

// The model answers with JSON naming one catalog entry and its arguments.
// Returns null on anything unusable, because the shortlist is already on
// screen and a wrong prefill is worse than none.
export function parseSuggestionJson(raw: string): ParsedSuggestion | null {
  const text = String(raw ?? "").trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) {
    return null;
  }
  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
    const name = typeof parsed.name === "string" ? parsed.name.trim() : "";
    if (!name) {
      return null;
    }
    const args =
      parsed.args && typeof parsed.args === "object" && !Array.isArray(parsed.args)
        ? (parsed.args as Record<string, unknown>)
        : {};
    return {
      name,
      args,
      why: typeof parsed.why === "string" ? parsed.why.slice(0, 200) : "",
    };
  } catch {
    return null;
  }
}
