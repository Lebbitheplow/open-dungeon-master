// Reading a context window out of /props. The fixtures below are the actual
// responses from a llama.cpp --models-preset router (llama-server 8001,
// qwen3.6-35b launched with c = 65536), because this parsing fails silently:
// a miss looks like an under-budgeted prompt, never an error.
import assert from "node:assert/strict";
import {
  buildPropsUrl,
  contextCacheKey,
  normalizeBaseUrl,
  openAiContextWindow,
  OPENAI_CONTEXT_TOKENS,
  readContextWindow,
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

// OpenAI reports no window anywhere, so it is read off the model's name.
check("a current OpenAI model packs against the shared 128K floor", () => {
  for (const model of ["gpt-5.1", "gpt-5-mini", "gpt-5.4-mini", "gpt-4o", "gpt-4.1", "o3", "o4-mini"]) {
    assert.equal(openAiContextWindow(model), OPENAI_CONTEXT_TOKENS, model);
  }
});

check("a model this table has never heard of gets the floor, not a guess", () => {
  assert.equal(openAiContextWindow("gpt-7-omni"), OPENAI_CONTEXT_TOKENS);
  assert.equal(openAiContextWindow(""), OPENAI_CONTEXT_TOKENS);
});

check("the retired small-window models keep their real size", () => {
  assert.equal(openAiContextWindow("gpt-3.5-turbo"), 16_385);
  assert.equal(openAiContextWindow("gpt-4"), 8_192);
  assert.equal(openAiContextWindow("gpt-4-0613"), 8_192);
  assert.equal(openAiContextWindow("gpt-4-32k"), 32_768);
  // Same prefix, far bigger window: these must not match the gpt-4 row.
  assert.equal(openAiContextWindow("gpt-4-turbo"), OPENAI_CONTEXT_TOKENS);
  assert.equal(openAiContextWindow("gpt-4-0125-preview"), OPENAI_CONTEXT_TOKENS);
});

check("a fine-tune is sized by its base model", () => {
  assert.equal(openAiContextWindow("ft:gpt-3.5-turbo-0125:acme::abc123"), 16_385);
  assert.equal(openAiContextWindow("ft:gpt-4o-mini-2024-07-18:acme::abc123"), OPENAI_CONTEXT_TOKENS);
});

console.log(`context-probe: ${passed} tests passed`);
