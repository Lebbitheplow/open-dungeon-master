// Shaping for the DM's assist rail: turning a player's stated intent into a
// shortlist of adjudications, and reading back what the model proposed.
//
// The shortlist is ranked by meaning, not by words: the intent and each
// catalog entry are embedded (src/lib/embeddings.ts, on the server, no model
// call), so a DM typing in Italian gets the same help as one typing in
// English. An entry also carries the SRD's text for each choice it offers (a
// skill check, the Athletics paragraph: "climb a sheer or slippery
// cliff..."), because its summary says what it does to the sheet, never what
// a player says that calls for it. The model call that follows picks from the
// whole catalog, so a shortlist that missed still leaves the right action
// reachable.
//
// Pure and dependency-free apart from the catalog's own types, so
// scripts/test-assist.mjs can import it.

import type { CatalogEntry } from "@/lib/dm/catalog-types";

// What an entry is embedded as: its name as words, its label and its summary.
export function catalogEntryText(entry: CatalogEntry): string {
  return `${entry.name.replace(/_/g, " ")}: ${entry.label}. ${entry.summary}`;
}

// How much of an SRD section an entry carries: the opening of a long one is
// what says what it covers, and the embedding models read no further.
const SECTION_CHARS = 1200;

// Every titled stretch of the SRD's rules pages, by lowercased title: a
// heading's section, or a bold-italic run-in paragraph ("***Athletics***.
// Your Strength (Athletics) check covers ...") with the lines after it, as
// plain text.
export function srdSections(pages: readonly { kind: string; md: string }[]): Map<string, string> {
  const sections = new Map<string, string>();
  for (const page of pages) {
    if (page.kind !== "rules") {
      continue;
    }
    const lines = page.md.split("\n");
    lines.forEach((line, index) => {
      const heading = /^#{2,4} (.+)$/.exec(line);
      const runIn = /^\*\*\*(.+?)\*\*\*/.exec(line);
      const title = (heading?.[1] ?? runIn?.[1])?.trim().toLowerCase();
      if (!title || sections.has(title)) {
        return;
      }
      const body = [line];
      for (const next of lines.slice(index + 1)) {
        if (/^#{2,4} /.test(next) || (runIn && next.startsWith("***"))) {
          break;
        }
        body.push(next);
      }
      sections.set(title, body.join(" ").replace(/[*_#>|`]/g, "").replace(/\s+/g, " ").trim().slice(0, SECTION_CHARS));
    });
  }
  return sections;
}

// Everything an entry is embedded as: its own text, then the SRD section
// named by each choice it offers, when the SRD has a section of that title.
export function catalogPassages(entry: CatalogEntry, sections: ReadonlyMap<string, string>): string[] {
  const passages = [catalogEntryText(entry)];
  for (const field of entry.fields) {
    for (const option of field.options ?? []) {
      const section = sections.get(option.label.trim().toLowerCase());
      if (section) {
        passages.push(`${entry.label}: ${option.label}. ${section}`);
      }
    }
  }
  return passages;
}

// One action as the model sees it: its name, what it does, and its
// arguments. A pick list names its values, because the console's form only
// prefills a value it offers: a model left to guess writes "check" for
// skill_check, or the table's own word for a skill. A list that also takes
// a typed value says so.
export function candidateLine(entry: CatalogEntry): string {
  const fields = entry.fields
    .map((field) => {
      const values = field.options?.length
        ? `: ${field.options.map((option) => option.value).join("|")}${field.other ? "|other text" : ""}`
        : "";
      return `${field.name} (${field.kind}${field.required ? ", required" : ""}${values})`;
    })
    .join(", ");
  return `- ${entry.name}: ${entry.summary}\n  arguments: ${fields || "none"}`;
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

// Nearest first, by cosine (the vectors are unit-normalized), an entry
// scored by its nearest passage. Order only: no similarity value decides
// anything, so no threshold depends on the embedding model or the language.
// Ties keep catalog order, which groups by category and puts the common
// things first inside each one.
export function rankBySimilarity(
  intent: Float32Array,
  entries: readonly CatalogEntry[],
  vectors: ReadonlyMap<string, readonly Float32Array[]>,
  limit: number,
): CatalogEntry[] {
  return entries
    .map((entry, index) => ({ entry, index, passages: vectors.get(entry.name) ?? [] }))
    .filter(({ passages }) => passages.length > 0)
    .map(({ entry, index, passages }) => ({ entry, index, score: Math.max(...passages.map((vector) => dot(intent, vector))) }))
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
