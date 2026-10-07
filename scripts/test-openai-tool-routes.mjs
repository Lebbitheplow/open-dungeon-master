// Issue #129: OpenAI's GPT-6 models refuse function tools on Chat
// Completions, and the old retry-without-tools arm would have swallowed
// that refusal and run the narrator with no request_roll and no engines.
// requestCustomMessage against a fake OpenAI (fetch is stubbed, so the
// base URL can be api.openai.com itself and the name table applies) that
// answers the way OpenAI documents:
// - gpt-6.1-sol: tools on Chat Completions 400 with the message the issue
//   quotes; reasoning_effort "none" is refused; tools work on /v1/responses;
// - gpt-6-sol: tools on Chat Completions work only with reasoning_effort
//   "none", and temperature is refused;
// - gpt-4.1: unchanged.
// Then the pure translators on their own, and a proxy host that learns its
// route from the refusal.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-tool-routes-"));
process.env.SQLITE_DB_PATH = path.join(dir, "test.sqlite");
process.env.DB_ENCRYPTION_KEY = randomBytes(32).toString("hex");

register("./lib/register-alias.mjs", import.meta.url);

const { requestCustomMessage } = await import("../src/lib/model-client.ts");
const { customResponsesEndpoint, fromResponsesOutput, toResponsesInput, toResponsesTools } = await import(
  "../src/lib/openai-responses.ts"
);

let passed = 0;
const ok = (name) => {
  passed += 1;
  console.log(`ok: ${name}`);
};

const GPT6_REFUSAL = (model) => ({
  error: {
    message: `Function tools with reasoning_effort are not supported for ${model} in /v1/chat/completions. To use function tools, use /v1/responses or set reasoning_effort to 'none'.`,
    type: "invalid_request_error",
    param: null,
    code: null,
  },
});

const TOOLS = [
  {
    type: "function",
    function: {
      name: "request_roll",
      description: "Ask the server for a roll.",
      parameters: { type: "object", properties: { kind: { type: "string" } }, required: ["kind"] },
    },
  },
];

// Every request the fake saw: { host, path, body }.
const seen = [];
const sse = (events) =>
  new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("") + "data: [DONE]\n\n", {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });

const fakeOpenAi = async (url, init) => {
  const { hostname, pathname } = new URL(String(url));
  const body = JSON.parse(init.body);
  seen.push({ host: hostname, path: pathname, body });
  const model = String(body.model);
  const gpt6 = /^gpt-6/.test(model);

  if (pathname.endsWith("/chat/completions")) {
    if (gpt6 && body.temperature !== undefined) {
      return Response.json(
        { error: { message: "Unsupported parameter: 'temperature' is not supported with this model.", param: "temperature", code: "unsupported_parameter" } },
        { status: 400 },
      );
    }
    if (gpt6 && body.reasoning_effort === "none" && /^gpt-6\.1|astra/.test(model)) {
      return Response.json(
        { error: { message: `Unsupported value: 'none' is not supported with the '${model}' model.`, param: "reasoning_effort", code: "unsupported_value" } },
        { status: 400 },
      );
    }
    if (gpt6 && body.tools?.length && body.reasoning_effort !== "none") {
      return Response.json(GPT6_REFUSAL(model), { status: 400 });
    }
    const call = {
      id: "call_chat_1",
      type: "function",
      function: { name: "request_roll", arguments: '{"kind":"perception"}' },
    };
    if (body.stream) {
      return sse([
        { choices: [{ delta: { content: "The door " } }] },
        { choices: [{ delta: { content: "creaks." } }] },
        ...(body.tools?.length ? [{ choices: [{ delta: { tool_calls: [{ index: 0, ...call }] } }] }] : []),
      ]);
    }
    return Response.json({
      choices: [{ message: { role: "assistant", content: "The door creaks.", ...(body.tools?.length ? { tool_calls: [call] } : {}) } }],
    });
  }

  if (pathname.endsWith("/responses")) {
    if (hostname === "no-responses.test") {
      return new Response("Not Found", { status: 404 });
    }
    assert.equal(body.store, false, "nothing is stored on OpenAI's side");
    assert.ok(Array.isArray(body.input), "input is an item array");
    for (const item of body.input) {
      assert.ok(!("tool_calls" in item) && item.role !== "tool", `a Chat Completions shape leaked: ${JSON.stringify(item)}`);
    }
    for (const tool of body.tools ?? []) {
      assert.equal(tool.strict, false, "strict is set off by name");
      assert.equal(typeof tool.name, "string", "flat tool shape");
      assert.ok(!("function" in tool), "no nested function");
    }
    const answered = body.input.some((item) => item.type === "function_call_output");
    const output = answered
      ? [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "You hear whispering." }] }]
      : [
          { type: "reasoning", summary: [] },
          { type: "message", role: "assistant", content: [{ type: "output_text", text: "The door creaks." }] },
          ...(body.tools?.length
            ? [{ type: "function_call", id: "fc_1", call_id: "call_resp_1", name: "request_roll", arguments: '{"kind":"perception"}', status: "completed" }]
            : []),
        ];
    if (body.stream) {
      const text = output.find((item) => item.type === "message").content[0].text;
      return sse([
        { type: "response.created", response: { id: "resp_1", status: "in_progress" } },
        { type: "response.output_text.delta", item_id: "msg_1", output_index: 1, delta: text.slice(0, 8) },
        { type: "response.output_text.delta", item_id: "msg_1", output_index: 1, delta: text.slice(8) },
        ...output.map((item, index) => ({ type: "response.output_item.done", output_index: index, item })),
        { type: "response.completed", response: { id: "resp_1", status: "completed", output } },
      ]);
    }
    return Response.json({ id: "resp_1", status: "completed", output });
  }
  return new Response("nope", { status: 404 });
};

const realFetch = globalThis.fetch;
globalThis.fetch = fakeOpenAi;
const OPENAI = "https://api.openai.com/v1";
const ask = [{ role: "user", content: "I open the door." }];

try {
  // --- gpt-6.1-sol goes straight to the Responses API --------------------
  {
    seen.length = 0;
    const result = await requestCustomMessage(OPENAI, "gpt-6.1-sol", "sk-test", ask, { tools: TOOLS, thinking: true });
    assert.ok(!result.error, result.error ? await result.error.text() : "");
    assert.equal(seen.length, 1, "one request, no Chat Completions attempt");
    assert.equal(seen[0].path, "/v1/responses");
    // The cap follows OPENROUTER_MAX_TOKENS in .env.server, so only its presence is pinned.
    assert.equal(typeof seen[0].body.max_output_tokens, "number");
    assert.ok(!("max_completion_tokens" in seen[0].body) && !("messages" in seen[0].body));
    assert.ok(!("chat_template_kwargs" in seen[0].body) && !("reasoning_effort" in seen[0].body));
    assert.equal(result.message.content, "The door creaks.");
    assert.deepEqual(result.message.tool_calls, [
      { id: "call_resp_1", type: "function", function: { name: "request_roll", arguments: '{"kind":"perception"}' } },
    ]);
    ok("gpt-6.1-sol runs its tools on /v1/responses with no wasted request");
  }

  // --- the tool result goes back as function_call_output, streamed --------
  {
    seen.length = 0;
    const deltas = [];
    const transcript = [
      { role: "system", content: "You are the DM." },
      ...ask,
      { role: "assistant", content: "The door creaks.", tool_calls: [{ id: "call_resp_1", type: "function", function: { name: "request_roll", arguments: '{"kind":"perception"}' } }] },
      { role: "tool", tool_call_id: "call_resp_1", content: '{"total":17}' },
    ];
    const result = await requestCustomMessage(OPENAI, "gpt-6.1-sol", "sk-test", transcript, {
      tools: TOOLS,
      onDelta: (text) => deltas.push(text),
    });
    assert.ok(!result.error, result.error ? await result.error.text() : "");
    const input = seen[0].body.input;
    assert.deepEqual(input[0], { role: "system", content: "You are the DM." });
    assert.deepEqual(input[2], { role: "assistant", content: "The door creaks." });
    assert.deepEqual(input[3], { type: "function_call", call_id: "call_resp_1", name: "request_roll", arguments: '{"kind":"perception"}' });
    assert.deepEqual(input[4], { type: "function_call_output", call_id: "call_resp_1", output: '{"total":17}' });
    assert.equal(seen[0].body.stream, true);
    assert.equal(deltas.join(""), "You hear whispering.", "prose streams as it lands");
    assert.equal(result.message.content, "You hear whispering.");
    assert.equal(result.message.tool_calls, undefined);
    ok("a tool result round-trips as function_call_output and the reply streams");
  }

  // --- gpt-6-sol stays on Chat Completions with reasoning off -------------
  {
    seen.length = 0;
    const result = await requestCustomMessage(OPENAI, "gpt-6-sol", "sk-test", ask, { tools: TOOLS, thinking: true });
    assert.ok(!result.error, result.error ? await result.error.text() : "");
    assert.equal(seen.at(-1).path, "/v1/chat/completions");
    assert.equal(seen.at(-1).body.reasoning_effort, "none");
    assert.equal(typeof seen.at(-1).body.max_completion_tokens, "number");
    assert.deepEqual(result.message.tool_calls[0].function.name, "request_roll");
    // The story temperature was refused once and is remembered for the model.
    assert.equal(seen.length, 2, "the temperature 400 and the retry");
    assert.ok(!("temperature" in seen[1].body));
    seen.length = 0;
    await requestCustomMessage(OPENAI, "gpt-6-sol", "sk-test", ask, { tools: TOOLS });
    assert.equal(seen.length, 1, "the refused field is not sent again");
    assert.ok(!("temperature" in seen[0].body));
    ok("gpt-6-sol sends reasoning_effort none with its tools, and a refused field is dropped once");
  }

  // --- without tools, reasoning_effort is never sent ----------------------
  {
    seen.length = 0;
    const result = await requestCustomMessage(OPENAI, "gpt-6-sol", "sk-test", ask, { tools: [], toolChoice: "none" });
    assert.ok(!result.error);
    assert.ok(!("reasoning_effort" in seen[0].body) && !("tools" in seen[0].body));
    ok("a tool-less call leaves the model's reasoning alone");
  }

  // --- gpt-4.1 is untouched -----------------------------------------------
  {
    seen.length = 0;
    const result = await requestCustomMessage(OPENAI, "gpt-4.1", "sk-test", ask, { tools: TOOLS, thinking: true });
    assert.ok(!result.error);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].path, "/v1/chat/completions");
    assert.ok(!("reasoning_effort" in seen[0].body));
    assert.equal(seen[0].body.tools.length, 1);
    ok("gpt-4.1 gets the same Chat Completions request as before");
  }

  // --- a model the table has never heard of learns from the refusal ------
  {
    seen.length = 0;
    const result = await requestCustomMessage(OPENAI, "gpt-6-nova", "sk-test", ask, { tools: TOOLS });
    assert.ok(!result.error, result.error ? await result.error.text() : "");
    // The fake refuses the story temperature first (as OpenAI's reasoning
    // models do), then the tools; both are learned.
    assert.deepEqual(seen.map((request) => request.path), ["/v1/chat/completions", "/v1/chat/completions", "/v1/responses"]);
    assert.ok(seen.slice(0, 2).every((request) => request.body.tools.length === 1), "every Chat Completions try kept its tools");
    seen.length = 0;
    await requestCustomMessage(OPENAI, "gpt-6-nova", "sk-test", ask, { tools: TOOLS });
    assert.deepEqual(seen.map((request) => request.path), ["/v1/responses"], "remembered");
    ok("an unknown GPT-6 model switches to the route its 400 names and remembers it");
  }

  // --- a proxy relaying the refusal learns the same way ------------------
  {
    seen.length = 0;
    const result = await requestCustomMessage("http://proxy.test/v1", "gpt-6.1-sol", "", ask, { tools: TOOLS });
    assert.ok(!result.error, result.error ? await result.error.text() : "");
    assert.equal(seen.at(-1).path, "/v1/responses");
    assert.ok(seen.slice(0, -1).every((request) => request.path === "/v1/chat/completions" && request.body.tools.length === 1));
    ok("a proxy that relays OpenAI's refusal is switched to /v1/responses too");
  }

  // --- the silent drop never happens ------------------------------------
  {
    // The named route fails too (no /v1/responses behind this proxy): the
    // turn must fail with the message, and no request may go out tool-less.
    seen.length = 0;
    const result = await requestCustomMessage("http://no-responses.test/v1", "gpt-6.1-sol", "", ask, { tools: TOOLS });
    assert.ok(result.error, "the turn was narrated without its tools");
    const detail = await result.error.json();
    assert.equal(result.error.status, 404);
    assert.ok(seen.every((request) => request.path.endsWith("/responses") || request.body.tools?.length), JSON.stringify(seen.map((r) => r.path)));
    assert.ok(seen.every((request) => request.path.endsWith("/chat/completions") ? request.body.tools?.length : true), "a tool-less chat request went out");
    assert.match(detail.error, /failed \(404\)/);
    ok("when no route works the turn fails loudly instead of running without tools");
  }

  // --- a local server without a tool template still gets the fallback ----
  {
    const seenLocal = [];
    globalThis.fetch = async (url, init) => {
      const body = JSON.parse(init.body);
      seenLocal.push(body);
      if (body.tools?.length) {
        return Response.json({ error: { message: "This server does not support tools" } }, { status: 400 });
      }
      return Response.json({ choices: [{ message: { role: "assistant", content: "plain prose" } }] });
    };
    const result = await requestCustomMessage("http://127.0.0.1:8001/v1", "qwen3.6-35b", "", ask, { tools: TOOLS });
    assert.equal(result.message?.content, "plain prose");
    assert.equal(seenLocal.length, 2);
    assert.ok(!seenLocal[1].tools, "the retry dropped the tools");
    globalThis.fetch = fakeOpenAi;
    ok("a local server with no function calling is still retried without tools");
  }
} finally {
  globalThis.fetch = realFetch;
}

// --- the translators on their own -------------------------------------------
{
  assert.equal(customResponsesEndpoint("https://api.openai.com/v1"), "https://api.openai.com/v1/responses");
  assert.equal(customResponsesEndpoint("https://api.openai.com/v1/chat/completions"), "https://api.openai.com/v1/responses");
  assert.equal(customResponsesEndpoint("http://proxy.test"), "http://proxy.test/v1/responses");
  assert.equal(customResponsesEndpoint("http://proxy.test/v1/responses/"), "http://proxy.test/v1/responses");

  const items = toResponsesInput([
    { role: "user", content: [{ type: "text", text: "Who is this?" }, { type: "image_url", image_url: { url: "data:image/png;base64,AAA" } }] },
    // A call the stream left without an id, answered by an id-less result.
    { role: "assistant", content: "", tool_calls: [{ type: "function", function: { name: "request_roll", arguments: '{"kind":"stealth"}' } }] },
    { role: "tool", content: '{"total":9}' },
    // A result with no call at all.
    { role: "tool", content: '{"note":"orphan"}' },
  ]);
  assert.deepEqual(items[0], {
    role: "user",
    content: [
      { type: "input_text", text: "Who is this?" },
      { type: "input_image", image_url: "data:image/png;base64,AAA", detail: "auto" },
    ],
  });
  assert.deepEqual(items[1], { type: "function_call", call_id: "call_odm_1", name: "request_roll", arguments: '{"kind":"stealth"}' });
  assert.deepEqual(items[2], { type: "function_call_output", call_id: "call_odm_1", output: '{"total":9}' });
  assert.deepEqual(items[3], { role: "user", content: '{"note":"orphan"}' });
  assert.equal(items.length, 4, "an empty assistant text adds no item");

  assert.deepEqual(toResponsesTools(TOOLS), [
    { type: "function", name: "request_roll", description: "Ask the server for a roll.", parameters: TOOLS[0].function.parameters, strict: false },
  ]);

  const message = fromResponsesOutput([
    { type: "reasoning", summary: [] },
    { type: "message", content: [{ type: "output_text", text: "A " }, { type: "refusal", refusal: "no." }] },
    { type: "function_call", call_id: "call_9", name: "apply_damage", arguments: "{}" },
    { type: "function_call", id: "fc_only", name: "end_turn", arguments: "{}" },
  ]);
  assert.equal(message.content, "A no.");
  assert.deepEqual(message.tool_calls, [
    { id: "call_9", type: "function", function: { name: "apply_damage", arguments: "{}" } },
    { id: "fc_only", type: "function", function: { name: "end_turn", arguments: "{}" } },
  ]);
  assert.deepEqual(fromResponsesOutput(undefined), { content: "" });
  ok("transcripts, tools and replies translate both ways");
}

fs.rmSync(dir, { recursive: true, force: true });
console.log(`openai-tool-routes: ${passed} tests passed`);
