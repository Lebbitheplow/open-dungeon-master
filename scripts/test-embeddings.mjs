// The embedding-size guard: stored vectors are 384-dim, so a model of any
// other size must fail when it loads, not switch semantic search off unnoticed.
import assert from "node:assert/strict";
import { checkEmbeddingDim } from "../src/lib/embeddings.ts";

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

console.log(`test-embeddings: ${passed} tests passed`);
