// Which world lore entries ride a DM turn, and why (issue #305). Pure and
// free of "@/" imports, so scripts/test-lore-selection.mjs loads it directly;
// src/lib/dm/context-retrieval.ts hands over the entries and renders the
// pick.
//
// The turn used to carry the two nearest unpinned entries, always two: a
// scene with four doors told the DM about two of them, and a scene with one
// relevant entry got a second, unrelated one beside it. Now every entry that
// matches the moment closely rides, up to LORE_PICK_MAX, and nothing rides
// for filling a slot. An entry is close when any of these holds:
//
// - The ask names it: a word the players just wrote is in its title or its
//   tags ("which gate?" and four entries called something Gate). A word in
//   more names than the cap can show, across most of the lore, is the
//   setting's theme (the city every entry is set in), not a set of options,
//   and names nothing.
// - The scene names it: every word of its title is in the scene line (the
//   party stands in the Gilded Tankard, and the Tankard has an entry).
// - Its words match: its IDF-weighted overlap with the players' ask is at
//   least CLOSE_SHARE of the best overlap, sharing a word with the ask that
//   most entries do not. When the ask matches no entry at all (a turn with
//   no player line, or one about nothing the lore holds), the scene line and
//   the ask together are read instead, and an entry must share two of their
//   words: "the Gilded Tankard" names a place, the city alone names half the
//   lore.
// - Its meaning matches: its similarity stands at least CLOSE_SHARE of the
//   way from the lore's middle to the best similarity, both to the whole
//   moment and to the players' words alone. Either one alone is noise on a
//   short text. Measured with the default MiniLM on the ten-entry city that
//   scripts/test-lore-selection.mjs keeps (its similarities are in the test),
//   the scene line's city name made three unrelated entries "close" to a
//   question about the ferryman, and "slip into the city unseen" alone rated
//   a sleeping lich as close as the gates.
//
// Overlap alone cannot tell the subject of a sentence from an incidental
// rare word in it ("anyone" matching one entry's "anyone without a writ" as
// strongly as "lye" matches another's lye); the meaning signal separates
// those when the embedder runs, and the DM is told to use only what bears on
// the moment.
//
// Both scales are read against their own best, never against a fixed
// number: what a cosine of 0.6 means depends on the model and the language
// (src/lib/dm/fusion-logic.ts), and an overlap score depends on how long
// the moment is. The best match on either scale is close by definition, so
// the nearest entry still rides, as it always did; what it no longer brings
// is company it did not earn.

import type { TableLanguage } from "../schemas/game-settings-options.ts";
import { stemmerWords, stemWord, stopWordsFor } from "../language/language.ts";
import { CHARS_PER_TOKEN } from "./context-budget.ts";
import { computeIdf, fuseRRF, lexicalScore, rankByFusion, tokenize } from "./fusion-logic.ts";

export const LORE_PICK_MAX = 6;
export const CLOSE_SHARE = 0.5;
// Below this many embedded entries the middle of the lore means nothing,
// and meaning alone admits only the single nearest entry. Below this many
// entries, no word is common enough to be a theme.
const MIN_CORPUS = 3;

// The lore block's room, measured from the prompt window rather than fixed:
// the retrieval share (context-budget.ts computeBudgets), never under
// LORE_BUDGET_MIN, so a small window still carries an entry or two (the old
// fixed 1,600 characters sat between the two bounds), and never over
// LORE_BUDGET_MAX: six entries at the full excerpt with a few pinned beside
// them, about 1,500 tokens. What the house rules took comes off after the
// floor, so lore and house rules together never pass the retrieval share's
// room: house rules that spent all of it leave lore none (the context
// audit's F12).
export const LORE_BUDGET_MIN = 800;
export const LORE_BUDGET_MAX = 6_000;

export function loreBudgetChars(retrievalTokens: number, houseRulesChars: number): number {
  const share = Math.floor((Number.isFinite(retrievalTokens) ? retrievalTokens : 0) * CHARS_PER_TOKEN);
  const rules = Math.max(0, houseRulesChars);
  // The room lore would have with no house rules, and what the share (or the
  // floor, on a window too small for even that) leaves after them.
  const alone = Math.max(LORE_BUDGET_MIN, Math.min(LORE_BUDGET_MAX, share));
  return Math.min(alone, Math.max(0, Math.max(share, LORE_BUDGET_MIN) - rules));
}

export type LoreCandidate = {
  id: string;
  title: string;
  tags: readonly string[];
  body: string;
  // Cosine similarity to the whole moment, or null without an embedding.
  similarity: number | null;
  // Cosine similarity to the players' words alone; null without an
  // embedding, and on a turn with no player line.
  askSimilarity?: number | null;
};

// The moment: the scene line, the players' newest words (the ask), and the
// two together as retrieval reads them.
export type LoreMoment = { scene: string; ask: string; query: string };

export type LorePick = { id: string; rank: number; reason: string };
// close: the entry matched the moment and only the cap left it out; false
// for a near match that was not close enough to ride.
export type LoreHeld = { id: string; reason: string; close: boolean };

export type LoreSelection = { picked: LorePick[]; held: LoreHeld[] };

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

// One meaning signal read against itself: flat when every entry is as near
// as the middle one (an embedder answering one vector for everything), and
// close for an entry at least CLOSE_SHARE of the way from the middle to the
// best. With too few embedded entries for a middle, only the best is close.
function meaningScale(candidates: LoreCandidate[], read: (candidate: LoreCandidate) => number | null) {
  const values = new Map<string, number>();
  for (const candidate of candidates) {
    const value = read(candidate);
    if (value !== null && Number.isFinite(value)) {
      values.set(candidate.id, value);
    }
  }
  const sorted = [...values.values()];
  const top = sorted.length ? Math.max(...sorted) : 0;
  const middle = sorted.length ? median(sorted) : 0;
  const flat = !sorted.length || top <= middle;
  const best = [...values.entries()].find(([, value]) => value === top)?.[0];
  return {
    flat,
    close(id: string): boolean {
      const value = values.get(id);
      if (flat || value === undefined) {
        return false;
      }
      if (values.size < MIN_CORPUS) {
        return id === best;
      }
      return (value - middle) / (top - middle) >= CLOSE_SHARE;
    },
  };
}

// More names carry it than the cap can show, and most of the lore does: the
// setting's theme rather than a set of options.
function isTheme(holders: number, total: number, max: number): boolean {
  return total >= MIN_CORPUS && holders > max && holders * 2 > total;
}

// The entries whose name carries a word of the ask, each with the word as
// its name spells it.
function namedByAsk(candidates: LoreCandidate[], ask: string, language: TableLanguage, max: number): Map<string, string> {
  const asked = new Set(tokenize(ask, language));
  const named = new Map<string, string>();
  if (!asked.size) {
    return named;
  }
  const stop = stopWordsFor(language);
  const holders = new Map<string, { word: string; ids: string[] }>();
  for (const candidate of candidates) {
    const counted = new Set<string>();
    for (const word of stemmerWords(`${candidate.title} ${candidate.tags.join(" ")}`)) {
      const stem = stop.has(word) ? "" : stemWord(word, language);
      if (stem.length <= 2 || !asked.has(stem) || counted.has(stem)) {
        continue;
      }
      counted.add(stem);
      const holder = holders.get(stem) ?? { word, ids: [] };
      holder.ids.push(candidate.id);
      holders.set(stem, holder);
    }
  }
  for (const { word, ids } of holders.values()) {
    if (isTheme(ids.length, candidates.length, max) || ids.length > max * 2) {
      continue;
    }
    for (const id of ids) {
      if (!named.has(id)) {
        named.set(id, word);
      }
    }
  }
  return named;
}

export function selectLore(
  candidates: LoreCandidate[],
  moment: LoreMoment,
  language: TableLanguage,
  max = LORE_PICK_MAX,
): LoreSelection {
  if (!candidates.length) {
    return { picked: [], held: [] };
  }
  const total = candidates.length;
  const textOf = (candidate: LoreCandidate) => `${candidate.title} ${candidate.tags.join(" ")} ${candidate.body}`;
  // IDF over the lore competing for the turn, as fusion scoring reads it:
  // what every entry says weighs nothing.
  const idf = computeIdf(candidates.map(textOf), language);
  const termsOf = new Map(candidates.map((candidate) => [candidate.id, new Set(tokenize(textOf(candidate), language))]));
  const frequency = new Map<string, number>();
  for (const terms of termsOf.values()) {
    for (const term of terms) {
      frequency.set(term, (frequency.get(term) ?? 0) + 1);
    }
  }
  const theme = (term: string) => isTheme(frequency.get(term) ?? 0, total, max);
  const overlap = (text: string) =>
    new Map(candidates.map((candidate) => [candidate.id, text ? lexicalScore(text, textOf(candidate), idf, language) : 0]));
  // How many words of `terms` the entry carries that most entries do not.
  const shared = (id: string, terms: ReadonlySet<string>) =>
    [...(termsOf.get(id) ?? [])].filter((term) => terms.has(term) && !theme(term)).length;

  // The whole moment orders the entries; the ask, when it matches anything,
  // decides which are close on words.
  const lexical = overlap(moment.query);
  const askTerms = new Set(tokenize(moment.ask, language));
  const askLexical = overlap(moment.ask);
  const askMatches = candidates.some((candidate) => (askLexical.get(candidate.id) ?? 0) > 0 && shared(candidate.id, askTerms) > 0);
  const closeScore = askMatches ? askLexical : lexical;
  const closeTerms = askMatches ? askTerms : new Set(tokenize(moment.query, language));
  const distinctive = (id: string) => shared(id, closeTerms) >= (askMatches ? 1 : 2);

  // Each signal ranked on its own and cut to the cap before fusing, as
  // fuseRanked does: an entry in both lists outranks one in a single list,
  // and the cut keeps a weak overlap plus a weak cosine from outranking the
  // strongest single-signal match.
  const lexicalRanking = candidates
    .filter((candidate) => (lexical.get(candidate.id) ?? 0) > 0)
    .sort((a, b) => (lexical.get(b.id) ?? 0) - (lexical.get(a.id) ?? 0))
    .slice(0, max);
  const semanticRanking = candidates
    .filter((candidate) => candidate.similarity !== null)
    .sort((a, b) => (b.similarity ?? 0) - (a.similarity ?? 0))
    .slice(0, max);
  const whole = meaningScale(candidates, (candidate) => candidate.similarity);
  const asked = meaningScale(candidates, (candidate) => candidate.askSimilarity ?? null);
  const order = rankByFusion(
    fuseRRF([lexicalRanking.map((entry) => entry.id), whole.flat ? [] : semanticRanking.map((entry) => entry.id)]),
  );

  const topLexical = Math.max(0, ...candidates.filter((candidate) => distinctive(candidate.id)).map((candidate) => closeScore.get(candidate.id) ?? 0));
  const named = namedByAsk(candidates, moment.ask, language, max);
  const sceneTerms = new Set(tokenize(moment.scene, language));
  const sceneNames = (candidate: LoreCandidate) => {
    const titleTerms = tokenize(candidate.title, language);
    return titleTerms.length > 0 && titleTerms.every((term) => sceneTerms.has(term)) && titleTerms.some((term) => !theme(term));
  };

  const wordsClose = (candidate: LoreCandidate) =>
    topLexical > 0 && distinctive(candidate.id) && (closeScore.get(candidate.id) ?? 0) / topLexical >= CLOSE_SHARE;
  const askHasMeaning = candidates.some((candidate) => candidate.askSimilarity !== undefined && candidate.askSimilarity !== null);
  const meaningClose = (candidate: LoreCandidate) =>
    whole.close(candidate.id) && (!moment.ask || !askHasMeaning || asked.close(candidate.id));
  const reasonFor = (candidate: LoreCandidate): string => {
    const word = named.get(candidate.id);
    return [
      word ? `the ask names it ("${word}")` : "",
      sceneNames(candidate) ? "the scene names it" : "",
      wordsClose(candidate) ? "words match" : "",
      meaningClose(candidate) ? "meaning matches" : "",
    ]
      .filter(Boolean)
      .join("; ");
  };

  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const close: Array<{ id: string; reason: string }> = [];
  const weak: LoreHeld[] = [];
  for (const [index, id] of order.entries()) {
    const reason = reasonFor(byId.get(id)!);
    if (reason) {
      close.push({ id, reason });
    } else {
      weak.push({ id, reason: `a near match (rank ${index + 1}), not close enough to ride`, close: false });
    }
  }
  // Entries the ask or the scene names that neither scale ranked ride after
  // the matches, in the order the lead listed them.
  for (const candidate of candidates) {
    if ((named.has(candidate.id) || sceneNames(candidate)) && !close.some((entry) => entry.id === candidate.id)) {
      close.push({ id: candidate.id, reason: reasonFor(candidate) });
    }
  }

  return {
    picked: close.slice(0, max).map((entry, index) => ({ id: entry.id, rank: index + 1, reason: entry.reason })),
    held: [
      ...close.slice(max).map((entry) => ({ id: entry.id, reason: `over the cap of ${max} entries a turn (${entry.reason})`, close: true })),
      ...weak,
    ],
  };
}
