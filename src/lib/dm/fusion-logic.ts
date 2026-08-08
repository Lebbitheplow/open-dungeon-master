// Pure lexical scoring and rank fusion, kept free of alias imports so node
// test scripts (scripts/test-fusion.mjs) can load it directly.
//
// Retrieval used to be either/or: cosine when an embedding existed, keyword
// overlap only as a fallback when it did not. That threw away the lexical
// signal on every healthy turn, which is exactly the signal embeddings are
// worst at: a rare proper noun said once ("Marla", "Vhaeric") lands close to
// every other name in vector space, but it is unmistakable lexically.
//
// It also let two incommensurate scales share one threshold. The old
// SIMILARITY_FLOOR = 0.3 was compared against cosine (a similarity in
// [-1, 1]) AND against keyword scores (a fraction of query words matched).
// Reciprocal rank fusion dissolves that by construction: it reads ORDER, not
// magnitude, so no two scorers ever have to agree on what 0.3 means.

// Common words carry no retrieval signal and would otherwise dominate the
// term overlap in a prose-heavy transcript.
const STOP_WORDS = new Set([
  "the", "and", "for", "are", "but", "not", "you", "your", "his", "her", "its",
  "our", "their", "they", "them", "this", "that", "these", "those", "with",
  "from", "into", "onto", "was", "were", "been", "have", "has", "had", "does",
  "did", "will", "would", "could", "should", "can", "may", "might", "must",
  "what", "when", "where", "who", "whom", "why", "how", "all", "any", "some",
  "each", "than", "then", "there", "here", "out", "off", "over", "under",
  "again", "once", "about", "after", "before", "between", "through", "during",
]);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}']+/u)
    .filter((token) => token.length > 2 && !STOP_WORDS.has(token));
}

// Inverse document frequency with BM25's smoothing, so a term in every
// document scores near zero and a term in one document scores high. Never
// negative: the +1 inside the log keeps a term present everywhere at 0
// rather than dragging a score below a term that is simply absent.
export function computeIdf(documents: string[]): Map<string, number> {
  const total = documents.length;
  const documentFrequency = new Map<string, number>();
  for (const document of documents) {
    for (const term of new Set(tokenize(document))) {
      documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
    }
  }
  const idf = new Map<string, number>();
  for (const [term, frequency] of documentFrequency) {
    idf.set(term, Math.log(1 + (total - frequency + 0.5) / (frequency + 0.5)));
  }
  return idf;
}

// Saturating term frequency: the second mention of a term matters much less
// than the first, and the tenth barely at all (BM25's k1 term).
const TF_SATURATION = 1.2;
// A document containing the query verbatim is worth more than the same words
// scattered across it.
const PHRASE_BONUS = 0.25;

// IDF-weighted overlap in [0, 1]: the share of the query's total IDF mass
// this document accounts for, plus a phrase bonus. A term the corpus has
// never seen falls back to a middling weight rather than zero, so a brand new
// proper noun still scores.
export function lexicalScore(
  query: string,
  document: string,
  idf: Map<string, number>,
): number {
  const queryTerms = new Set(tokenize(query));
  if (!queryTerms.size) {
    return 0;
  }
  const documentTerms = tokenize(document);
  if (!documentTerms.length) {
    return 0;
  }
  const counts = new Map<string, number>();
  for (const term of documentTerms) {
    counts.set(term, (counts.get(term) ?? 0) + 1);
  }

  const unseenWeight = Math.log(1 + 1 / 0.5);
  let matched = 0;
  let mass = 0;
  for (const term of queryTerms) {
    const weight = idf.get(term) ?? unseenWeight;
    mass += weight;
    const frequency = counts.get(term) ?? 0;
    if (frequency > 0) {
      matched += weight * ((frequency * (TF_SATURATION + 1)) / (frequency + TF_SATURATION));
    }
  }
  if (mass <= 0) {
    return 0;
  }
  // Normalized against the query's IDF mass, so a document containing every
  // query term once scores exactly 1. Repeats push the tf factor above 1 and
  // clamp: scene chunks are short prose where most terms appear once, and
  // normalizing against the tf ceiling instead would cap them near 0.55.
  const overlap = Math.min(1, matched / mass);
  const phrase = document.toLowerCase().includes(query.trim().toLowerCase()) ? PHRASE_BONUS : 0;
  return Math.min(1, overlap + phrase);
}

// Reciprocal rank fusion. Each ranking contributes 1 / (k + rank) for the
// ids it contains; k = 60 is the value from the original RRF paper and damps
// the difference between the top few ranks so one confident-but-wrong list
// cannot bulldoze the others. Ids missing from a ranking simply score zero
// there, which is what makes this safe when one signal is unavailable.
export function fuseRRF(rankings: string[][], k = 60): Map<string, number> {
  const fused = new Map<string, number>();
  for (const ranking of rankings) {
    ranking.forEach((id, index) => {
      fused.set(id, (fused.get(id) ?? 0) + 1 / (k + index + 1));
    });
  }
  return fused;
}

// Orders ids by fused score, highest first. Ties break on the id so the
// order is stable across runs.
export function rankByFusion(fused: Map<string, number>): string[] {
  return [...fused.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([id]) => id);
}

export type RankableCandidate = {
  id: string;
  // IDF-weighted lexical overlap in [0, 1].
  lexical: number;
  // Cosine similarity, or null when this candidate has no embedding yet.
  similarity: number | null;
};

// The shared retrieval shape: score every candidate both ways, rank each
// signal independently, fuse the ranks, and return the best ids.
//
// Eligibility is still enforced per signal, because fusion only orders and
// would otherwise happily return the least-bad match when nothing matches at
// all. A candidate qualifies on ANY lexical overlap or on clearing the cosine
// floor, so neither signal can veto the other. That is the point: cosine
// alone misses a rare name, and lexical alone misses a paraphrase.
export function fuseRanked(
  candidates: RankableCandidate[],
  options: { similarityFloor: number; limit: number; k?: number },
): string[] {
  const eligible = candidates.filter(
    (candidate) =>
      candidate.lexical > 0 ||
      (candidate.similarity !== null && candidate.similarity >= options.similarityFloor),
  );
  if (!eligible.length) {
    return [];
  }
  const lexicalRanking = eligible
    .filter((candidate) => candidate.lexical > 0)
    .sort((a, b) => b.lexical - a.lexical)
    .map((candidate) => candidate.id);
  const semanticRanking = eligible
    .filter(
      (candidate) =>
        candidate.similarity !== null && candidate.similarity >= options.similarityFloor,
    )
    .sort((a, b) => (b.similarity ?? 0) - (a.similarity ?? 0))
    .map((candidate) => candidate.id);
  return rankByFusion(fuseRRF([lexicalRanking, semanticRanking], options.k)).slice(
    0,
    options.limit,
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) {
    return 0;
  }
  let shared = 0;
  for (const term of a) {
    if (b.has(term)) {
      shared += 1;
    }
  }
  return shared / (a.size + b.size - shared);
}

// Maximal marginal relevance. Scene chunks are cut from a continuous
// transcript, so the three best matches for "the vault" are often three
// windows onto one conversation; without this a top-3 can say the same thing
// three times and crowd out the other moment that actually answers the
// question. lambda trades relevance (1.0) against novelty (0.0).
export function applyMmr<T extends { id: string; text: string }>(
  candidates: T[],
  limit: number,
  lambda = 0.7,
): T[] {
  const remaining = [...candidates];
  const tokens = new Map(remaining.map((entry) => [entry.id, new Set(tokenize(entry.text))]));
  const picked: T[] = [];
  // Relevance is the incoming order as a reciprocal rank, which keeps it in
  // (0, 1] and comparable with the Jaccard redundancy term. Decaying linearly
  // to zero instead would pin the last candidate at 0 relevance, so on a
  // short list no amount of redundancy could ever displace a near-duplicate
  // ahead of it.
  const relevance = new Map(
    remaining.map((entry, index) => [entry.id, 1 / (1 + index)]),
  );

  while (picked.length < limit && remaining.length) {
    let bestIndex = 0;
    let bestScore = -Infinity;
    for (let index = 0; index < remaining.length; index += 1) {
      const entry = remaining[index];
      const own = tokens.get(entry.id) ?? new Set<string>();
      let redundancy = 0;
      for (const chosen of picked) {
        redundancy = Math.max(redundancy, jaccard(own, tokens.get(chosen.id) ?? new Set()));
      }
      const score = lambda * (relevance.get(entry.id) ?? 0) - (1 - lambda) * redundancy;
      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    }
    picked.push(remaining[bestIndex]);
    remaining.splice(bestIndex, 1);
  }
  return picked;
}
