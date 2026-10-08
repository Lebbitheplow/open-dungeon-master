import { normalizeName } from "./entity-logic.ts";

// The review queue for the matches entity-logic.ts deliberately refuses to
// resolve on its own.
//
// entity-logic.ts already computes fuzzy near-misses and marks them
// needsConfirmation, and db/npcs.ts already exposes suggestNpcMerges. Nothing
// ever showed them: the suggestions were computed and thrown away, so
// "Aldric" and "Alaric" stayed two NPCs with two attitudes forever. This is
// the missing half, ported in spirit from NarrativeEngine-P's entity review
// (MIT, Copyright (c) 2026 Sagesheep).
//
// One deliberate departure from the obvious design. Merging does NOT rewrite
// past narration. entity-logic.ts states the rule and it is the right one:
// what the DM already wrote keeps the words it was written with, and the
// absorbed spelling becomes an alias so the lexical retriever still finds it.
// Rewriting a hundred stored messages to fix a name would be destructive,
// unreviewable, and would make the transcript disagree with what the table
// actually read. Structured records (facts) do get repointed, because those
// are indexed by subject and a split subject is a real retrieval bug.
//
// Alias-free so scripts/test-entity-review.mjs can import it directly.

export const MAX_NPC_NAME = 60;

export function clampNpcName(raw: string): string {
  return (raw ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_NPC_NAME);
}

// A dismissal has to survive whichever direction the next scan reports the
// pair in: suggestNpcMerges walks the roster in order, so inserting an NPC
// alphabetically between two others flips which one is reported first. Keying
// on the sorted normalized pair makes "Aldric/Alaric" and "Alaric/Aldric" the
// same decision.
export function pairKey(a: string, b: string): string {
  return [normalizeName(a), normalizeName(b)].sort().join("\u0000");
}

export type MergePlan = {
  // The name that survives.
  keepName: string;
  // The name being absorbed; becomes an alias of the keeper.
  mergeName: string;
  aliases: string[];
};

// Which spellings the surviving row should answer to afterwards. Both rows'
// aliases plus the absorbed canonical name, deduplicated by normalized form
// so "Captain Marla" and "captain marla" do not both land, and capped the
// same way mergeAliases caps.
export function planMerge(
  keep: { name: string; aliases: string[] },
  merge: { name: string; aliases: string[] },
): MergePlan | { error: string } {
  const keepName = clampNpcName(keep.name);
  const mergeName = clampNpcName(merge.name);
  if (!keepName || !mergeName) {
    return { error: "Both NPCs need a name." };
  }
  if (normalizeName(keepName) === normalizeName(mergeName)) {
    return { error: "Those are already the same name." };
  }

  const aliases: string[] = [];
  const seen = new Set<string>();
  // The keeper's existing aliases are carried over unconditionally. They are
  // NOT checked against the keeper's own name, because a spelling that
  // differs only in case or punctuation ("WARDEN") normalizes to it, and
  // dropping it would make a merge silently delete a spelling the row
  // already answered to.
  // Only the incoming names dedupe against the keeper.
  for (const candidate of keep.aliases) {
    const clamped = clampNpcName(candidate);
    const normalized = normalizeName(clamped);
    if (!clamped || !normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    aliases.push(clamped);
  }
  seen.add(normalizeName(keepName));
  for (const candidate of [mergeName, ...merge.aliases]) {
    const clamped = clampNpcName(candidate);
    const normalized = normalizeName(clamped);
    if (!clamped || !normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    aliases.push(clamped);
  }
  return { keepName, mergeName, aliases: aliases.slice(0, 12) };
}

// A rename keeps the old spelling as an alias for exactly the same reason a
// merge does: everything already written still says the old name.
export function planRename(
  npc: { name: string; aliases: string[] },
  nextName: string,
): { name: string; aliases: string[] } | { error: string } {
  const name = clampNpcName(nextName);
  if (!name) {
    return { error: "A name cannot be empty." };
  }
  if (name === npc.name) {
    return { error: "That is already their name." };
  }

  const aliases: string[] = [];
  // Deduped by exact spelling rather than normalized form, for the same
  // reason planMerge preserves the keeper's aliases: "Captain Marla" and
  // "Marla" normalize to one string but are two distinct spellings the
  // transcript may contain, and a rename must not quietly discard one.
  const seen = new Set<string>();
  // The old canonical name goes first: it is the spelling the transcript is
  // full of, so it is the one retrieval most needs to keep matching.
  for (const candidate of [npc.name, ...npc.aliases]) {
    const clamped = clampNpcName(candidate);
    const key = clamped.toLowerCase();
    if (!clamped || seen.has(key) || key === name.toLowerCase()) {
      continue;
    }
    seen.add(key);
    aliases.push(clamped);
  }
  return { name, aliases: aliases.slice(0, 12) };
}

export function isReviewError<T>(result: T | { error: string }): result is { error: string } {
  return typeof result === "object" && result !== null && "error" in result;
}

// Drops pairs the lead already dismissed. Suggestions are recomputed from the
// roster on every read, so without this a dismissed pair reappears forever.
export function filterDismissed<T extends { name: string; matches: string }>(
  suggestions: T[],
  dismissedKeys: Iterable<string>,
): T[] {
  const dismissed = new Set(dismissedKeys);
  return suggestions.filter(
    (suggestion) => !dismissed.has(pairKey(suggestion.name, suggestion.matches)),
  );
}
