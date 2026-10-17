// Every DM-side model call, end to end through src/lib/dm/model.ts against
// fake backends (docs/agent-context-efficiency-audit-2026-10-17.md F01, F04,
// F06, F09, F10, F11):
// - the request is fitted to the window and its reply cap is what the window
//   leaves, on the wire;
// - one that cannot fit a known window is refused before anything is sent,
//   and one sized against a window the endpoint never reported still goes;
// - a backend that refuses a request as too big and names its window teaches
//   it, and the call is fitted to it once more;
// - each attempt leaves a model_calls row with its task, and the ledger keeps
//   cached and reasoning tokens apart;
// - a failing utility model falls back to the story model, then is skipped
//   for a while; a request too big for it goes to the story model;
// - the native Ollama payload carries the thinking request, closes its tools
//   when only narration is allowed, caps num_predict and reports length;
// - background upkeep waits while a table's turn calls the same backend.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";
import { removeTempDir } from "./lib/remove-temp-dir.mjs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-model-calls-"));
process.env.SQLITE_DB_PATH = path.join(dir, "test.sqlite");
process.env.DB_ENCRYPTION_KEY = randomBytes(32).toString("hex");
delete process.env.OPENAI_COMPAT_CONTEXT;
register("./lib/register-alias.mjs", import.meta.url);

// ---- fake backends -------------------------------------------------------------
const seen = { chat: [], ollama: [] };
// Per model: "ok", "fail" (500), or a window it refuses past ("n_ctx:4096").
const behaviour = new Map();
function sse(res, deltas, usage, finish = "stop", extra = {}) {
  res.writeHead(200, { "Content-Type": "text/event-stream" });
  for (const delta of deltas) {
    res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`);
  }
  res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: finish }], ...extra })}\n\n`);
  if (usage) res.write(`data: ${JSON.stringify({ choices: [], usage })}\n\n`);
  res.end("data: [DONE]\n\n");
}
const server = http.createServer((req, res) => {
  const chunks = [];
  req.on("data", (chunk) => chunks.push(chunk));
  req.on("end", () => {
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
    if (req.url.endsWith("/chat/completions")) {
      seen.chat.push(body);
      const mode = behaviour.get(body.model) ?? "ok";
      if (mode === "fail") {
        res.writeHead(500, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "boom" }));
        return;
      }
      if (mode.startsWith("n_ctx:")) {
        const nCtx = Number(mode.slice(6));
        const size = Math.ceil(JSON.stringify(body.messages).length / 4) + Math.ceil(JSON.stringify(body.tools ?? []).length / 4);
        if (size + (body.max_tokens ?? 0) > nCtx) {
          res.writeHead(400, { "Content-Type": "application/json" }).end(
            JSON.stringify({ error: { code: 400, message: "the request exceeds the available context size, try increasing it", type: "exceed_context_size_error", n_prompt_tokens: size, n_ctx: nCtx } }),
          );
          return;
        }
      }
      if (body.stream) {
        sse(
          res,
          [{ reasoning_content: "thinking..." }, { content: "The guard nods." }],
          { prompt_tokens: 900, completion_tokens: 40, prompt_tokens_details: { cached_tokens: 600 }, completion_tokens_details: { reasoning_tokens: 12 } },
          "stop",
          { timings: { cache_n: 600, prompt_n: 300, prompt_ms: 120.5, predicted_n: 40, predicted_ms: 800.2 } },
        );
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" }).end(
        JSON.stringify({ choices: [{ message: { content: "Summary." }, finish_reason: "stop" }], usage: { prompt_tokens: 500, completion_tokens: 20 } }),
      );
      return;
    }
    if (req.url === "/api/chat") {
      seen.ollama.push(body);
      const reply = { message: { content: "A short reply." }, done: true, done_reason: "length", prompt_eval_count: 300, eval_count: 50, prompt_eval_duration: 2e8, eval_duration: 9e8, load_duration: 1e6 };
      if (body.stream) {
        res.writeHead(200, { "Content-Type": "application/x-ndjson" });
        res.write(`${JSON.stringify({ message: { content: "A short " }, done: false })}\n`);
        res.end(`${JSON.stringify({ ...reply, message: { content: "reply." } })}\n`);
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(reply));
      return;
    }
    if (req.url === "/api/show") {
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ model_info: {} }));
      return;
    }
    // A keyed llama-server router: /props answers only with the key.
    if (req.url.startsWith("/props")) {
      seen.props = [...(seen.props ?? []), req.headers.authorization ?? ""];
      if (req.headers.authorization !== "Bearer probe-key") {
        res.writeHead(401).end();
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ default_generation_settings: { n_ctx: 24_576 } }));
      return;
    }
    res.writeHead(404).end();
  });
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
process.env.OLLAMA_BASE_URL = base;

const { requestDmMessage, requestUtilityMessage } = await import("../src/lib/dm/model.ts");
const { listTurnModelCalls, summarizeModelCalls } = await import("../src/lib/usage/model-calls.ts");
const { getDatabase } = await import("../src/lib/db/core.ts");
const { learnContextWindow, forgetContextWindows, contextOverflowWindow, storyContextTokens, probeCustomContextWindow } = await import("../src/lib/model-client.ts");
const { asInteractive } = await import("../src/lib/dm/inference-gate.ts");
const { resetCalibration } = await import("../src/lib/dm/token-calibration.ts");

const words = (tokens) => "word ".repeat(Math.ceil((tokens * 4) / 5)).trim();
const settings = (over = {}) => ({
  textProvider: "custom",
  localTextModel: "",
  customBaseUrl: `${base}/v1`,
  customModel: "story",
  customApiKey: "",
  utilityProvider: "custom",
  utilityModel: "",
  utilityBaseUrl: "",
  utilityApiKey: "",
  ...over,
});
const lastCalls = (n) =>
  getDatabase().prepare(`SELECT * FROM model_calls ORDER BY id DESC LIMIT ?`).all(n).reverse();

// ---- 1. fitted, capped, recorded -------------------------------------------------
{
  process.env.OPENAI_COMPAT_CONTEXT = "8192";
  resetCalibration();
  seen.chat.length = 0;
  const result = await requestUtilityMessage(
    settings(),
    [
      { role: "system", content: "Summarize the passages." },
      { role: "user", content: `BEGIN ${words(20_000)} END` },
    ],
    { meta: { task: "compaction" }, onDelta: () => {} },
  );
  assert.ok(!result.error, "the call went through");
  const sent = seen.chat.at(-1);
  const sentTokens = Math.ceil(JSON.stringify(sent.messages).length / 4);
  assert.ok(sentTokens < 8_192, `the oversized input was fitted (${sentTokens} tokens sent)`);
  assert.match(sent.messages[1].content, /^BEGIN /);
  assert.match(sent.messages[1].content, / END$/);
  assert.match(sent.messages[1].content, /left out to fit the model's window/);
  assert.ok(sent.max_tokens >= 512 && sent.max_tokens <= 8_192 - result.sizing.promptTokens, `the reply cap is the room left (${sent.max_tokens})`);
  assert.equal(result.sizing.outputTokens, sent.max_tokens);
  const [row] = lastCalls(1);
  assert.equal(row.task, "compaction");
  assert.equal(row.role, "utility");
  assert.equal(row.outcome, "ok");
  assert.equal(row.input_tokens, 900);
  assert.equal(row.cached_input_tokens, 600, "the cache figure is kept apart");
  assert.equal(row.reasoning_tokens, 12);
  assert.equal(row.prompt_ms, 121, "llama-server's timings ride along");
  assert.equal(row.window_tokens, 8_192);
  assert.ok(row.first_token_ms !== null, "the first visible token was timed");
  assert.equal(row.fit_clipped, 1);
  const usage = getDatabase().prepare(`SELECT cached_input_tokens, reasoning_tokens, role FROM usage_events ORDER BY id DESC LIMIT 1`).get();
  assert.equal(usage.cached_input_tokens, 600);
  assert.equal(usage.reasoning_tokens, 12);
  assert.equal(usage.role, "utility", "utility work on the story route is still recorded as utility");
  console.log(`ok: fitted to 8K (${sentTokens} tokens sent, reply cap ${sent.max_tokens}) and recorded with its cache and reasoning`);
}

// ---- 2. refused before the call on a known window ---------------------------------
{
  process.env.OPENAI_COMPAT_CONTEXT = "4096";
  seen.chat.length = 0;
  const result = await requestDmMessage(
    settings(),
    [
      { role: "system", content: words(6_000) },
      { role: "user", content: "I open the door." },
    ],
    { meta: { task: "turn" }, fit: { history: { start: 1, end: 2 }, protectFrom: 2 } },
  );
  assert.equal(seen.chat.length, 0, "nothing was sent");
  assert.equal(result.error?.status, 413);
  const payload = await result.error.json();
  assert.equal(payload.code, "context_capacity");
  assert.match(payload.error, /context window is too small/);
  assert.match(payload.error, /window is 4,096/);
  assert.match(payload.error, /OPENAI_COMPAT_CONTEXT/);
  assert.equal(lastCalls(1)[0].outcome, "capacity");
  console.log("ok: a request too big for a known window is refused before the call, with the numbers");
}

// ---- 3. an assumed window is advice, not a wall ------------------------------------
{
  delete process.env.OPENAI_COMPAT_CONTEXT;
  forgetContextWindows();
  seen.chat.length = 0;
  assert.equal(storyContextTokens(settings()), 16_384, "nothing told us the window: the stand-in");
  const result = await requestDmMessage(
    settings(),
    [
      { role: "system", content: words(20_000) },
      { role: "user", content: "I open the door." },
    ],
    { meta: { task: "turn" } },
  );
  assert.equal(seen.chat.length, 1, "the request still went out");
  assert.ok(!result.error);
  assert.equal(result.sizing?.windowAssumed, true, "its trace says the window was only assumed");
  assert.ok(result.sizing.promptTokens > result.sizing.windowTokens, "and how far past it the request went");
  assert.ok(seen.chat[0].max_tokens === undefined || seen.chat[0].max_tokens > 0, "it went out uncapped by the guess, never capped at zero");
  console.log("ok: a window the endpoint never reported does not refuse a turn the server may have room for");
}

// ---- 4. a refusal that names the window teaches it --------------------------------
{
  delete process.env.OPENAI_COMPAT_CONTEXT;
  forgetContextWindows();
  behaviour.set("small", "n_ctx:6000");
  seen.chat.length = 0;
  const history = Array.from({ length: 30 }, (_, index) => ({ role: index % 2 ? "assistant" : "user", content: `Line ${index}: ${words(300)}` }));
  const messages = [{ role: "system", content: words(1_500) }, ...history, { role: "user", content: "I open the door." }];
  const result = await requestDmMessage(settings({ customModel: "small" }), messages, {
    meta: { task: "turn" },
    fit: { history: { start: 1, end: messages.length }, protectFrom: messages.length },
  });
  assert.ok(!result.error, "the second try fitted the learned window");
  assert.equal(seen.chat.length, 2, "one refusal, one retry");
  assert.ok(seen.chat[1].messages.length < seen.chat[0].messages.length, "the retry dropped older lines");
  assert.equal(seen.chat[1].messages.at(-1).content, "I open the door.", "the newest line stayed");
  assert.equal(storyContextTokens(settings({ customModel: "small" })), 6_000, "the window is remembered");
  const rows = lastCalls(2);
  assert.equal(rows[0].outcome, "capacity");
  assert.match(rows[1].fallback, /refitted to the 6000-token window/);
  assert.equal(contextOverflowWindow('{"error":{"message":"This model\'s maximum context length is 32768 tokens."}}'), 32_768);
  assert.equal(contextOverflowWindow("rate limited"), null);
  assert.equal(contextOverflowWindow("context_length_exceeded"), 0);
  console.log("ok: a backend's overflow refusal teaches its window and the call is fitted to it");
}

// ---- 5. a failing utility model falls back, then is skipped -------------------------
{
  process.env.OPENAI_COMPAT_CONTEXT = "32768";
  learnContextWindow(`${base}/v1`, "util", 32_768);
  behaviour.set("util", "fail");
  const utility = settings({ utilityModel: "util", utilityBaseUrl: `${base}/v1` });
  const ask = () => requestUtilityMessage(utility, [{ role: "system", content: "Answer." }, { role: "user", content: "Who?" }], { meta: { task: "ask" } });
  seen.chat.length = 0;
  for (let i = 0; i < 2; i += 1) {
    const result = await ask();
    assert.ok(!result.error, "the story model answered");
  }
  assert.deepEqual(seen.chat.map((body) => body.model), ["util", "story", "util", "story"], "tried, fell back, twice");
  seen.chat.length = 0;
  const third = await ask();
  assert.ok(!third.error);
  assert.deepEqual(seen.chat.map((body) => body.model), ["story"], "the failing utility model is skipped for a while");
  assert.match(lastCalls(1)[0].fallback, /skipped after repeated failures/);
  // Too big for the utility model's window, room on the story model's.
  behaviour.set("util", "ok");
  learnContextWindow(`${base}/v1`, "util2", 2_048);
  seen.chat.length = 0;
  const big = await requestUtilityMessage(
    settings({ utilityModel: "util2", utilityBaseUrl: `${base}/v1` }),
    [{ role: "system", content: words(3_000) }, { role: "user", content: "Who?" }],
    { meta: { task: "lore" } },
  );
  assert.ok(!big.error);
  assert.deepEqual(seen.chat.map((body) => body.model), ["story"], "the work went where it fits");
  assert.match(lastCalls(1)[0].fallback, /too big for the utility model/);
  console.log("ok: a failing utility model falls back, then is skipped; work too big for it goes to the story model");
}

// ---- 6. the native Ollama payload ---------------------------------------------------
{
  process.env.LOCAL_TEXT_CONTEXT = "8192";
  const local = settings({ textProvider: "local", localTextModel: "gemma-test" });
  const tools = [{ type: "function", function: { name: "request_roll", description: "Roll.", parameters: { type: "object", properties: {} } } }];
  seen.ollama.length = 0;
  const thinkingCall = await requestDmMessage(local, [{ role: "system", content: "Rules." }, { role: "user", content: "I search." }], {
    tools,
    toolChoice: "auto",
    thinking: true,
    onDelta: () => {},
    meta: { task: "turn" },
  });
  const first = seen.ollama.at(-1);
  assert.equal(first.think, true, "the turn's thinking request reaches Ollama");
  assert.equal(first.tools?.length, 1);
  assert.equal(first.options.num_ctx, 8_192);
  assert.ok(first.options.num_predict <= 4_096, "the local reply cap still applies");
  assert.equal(first.options.temperature, 0.7, "thinking runs cooler, as on the custom backend");
  assert.equal(thinkingCall.finishReason, "length", "done_reason length is read");
  assert.equal(thinkingCall.usage.promptMs, 200);
  await requestDmMessage(local, [{ role: "system", content: "Rules." }, { role: "user", content: "I search." }], {
    tools,
    toolChoice: "none",
    thinking: false,
    maxOutputTokens: 300,
    meta: { task: "turn" },
  });
  const closed = seen.ollama.at(-1);
  assert.equal(closed.tools, undefined, "a narration-only call sends no tools: Ollama has no tool_choice");
  assert.equal(closed.think, false);
  assert.equal(closed.options.num_predict, 300, "the call's own cap wins when smaller");
  // A call salvaged from a reply's text is echoed in the OpenAI shape, its
  // arguments a string; Ollama takes an object and refused the string (400).
  await requestDmMessage(
    local,
    [
      { role: "system", content: "Rules." },
      { role: "user", content: "We charge." },
      { role: "assistant", content: "", tool_calls: [{ id: "json-salvaged-0", type: "function", function: { name: "start_encounter", arguments: '{"enemies":[{"monster":"bandit"}]}' } }] },
      { role: "tool", tool_call_id: "json-salvaged-0", content: '{"ok":true}' },
    ],
    { tools, toolChoice: "auto", meta: { task: "turn" } },
  );
  const echoed = seen.ollama.at(-1).messages.find((message) => message.role === "assistant").tool_calls[0];
  assert.deepEqual(echoed, { function: { name: "start_encounter", arguments: { enemies: [{ monster: "bandit" }] } } });
  await requestDmMessage(local, [{ role: "system", content: "Rules." }, { role: "user", content: "Hi." }], { meta: { task: "recap" } });
  assert.equal(seen.ollama.at(-1).think, false, "left unset, thinking stays off as before");
  assert.equal(seen.ollama.at(-1).options.temperature, 0.9);
  delete process.env.LOCAL_TEXT_CONTEXT;
  console.log("ok: Ollama gets the thinking request, closed tools, the fitted cap, and reports length");
}

// ---- 7. background upkeep waits for a turn on the same backend ---------------------
{
  process.env.OPENAI_COMPAT_CONTEXT = "32768";
  const order = [];
  let release;
  const holding = new Promise((resolve) => (release = resolve));
  const key = `custom|${base}/v1|story`;
  const interactive = asInteractive(key, async () => {
    order.push("turn starts");
    await holding;
    order.push("turn ends");
  });
  const upkeep = requestUtilityMessage(settings(), [{ role: "system", content: "Fold." }, { role: "user", content: "x" }], {
    background: true,
    meta: { task: "compaction" },
  }).then(() => order.push("upkeep sent"));
  await new Promise((resolve) => setTimeout(resolve, 600));
  order.push("released");
  release();
  await Promise.all([interactive, upkeep]);
  assert.deepEqual(order, ["turn starts", "released", "turn ends", "upkeep sent"], "upkeep went after the turn");
  console.log("ok: background upkeep waits while a turn calls the same backend");
}

// ---- 8. the summary reads by task ------------------------------------------------
{
  const summary = summarizeModelCalls("1970-01-01T00:00:00.000Z");
  const compaction = summary.find((row) => row.task === "compaction");
  assert.ok(compaction && compaction.calls >= 2);
  assert.ok(compaction.p50Ms !== null);
  assert.equal(compaction.cachedShare, 0.67, "600 of 900 input tokens came from cache");
  const turn = summary.find((row) => row.task === "turn");
  assert.ok(turn.errors >= 1, "the capacity refusals count as failures");
  assert.deepEqual(listTurnModelCalls("no-such-turn"), []);
  console.log("ok: the per-task summary reads medians, failures and the cached share");
}

// ---- 9. the window probe carries the key the chat call would ----------------------
// A table on the server's own backend names no key; the server's env key is
// what its calls go out with, so its /props probe needs it too. Another host
// is never sent it.
{
  forgetContextWindows();
  // An explicit window outranks any probe; this one is read from /props.
  delete process.env.OPENAI_COMPAT_CONTEXT;
  process.env.OPENAI_COMPAT_BASE_URL = `${base}/v1`;
  process.env.OPENAI_COMPAT_API_KEY = "probe-key";
  seen.props = [];
  assert.equal(await probeCustomContextWindow(`${base}/v1`, "", "keyed"), 24_576, "the router's window, read with the server's key");
  assert.deepEqual(seen.props, ["Bearer probe-key"]);
  assert.equal(storyContextTokens(settings({ customModel: "keyed" })), 24_576);

  const foreignHeaders = [];
  const foreign = http.createServer((req, res) => {
    foreignHeaders.push(req.headers.authorization ?? "");
    res.writeHead(404).end();
  });
  await new Promise((resolve) => foreign.listen(0, "127.0.0.1", resolve));
  assert.equal(await probeCustomContextWindow(`http://127.0.0.1:${foreign.address().port}/v1`, "", "keyed"), null);
  assert.deepEqual(foreignHeaders, [""], "another host never receives the server's key");
  foreign.close();
  delete process.env.OPENAI_COMPAT_BASE_URL;
  delete process.env.OPENAI_COMPAT_API_KEY;
  forgetContextWindows();
  console.log("ok: the window probe carries the key the chat call would, and only to the server's own backend");
}

server.close();
removeTempDir(dir);
console.log("model-calls: all passed");
