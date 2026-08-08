// Pure entity resolution, kept free of alias imports so node test scripts
// (scripts/test-entity.mjs) can load it directly.
//
// npcs is UNIQUE (campaign_id, name) with exact-match lookup, so "Marla",
// "Marla Venn", and "Captain Marla" become three rows with three attitudes
// and three approval meters, and nothing ever reconciles them. The model
// rarely spells a name the same way twice across fifty turns, so this is not
// a rare edge case; it is the normal failure mode of a long campaign.
//
// Three tiers, and only the first two resolve on their own. A fuzzy match is
// a SUGGESTION for the party lead, never a silent merge: "Aldric" and
// "Alaric" are one typo apart and may well be two different people, and
// quietly fusing two NPCs is not something a table can easily undo.

// Stripped before comparison so "Captain Marla" and "Marla" are one person.
const TITLES = new Set([
  "captain", "lady", "lord", "ser", "sir", "master", "mistress", "elder",
  "sister", "brother", "father", "mother", "dame", "king", "queen", "prince",
  "princess", "duke", "duchess", "baron", "baroness", "count", "countess",
  "general", "sergeant", "commander", "doctor", "professor", "the",
]);

// Words that describe a ROLE rather than identify a person. Two names that
// share only these are not the same entity: "guard captain" must never
// swallow "guard", nor "the innkeeper" match "the merchant".
const COMMON_NOUNS = new Set([
  "guard", "captain", "merchant", "priest", "priestess", "soldier", "innkeeper",
  "smith", "blacksmith", "guardian", "knight", "keeper", "warden", "healer",
  "hunter", "scout", "thief", "mage", "wizard", "cleric", "bard", "ranger",
  "man", "woman", "boy", "girl", "child", "stranger", "traveler", "traveller",
  "servant", "steward", "clerk", "sailor", "farmer", "miner", "cook", "guide",
  "acolyte", "novice", "apprentice", "squire", "villager", "townsfolk",
  "bandit", "cultist", "mercenary", "noble", "beggar", "shopkeeper",
]);

export type MatchTier = "exact" | "containment" | "fuzzy";

export type EntityMatch = {
  name: string;
  tier: MatchTier;
  // Only "fuzzy" needs confirming; the other two are safe to apply.
  needsConfirmation: boolean;
};

// Lowercase, strip punctuation and honorifics, collapse whitespace. Keeps
// the tokens that actually identify someone.
export function normalizeName(name: string): string {
  return tokensOf(name).join(" ");
}

export function tokensOf(name: string): string[] {
  const tokens = name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s'-]/gu, " ")
    .split(/[\s'-]+/u)
    .filter((token) => token.length > 0);
  // Titles only count as honorifics in LEADING position. Several of them
  // ("captain", "master", "elder") double as role words, so stripping them
  // anywhere would turn "guard captain" into "guard" and merge a named
  // officer into the generic guard. Never strip the final token, or a name
  // that is nothing but a title vanishes entirely.
  let start = 0;
  while (start < tokens.length - 1 && TITLES.has(tokens[start])) {
    start += 1;
  }
  return tokens.slice(start);
}

function distinctiveTokens(tokens: string[]): string[] {
  return tokens.filter((token) => !COMMON_NOUNS.has(token));
}

// Classic Levenshtein over two short strings; names are never long enough
// for the row-swapped variant to matter.
export function levenshtein(a: string, b: string): number {
  if (a === b) {
    return 0;
  }
  if (!a.length) {
    return b.length;
  }
  if (!b.length) {
    return a.length;
  }
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[b.length];
}

// Similarity in [0, 1].
export function nameSimilarity(a: string, b: string): number {
  const longest = Math.max(a.length, b.length);
  return longest === 0 ? 1 : 1 - levenshtein(a, b) / longest;
}

export const FUZZY_THRESHOLD = 0.85;
// Below this, a name is too short for edit distance to mean anything: "Ana"
// and "Ane" are 0.67 similar but obviously different people, while a single
// typo in a three-letter name is indistinguishable from a different name.
const MIN_FUZZY_LENGTH = 5;

// Whether the shorter name is contained in the longer AND they share at
// least one token that actually identifies somebody.
function containmentMatch(a: string[], b: string[]): boolean {
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  if (!shorter.length) {
    return false;
  }
  const longerSet = new Set(longer);
  if (!shorter.every((token) => longerSet.has(token))) {
    return false;
  }
  return distinctiveTokens(shorter).length > 0;
}

// Resolves a name against known ones. Returns the best match, or null when
// this is somebody new. Candidates are checked tier by tier, so an exact
// match always wins over a fuzzy one.
export function matchEntity(name: string, known: string[]): EntityMatch | null {
  const tokens = tokensOf(name);
  if (!tokens.length) {
    return null;
  }
  const normalized = tokens.join(" ");

  const prepared = known.map((candidate) => ({
    original: candidate,
    tokens: tokensOf(candidate),
    normalized: normalizeName(candidate),
  }));

  for (const candidate of prepared) {
    if (candidate.normalized && candidate.normalized === normalized) {
      return { name: candidate.original, tier: "exact", needsConfirmation: false };
    }
  }

  for (const candidate of prepared) {
    if (containmentMatch(tokens, candidate.tokens)) {
      return { name: candidate.original, tier: "containment", needsConfirmation: false };
    }
  }

  // Fuzzy is a last resort and always defers to a human.
  let best: { name: string; score: number } | null = null;
  for (const candidate of prepared) {
    if (
      normalized.length < MIN_FUZZY_LENGTH ||
      candidate.normalized.length < MIN_FUZZY_LENGTH
    ) {
      continue;
    }
    // Two different real people who merely share a role word should not be
    // dragged together by the role word's letters.
    if (!distinctiveTokens(candidate.tokens).length || !distinctiveTokens(tokens).length) {
      continue;
    }
    const score = nameSimilarity(normalized, candidate.normalized);
    if (score >= FUZZY_THRESHOLD && (!best || score > best.score)) {
      best = { name: candidate.original, score };
    }
  }
  return best ? { name: best.name, tier: "fuzzy", needsConfirmation: true } : null;
}

// The alias list a canonical row should carry after absorbing a variant.
// Merging records the variant rather than rewriting history: past narration
// keeps the words it was written with, and the lexical retriever still
// matches them because the aliases ride along in the searchable text.
export function mergeAliases(existing: string[], incoming: string): string[] {
  const seen = new Set(existing.map((alias) => normalizeName(alias)));
  const normalized = normalizeName(incoming);
  if (!normalized || seen.has(normalized)) {
    return existing;
  }
  return [...existing, incoming.trim()].slice(0, 12);
}
