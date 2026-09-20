import assert from "node:assert/strict";
import http from "node:http";
import { probeBackend, chatEndpoint } from "./lib/provider-capability-probe.mjs";

assert.equal(chatEndpoint("http://127.0.0.1:8080"), "http://127.0.0.1:8080/v1/chat/completions");
assert.equal(chatEndpoint("http://127.0.0.1:8080/v1"), "http://127.0.0.1:8080/v1/chat/completions");
assert.equal(chatEndpoint("http://127.0.0.1:8080/v1/chat/completions"), "http://127.0.0.1:8080/v1/chat/completions");
assert.throws(() => chatEndpoint("file:///tmp/model"), /http or https/);

const requests = [];
const server = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  requests.push(body);
  res.setHeader("Content-Type", body.stream ? "text/event-stream" : "application/json");

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
  const result = await probeBackend({ baseUrl: `http://127.0.0.1:${port}`, model: "mock-model", timeoutMs: 2_000 });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.stages.streaming.sample, "Привет");
  assert.deepEqual(result.stages.toolCall.arguments, { word: "куб", n: 7 });
  assert.equal(requests.length, 3);
  assert.equal(requests[2].messages.at(-1).role, "tool");
  console.log("provider-capability-probe: streaming, structured tool call, and continuation passed");
} finally {
  await new Promise((resolve) => server.close(resolve));
}
