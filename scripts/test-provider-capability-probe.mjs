import assert from "node:assert/strict";
import http from "node:http";
import { probeBackend, chatEndpoint, responsesEndpoint } from "./lib/provider-capability-probe.mjs";

assert.equal(chatEndpoint("http://127.0.0.1:8080"), "http://127.0.0.1:8080/v1/chat/completions");
assert.equal(chatEndpoint("http://127.0.0.1:8080/v1"), "http://127.0.0.1:8080/v1/chat/completions");
assert.equal(chatEndpoint("http://127.0.0.1:8080/v1/chat/completions"), "http://127.0.0.1:8080/v1/chat/completions");
assert.equal(responsesEndpoint("https://api.openai.com/v1"), "https://api.openai.com/v1/responses");
assert.equal(responsesEndpoint("https://api.openai.com/v1/chat/completions"), "https://api.openai.com/v1/responses");
assert.throws(() => chatEndpoint("file:///tmp/model"), /http or https/);

// A fake OpenAI-compatible server. Three models:
// - mock-model: plain Chat Completions, tools and all;
// - gpt-6-sol: tools on Chat Completions only with reasoning_effort "none",
//   refused with a 400 that names that fix (issue #129);
// - gpt-6.1-sol: tools refused on Chat Completions with the 400 OpenAI
//   sends, pointing at /v1/responses, which this server also serves.
const requests = [];
const server = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  requests.push({ path: req.url, body });
  res.setHeader("Content-Type", body.stream ? "text/event-stream" : "application/json");

  if (req.url.endsWith("/responses")) {
    if (body.stream) {
      res.write(`data: ${JSON.stringify({ type: "response.output_text.delta", delta: "Привет" })}\n\n`);
      res.end(`data: ${JSON.stringify({ type: "response.completed", response: { status: "completed", output: [] } })}\n\n`);
      return;
    }
    const answered = body.input.some((item) => item.type === "function_call_output");
    res.end(JSON.stringify({
      status: "completed",
      output: answered
        ? [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "Инструмент подтверждён." }] }]
        : [{ type: "function_call", id: "fc_1", call_id: "call_1", name: "probe_echo", arguments: JSON.stringify({ word: "куб", n: 7 }) }],
    }));
    return;
  }

  if (body.tools?.length && body.model === "gpt-6.1-sol") {
    res.statusCode = 400;
    res.end(JSON.stringify({ error: { message: "Function tools with reasoning_effort are not supported for gpt-6.1-sol in /v1/chat/completions. To use function tools, use /v1/responses or set reasoning_effort to 'none'." } }));
    return;
  }
  if (body.tools?.length && body.model === "gpt-6-sol" && body.reasoning_effort !== "none") {
    res.statusCode = 400;
    res.end(JSON.stringify({ error: { message: "Function tools need reasoning off on this model. Set reasoning_effort to 'none'." } }));
    return;
  }

  if (body.stream) {
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "Привет" } }] })}\n\n`);
    res.end("data: [DONE]\n\n");
    return;
  }

  const last = body.messages.at(-1);
  if (last?.role === "tool") {
    res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: "Инструмент подтверждён." } }] }));
    return;
  }

  res.end(JSON.stringify({
    choices: [{
      message: {
        role: "assistant",
        content: null,
        tool_calls: [{
          id: "call-1",
          type: "function",
          function: { name: "probe_echo", arguments: JSON.stringify({ word: "куб", n: 7 }) },
        }],
      },
    }],
  }));
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
try {
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  const result = await probeBackend({ baseUrl, model: "mock-model", timeoutMs: 2_000 });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.route, "chat");
  assert.equal(result.stages.streaming.sample, "Привет");
  assert.deepEqual(result.stages.toolCall.arguments, { word: "куб", n: 7 });
  assert.equal(requests.length, 3);
  assert.equal(requests[2].body.messages.at(-1).role, "tool");
  assert.ok(requests.every((request) => !("reasoning_effort" in request.body)), "a plain model's reasoning is left alone");
  console.log("provider-capability-probe: streaming, structured tool call, and continuation passed");

  // The refusal that names reasoning_effort "none": the probe retries on
  // that route and reports it, as the server would learn it mid-campaign.
  requests.length = 0;
  const sol = await probeBackend({ baseUrl, model: "gpt-6-sol", timeoutMs: 2_000 });
  assert.equal(sol.ok, true, JSON.stringify(sol));
  assert.equal(sol.route, "chat-no-reasoning");
  assert.equal(sol.endpoint, `${baseUrl}/v1/chat/completions`);
  const toolRequests = requests.filter((request) => request.body.tools?.length);
  assert.equal(toolRequests[0].body.reasoning_effort, undefined, "the first try was plain");
  assert.ok(toolRequests.slice(1).every((request) => request.body.reasoning_effort === "none"));
  assert.ok(requests.filter((r) => !r.body.tools?.length).every((r) => !("reasoning_effort" in r.body)), "streaming prose keeps reasoning");
  console.log("provider-capability-probe: a refusal naming reasoning_effort none is retried with it");

  // The refusal that names /v1/responses: the whole probe reruns there.
  requests.length = 0;
  const sol61 = await probeBackend({ baseUrl, model: "gpt-6.1-sol", timeoutMs: 2_000 });
  assert.equal(sol61.ok, true, JSON.stringify(sol61));
  assert.equal(sol61.route, "responses");
  assert.equal(sol61.endpoint, `${baseUrl}/v1/responses`);
  assert.equal(sol61.stages.streaming.sample, "Привет");
  assert.deepEqual(sol61.stages.toolCall.arguments, { word: "куб", n: 7 });
  assert.equal(sol61.stages.toolContinuation.sample, "Инструмент подтверждён.");
  const onResponses = requests.filter((request) => request.path.endsWith("/responses"));
  assert.equal(onResponses.length, 3, "all three stages reran on Responses");
  assert.ok(onResponses.every((request) => request.body.store === false));
  const continuation = onResponses[2].body.input;
  assert.equal(continuation.at(-2).type, "function_call");
  assert.equal(continuation.at(-1).type, "function_call_output");
  assert.equal(continuation.at(-1).call_id, "call_1");
  assert.equal(onResponses[1].body.tools[0].strict, false);
  console.log("provider-capability-probe: a refusal naming /v1/responses reruns the probe there");
} finally {
  await new Promise((resolve) => server.close(resolve));
}
