// The embedding-size guard: stored vectors are 384-dim, so a model of any
// other size must fail when it loads, not switch semantic search off unnoticed.
import assert from "node:assert/strict";
import {
  LEGACY_EMBEDDING_KEY,
  checkEmbeddingDim,
  embeddingIndexStale,
  resolveEmbeddingDtype,
} from "../src/lib/embeddings.ts";

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

test("a 384-dim model passes", () => {
  checkEmbeddingDim("Xenova/paraphrase-multilingual-MiniLM-L12-v2", 384);
});

test("any other size throws, naming the model and both sizes", () => {
  assert.throws(() => checkEmbeddingDim("Xenova/all-mpnet-base-v2", 768), {
    message:
      "Embedding model Xenova/all-mpnet-base-v2 produces 768-dim vectors; only 384-dim models are supported.",
  });
});

test("a known dtype is normalized, so Q8 and q8 key the same index", () => {
  assert.equal(resolveEmbeddingDtype("q8"), "q8");
  assert.equal(resolveEmbeddingDtype(" Q8 "), "q8");
  assert.equal(resolveEmbeddingDtype("fp16"), "fp16");
  assert.equal(resolveEmbeddingDtype(""), "fp32");
});

test("an unknown dtype, or auto, warns and runs the fp32 weights it would load anyway", () => {
  const warnings = [];
  const original = console.warn;
  console.warn = (message) => warnings.push(message);
  try {
    assert.equal(resolveEmbeddingDtype("q9"), "fp32");
    assert.equal(resolveEmbeddingDtype("auto"), "fp32");
  } finally {
    console.warn = original;
  }
  assert.equal(warnings.length, 2);
  assert.match(warnings[0], /Unknown EMBEDDING_DTYPE "q9"; using fp32/);
});

test("the index is stale only when the recorded model differs from the configured one", () => {
  assert.equal(embeddingIndexStale("A/model@q8", "A/model@q8"), false);
  assert.equal(embeddingIndexStale("A/model@q8", "A/model@fp32"), true);
  assert.equal(embeddingIndexStale("A/model@q8", "B/model@q8"), true);
  // Never recorded: built by the original model, so only it can reuse it.
  assert.equal(embeddingIndexStale(null, LEGACY_EMBEDDING_KEY), false);
  assert.equal(embeddingIndexStale(null, "Xenova/paraphrase-multilingual-MiniLM-L12-v2@q8"), true);
});

console.log(`test-embeddings: ${passed} tests passed`);
