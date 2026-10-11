// Pure fact consolidation, kept free of alias imports so node test scripts
// (scripts/test-fact-consolidation.mjs) can load it directly.
//
// The calls that extract facts (chapter close, history compaction) are also
// handed the facts already on file, each under a short handle, and may say
// that a fact they return replaces one, or that one on file is now false or
// only repeats another. That is how a reworded duplicate or a contradiction
// is retired: the model reads both sentences, where a cosine between them
// could not tell "Kara carries the key" from "Kara lost the key". The
// handles keep the model's reply away from real ids, and only a handle that
// was shown can retire anything.

import {
  CATEGORY_LABELS,
  PER_CATEGORY_CAP,
  RENDER_CHAR_BUDGET,
  type FactCategory,
} from "./fact-logic.ts";
import { replyJsonObject } from "../reply-json-logic.ts";

export type FactOnFile = {
  id: string;
  category: FactCategory;
  subject: string;
  fact: string;
};

export type ShownFact = { handle: string; id: string };

// The facts on file as the extraction prompt lists them, nearest first as
// given, within the budget and per-category cap the DM prompt's fact sheet
// uses (fact-logic.ts renderFactsForPrompt). Unlike that sheet, a pinned
// fact gets no precedence: every line counts toward the budget, so the list
// stays bounded however many are pinned.
export function renderFactsOnFile(facts: FactOnFile[]): { text: string; shown: ShownFact[] } {
  const lines: string[] = [];
  const shown: ShownFact[] = [];
  const perCategory = new Map<string, number>();
  let budget = RENDER_CHAR_BUDGET;
  for (const fact of facts) {
    const handle = `f${shown.length + 1}`;
    const line = `[${handle}] [${CATEGORY_LABELS[fact.category]}] ${fact.subject ? `${fact.subject}: ` : ""}${fact.fact}`;
    const used = perCategory.get(fact.category) ?? 0;
    if (used >= PER_CATEGORY_CAP || line.length > budget) {
      continue;
    }
    perCategory.set(fact.category, used + 1);
    budget -= line.length;
    lines.push(line);
    shown.push({ handle, id: fact.id });
  }
  return { text: lines.join("\n"), shown };
}

export const CONSOLIDATION_INSTRUCTIONS =
  'The facts already on file are listed under handles like [f3]. Do not return a fact already on file. When a fact you return updates or corrects one on file, add "replaces": its handle to that fact. Add "retire": the handles of facts on file that this transcript proves false, or that only repeat another fact on file; an empty array when none.';

// The ids of the shown facts a reply retires: each returned fact's
// `replaces` and the `retire` list. A handle that was not shown retires
// nothing; an unreadable reply retires nothing. Pins are kept by retireFacts
// (src/lib/db/facts.ts).
export function consolidationRetirements(raw: string, shown: ShownFact[]): string[] {
  const reply = replyJsonObject(raw);
  const parsed = (reply && typeof reply === "object" ? reply : {}) as { facts?: unknown; retire?: unknown };
  const handles: unknown[] = [
    ...(Array.isArray(parsed.facts)
      ? parsed.facts.map((entry) => (entry && typeof entry === "object" ? (entry as { replaces?: unknown }).replaces : undefined))
      : []),
    ...(Array.isArray(parsed.retire) ? parsed.retire : []),
  ];
  const byHandle = new Map(shown.map((fact) => [fact.handle, fact]));
  const ids = new Set<string>();
  for (const handle of handles) {
    const fact = typeof handle === "string" ? byHandle.get(handle.trim()) : undefined;
    if (fact) {
      ids.add(fact.id);
    }
  }
  return [...ids];
}
