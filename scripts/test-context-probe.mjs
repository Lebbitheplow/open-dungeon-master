// Reading a context window out of /props. The fixtures below are the actual
// responses from a llama.cpp --models-preset router (llama-server 8001,
// qwen3.6-35b launched with c = 65536), because this parsing fails silently:
// a miss looks like an under-budgeted prompt, never an error.
import assert from "node:assert/strict";
import {
  buildPropsUrl,
  contextCacheKey,
  normalizeBaseUrl,
  OPENAI_CONTEXT_TOKENS,
  paramsFromModelName,
  readContextWindow,
  readModelParams,
} from "../src/lib/dm/context-probe-logic.ts";

let passed = 0;
const check = (name, fn) => {
  fn();
  passed += 1;
};

// Captured live from /props?model=qwen3.6-35b
const ROUTER_WITH_MODEL = { default_generation_settings: { n_ctx: 65536 } };
// Captured live from a bare /props on the same router
const ROUTER_BARE = { default_generation_settings: { n_ctx: 0 } };
// Single-model llama.cpp builds report it at the top level.
const SINGLE_MODEL = { n_ctx: 32768, default_generation_settings: { n_ctx: 32768 } };

check("the real router response yields the launch -c", () => {
  assert.equal(readContextWindow(ROUTER_WITH_MODEL), 65536);
});

check("a bare router response is a miss, not a window of zero", () => {
  // This is the trap: the router answers 200 with n_ctx 0 for itself. Reading
  // that as a real value would budget a prompt at zero tokens.
  assert.equal(readContextWindow(ROUTER_BARE), null);
});

check("a top-level n_ctx is read too", () => {
  assert.equal(readContextWindow(SINGLE_MODEL), 32768);
  assert.equal(readContextWindow({ n_ctx: 8192 }), 8192);
});

check("junk and absence both resolve to a miss", () => {
  assert.equal(readContextWindow(null), null);
  assert.equal(readContextWindow(undefined), null);
  assert.equal(readContextWindow({}), null);
  assert.equal(readContextWindow({ n_ctx: "65536" }), null, "a string is not a window");
  assert.equal(readContextWindow({ n_ctx: -1 }), null);
  assert.equal(readContextWindow({ n_ctx: Number.NaN }), null);
});

check("a fractional window is floored rather than passed through", () => {
  assert.equal(readContextWindow({ n_ctx: 4096.9 }), 4096);
});

check("the props url carries the model, which is what makes a router answer", () => {
  assert.equal(
    buildPropsUrl("http://127.0.0.1:8001/v1", "qwen3.6-35b"),
    "http://127.0.0.1:8001/props?model=qwen3.6-35b",
  );
});

check("the /v1 suffix and trailing slashes are stripped", () => {
  assert.equal(normalizeBaseUrl("http://x:8001/v1/"), "http://x:8001");
  assert.equal(normalizeBaseUrl("http://x:8001///"), "http://x:8001");
  assert.equal(normalizeBaseUrl("  http://x:8001  "), "http://x:8001");
  assert.equal(normalizeBaseUrl(""), "");
});

check("model ids are url-encoded", () => {
  assert.match(buildPropsUrl("http://x:8001", "a b/c"), /model=a%20b%2Fc/);
});

check("no base url means no request to make", () => {
  assert.equal(buildPropsUrl("", "m"), "");
});

check("the cache key separates models sharing one port", () => {
  // --models-max 1 means several models share a base URL, each with its own
  // -c; caching on base URL alone would hand one model's window to another.
  const a = contextCacheKey("http://127.0.0.1:8001/v1", "qwen3.6-35b");
  const b = contextCacheKey("http://127.0.0.1:8001/v1", "qwen3.6-27b");
  assert.notEqual(a, b);
  assert.equal(a, contextCacheKey("http://127.0.0.1:8001", "qwen3.6-35b"), "normalized");
});

check("OpenAI's shared floor is 128K; the catalog sizes anything smaller (scripts/test-model-registry.mjs)", () => {
  assert.equal(OPENAI_CONTEXT_TOKENS, 128_000);
});

// Captured live from /v1/models on a single-model llama-server (Qwen3.5 9B
// Q8_0, b1-ff5a233), trimmed to the fields read.
const LLAMA_MODELS = {
  object: "list",
  data: [
    {
      id: "qwen3.5-9b-q8",
      aliases: ["qwen3.5-9b-q8"],
      object: "model",
      owned_by: "llamacpp",
      meta: { vocab_type: 2, n_vocab: 248320, n_ctx: 81920, n_ctx_train: 262144, n_embd: 4096, n_params: 8953803264, size: 9516533760, ftype: "Q8_0" },
    },
  ],
};

check("the model's size comes from llama-server's /v1/models", () => {
  assert.equal(readModelParams(LLAMA_MODELS, "qwen3.5-9b-q8"), 8953803264);
  assert.equal(readModelParams(LLAMA_MODELS, ""), 8953803264, "no name: the only model listed");
  assert.equal(readModelParams(LLAMA_MODELS, "anything"), 8953803264, "a single-model server answers to any name");
  const router = { data: [{ id: "a", meta: { n_params: 9e9 } }, { id: "b", meta: { n_params: 35e9 } }, { id: "c" }] };
  assert.equal(readModelParams(router, "b"), 35e9, "a router: the entry named");
  assert.equal(readModelParams(router, "c"), null, "an unloaded model reports no size");
  assert.equal(readModelParams(router, "z"), null, "a name a router does not list is not guessed");
  assert.equal(readModelParams({ data: [{ id: "x" }] }, "x"), null, "vLLM, LM Studio: no meta");
  assert.equal(readModelParams(null, "x"), null);
  assert.equal(readModelParams({ data: [{ id: "x", meta: { n_params: "9e9" } }] }, "x"), null);
});

check("a name that states the size is read for it, the whole model's first", () => {
  assert.equal(paramsFromModelName("qwen3.5-9b-q8"), 9e9);
  assert.equal(paramsFromModelName("gemma4:12b-it-qat"), 12e9);
  assert.equal(paramsFromModelName("Qwen3-30B-A3B-Instruct"), 30e9);
  assert.equal(paramsFromModelName("llama3.1:8b"), 8e9);
  assert.equal(paramsFromModelName("phi-3.5-mini"), null);
  assert.equal(paramsFromModelName("gemma4:e4b-it-qat"), null, "an effective size is not the whole model");
  assert.equal(paramsFromModelName("mixtral-8x7b"), null);
  assert.equal(paramsFromModelName(""), null);
});

console.log(`context-probe: ${passed} tests passed`);
