// Hybrid-retrieval primitives: IDF weighting, lexical scoring, reciprocal
// rank fusion, and MMR diversification.
import assert from "node:assert/strict";
import {
  applyMmr,
  computeIdf,
  fuseRanked,
  fuseRRF,
  lexicalScore,
  rankByFusion,
  tokenize,
} from "../src/lib/dm/fusion-logic.ts";

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

const corpus = [
  "The party bargained with the salt merchants at the crossroads market.",
  "A merchant offered the party passage across the river for coin.",
  "The merchants of the guild refused to trade with outsiders.",
  "Marla opened the vault beneath the chapel and found it already empty.",
];

test("tokenize drops stop words and short tokens", () => {
  const tokens = tokenize("The party was in the vault");
  assert.ok(tokens.includes("party"));
  assert.ok(tokens.includes("vault"));
  assert.ok(!tokens.includes("the"));
  assert.ok(!tokens.includes("was"));
});

test("computeIdf weights a rare name above a common word", () => {
  const idf = computeIdf(corpus);
  // "marla" appears in 1 of 4 documents; "party" in 3 of 4.
  assert.ok(idf.get("marla") > idf.get("party"));
  // "merchants" is in 2 of 4. There is no stemming, so the singular
  // "merchant" is a different term with its own count; that is fine, both
  // still rank below a name seen once.
  assert.ok(idf.get("merchants") < idf.get("marla"));
  // Never negative, even for a term in every document.
  for (const value of idf.values()) {
    assert.ok(value >= 0);
  }
});

test("lexicalScore finds the rare proper noun, not the common word", () => {
  const idf = computeIdf(corpus);
  const scores = corpus.map((document) => lexicalScore("what did Marla find in the vault", document, idf));
  const best = scores.indexOf(Math.max(...scores));
  assert.equal(best, 3);
  assert.ok(scores[3] > 0.5);
  // A document sharing only common words scores far lower.
  assert.ok(scores[3] > scores[0] * 2);
});

test("lexicalScore stays in range and handles empty input", () => {
  const idf = computeIdf(corpus);
  for (const document of corpus) {
    const score = lexicalScore("marla vault chapel merchants party river guild", document, idf);
    assert.ok(score >= 0 && score <= 1, `score ${score} out of range`);
  }
  assert.equal(lexicalScore("", corpus[0], idf), 0);
  assert.equal(lexicalScore("marla", "", idf), 0);
  // Query terms the corpus never saw still score rather than vanishing.
  assert.ok(lexicalScore("Vhaeric", "The sigil of Vhaeric burned cold.", idf) > 0);
});

test("fuseRRF rewards consistent high placement", () => {
  // "b" tops both rankings; "a" and "c" each place well once and poorly once.
  const fused = fuseRRF([
    ["b", "a", "c"],
    ["b", "c", "a"],
  ]);
  assert.ok(fused.get("b") > fused.get("a"));
  assert.ok(fused.get("b") > fused.get("c"));
  assert.equal(fused.get("a").toFixed(9), fused.get("c").toFixed(9));
});

test("fuseRRF: mirrored rankings favour the extremes over the middle", () => {
  // Worth pinning down, because it is counter-intuitive. 1/x is convex, so
  // 1/(k+1) + 1/(k+3) > 2/(k+2): an item ranked first and last beats one
  // ranked second twice. This is real RRF behaviour, not a bug, and it is
  // why we never feed it two deliberately opposed rankings.
  const fused = fuseRRF([
    ["a", "b", "c"],
    ["c", "b", "a"],
  ]);
  assert.ok(fused.get("a") > fused.get("b"));
  assert.equal(fused.get("a").toFixed(9), fused.get("c").toFixed(9));
});

test("fuseRRF tolerates a missing signal", () => {
  // Embeddings unavailable: only the lexical ranking has anything to say.
  const lexicalOnly = fuseRRF([["x", "y", "z"], []]);
  assert.deepEqual(rankByFusion(lexicalOnly), ["x", "y", "z"]);
  assert.deepEqual(rankByFusion(fuseRRF([[], []])), []);
});

test("fuseRRF surfaces an id only one ranking found", () => {
  // The lexical hit on a rare name is absent from the semantic ranking
  // entirely; fusion must still let it place, not discard it.
  const fused = fuseRRF([
    ["marla", "guild", "market"],
    ["guild", "market"],
  ]);
  const order = rankByFusion(fused);
  assert.ok(order.includes("marla"));
  assert.equal(order[0], "guild");
});

test("rankByFusion is stable for equal scores", () => {
  const fused = fuseRRF([["b", "a"]]);
  const first = rankByFusion(fused);
  assert.deepEqual(first, rankByFusion(fused));
});

test("fuseRanked keeps a lexical-only hit that cosine missed", () => {
  // The classic failure of pure-cosine recall: a rare proper noun sits close
  // to every other name in vector space, so it never clears the floor, but it
  // is unmistakable lexically.
  const picked = fuseRanked(
    [
      { id: "rare-name", lexical: 0.9, similarity: 0.11 },
      { id: "vague-paraphrase", lexical: 0, similarity: 0.62 },
      { id: "unrelated", lexical: 0, similarity: 0.04 },
    ],
    { similarityFloor: 0.3, limit: 3 },
  );
  assert.deepEqual(picked.sort(), ["rare-name", "vague-paraphrase"]);
  assert.ok(!picked.includes("unrelated"));
});

test("fuseRanked returns nothing when nothing is eligible", () => {
  // Fusion only orders; without this guard it would cheerfully hand back the
  // least-bad match and inject junk lore into the prompt.
  assert.deepEqual(
    fuseRanked(
      [
        { id: "a", lexical: 0, similarity: 0.05 },
        { id: "b", lexical: 0, similarity: null },
      ],
      { similarityFloor: 0.3, limit: 3 },
    ),
    [],
  );
  assert.deepEqual(fuseRanked([], { similarityFloor: 0.3, limit: 3 }), []);
});

test("fuseRanked degrades to lexical-only with no embeddings", () => {
  const picked = fuseRanked(
    [
      { id: "a", lexical: 0.2, similarity: null },
      { id: "b", lexical: 0.8, similarity: null },
      { id: "c", lexical: 0, similarity: null },
    ],
    { similarityFloor: 0.3, limit: 2 },
  );
  assert.deepEqual(picked, ["b", "a"]);
});

test("fuseRanked honours the limit", () => {
  const candidates = Array.from({ length: 10 }, (_, index) => ({
    id: `id${index}`,
    lexical: 1 - index / 10,
    similarity: 0.9 - index / 20,
  }));
  assert.equal(fuseRanked(candidates, { similarityFloor: 0.3, limit: 3 }).length, 3);
});

test("applyMmr drops a near-duplicate for a novel result", () => {
  const candidates = [
    { id: "1", text: "Marla opened the vault beneath the chapel" },
    { id: "2", text: "Marla opened the vault beneath the chapel again" },
    { id: "3", text: "The river crossing cost the party three silver" },
  ];
  const picked = applyMmr(candidates, 2, 0.7);
  assert.equal(picked[0].id, "1");
  assert.equal(picked[1].id, "3", "the near-duplicate should lose to the novel chunk");
});

test("applyMmr keeps order when nothing is redundant and respects the limit", () => {
  const candidates = [
    { id: "1", text: "salt merchants crossroads market" },
    { id: "2", text: "vault chapel sigil" },
    { id: "3", text: "river crossing silver toll" },
  ];
  assert.deepEqual(applyMmr(candidates, 3, 0.7).map((entry) => entry.id), ["1", "2", "3"]);
  assert.equal(applyMmr(candidates, 2, 0.7).length, 2);
  assert.deepEqual(applyMmr([], 3, 0.7), []);
});

console.log(`test-fusion: ${passed} tests passed`);
