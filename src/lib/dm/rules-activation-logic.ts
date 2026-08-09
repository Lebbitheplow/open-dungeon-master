// House-rule chunk activation: trigger keywords, and sending the whole rules
// document verbatim when it is small enough that retrieval could only lose
// information.
//
// Ported from NarrativeEngine-P (MIT, Copyright (c) 2026 Sagesheep):
// computeRulesThreshold in src/services/rules/rulesIndexer.ts, and the
// keyword-activation branch of src/services/rules/rulesRetriever.ts.
//
// What ODM already had, and what this adds. Chunks already carry `pinned`
// (always in the prompt, bypassing retrieval, which is NE-P's `always` mode)
// and `enabled`, and retrieval already fuses IDF lexical scoring with cosine
// similarity rather than being pure vector. So the gap was never the modes
// themselves. It was that a rule only reachable by a word the party rarely
// uses ("we play with flanking") had to out-score everything else on a fused
// relevance metric to earn one of three slots, with no way to say "when this
// exact word appears, this rule is relevant, full stop".
//
// Dependency-free so scripts/test-rules-activation.mjs can import it directly.

import { estimateTokens } from "./context-budget.ts";

// NE-P's headroom factor. Retrieval is only worth its complexity when the
// document genuinely cannot fit; at 1.2x the budget the whole thing still
// rides, because a complete rules document beats three well-chosen fragments
// of it every time.
export const VERBATIM_HEADROOM = 1.2;

export function rulesVerbatimThreshold(rulesBudgetTokens: number): number {
  return Math.floor(rulesBudgetTokens * VERBATIM_HEADROOM);
}

export function shouldSendVerbatim(rulesText: string, rulesBudgetTokens: number): boolean {
  return estimateTokens(rulesText) <= rulesVerbatimThreshold(rulesBudgetTokens);
}

// Stored the way aliases are on NPCs: one text column, comma separated, so a
// house rule can be given trigger words without a second table.
export function parseTriggerKeywords(raw: string): string[] {
  return (raw ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

export function serializeTriggerKeywords(keywords: string[]): string {
  return keywords.map((value) => value.trim()).filter(Boolean).join(", ");
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Word-bounded so a keyword like "rest" does not fire on "arrest" or
// "restrain". Multi-word keywords are matched as a phrase.
export function matchesTrigger(query: string, keywords: string[]): string | null {
  const text = query.toLowerCase();
  for (const keyword of keywords) {
    const trimmed = keyword.trim().toLowerCase();
    if (!trimmed) {
      continue;
    }
    if (new RegExp(`\\b${escapeRegex(trimmed)}\\b`, "i").test(text)) {
      return keyword;
    }
  }
  return null;
}

export type ActivationChunk = {
  id: string;
  text: string;
  enabled: boolean;
  pinned: boolean;
  triggerKeywords: string;
};

export type ActivationResult<T extends ActivationChunk = ActivationChunk> = {
  // Every enabled chunk, because the document fits and splitting it would
  // only lose context.
  verbatim: boolean;
  // Chunks that ride regardless of the query: pinned, plus any whose trigger
  // keyword appeared. These do NOT consume retrieval slots.
  forced: T[];
  // Everything left for ordinary relevance retrieval to rank.
  retrievable: T[];
  // Which keyword admitted each triggered chunk, for the manager UI.
  triggeredBy: Record<string, string>;
};

// A triggered chunk is admitted outright rather than given a score bonus.
// NE-P adds +20 to its fused score, which on their scale is effectively the
// same thing; ODM's retrieval returns a fixed top 3, so a bonus could still
// lose to three strong vector hits. Admitting directly is what makes the
// promise ("when this word appears, this rule is present") actually hold.
// Generic over the caller's chunk type so the real rows come back out, not a
// narrowed copy the renderer cannot use.
export function selectRuleChunks<T extends ActivationChunk>(
  chunks: T[],
  query: string,
  rulesBudgetTokens: number,
): ActivationResult<T> {
  const enabled = chunks.filter((chunk) => chunk.enabled);
  const triggeredBy: Record<string, string> = {};

  const allText = enabled.map((chunk) => chunk.text).join("\n\n");
  if (shouldSendVerbatim(allText, rulesBudgetTokens)) {
    return { verbatim: true, forced: enabled, retrievable: [], triggeredBy };
  }

  const forced: T[] = [];
  const retrievable: T[] = [];
  for (const chunk of enabled) {
    if (chunk.pinned) {
      forced.push(chunk);
      continue;
    }
    const keywords = parseTriggerKeywords(chunk.triggerKeywords);
    const hit = keywords.length ? matchesTrigger(query, keywords) : null;
    if (hit) {
      forced.push(chunk);
      triggeredBy[chunk.id] = hit;
      continue;
    }
    retrievable.push(chunk);
  }

  return { verbatim: false, forced, retrievable, triggeredBy };
}
