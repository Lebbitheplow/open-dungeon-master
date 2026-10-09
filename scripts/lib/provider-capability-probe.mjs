import { openAiToolRoute, toolRouteFromError } from "./openai-tool-route.mjs";

function cleanBase(baseUrl) {
  const value = String(baseUrl || "").trim().replace(/\/+$/, "");
  if (!value) throw new Error("Backend URL is required.");
  const parsed = new URL(value);
  if (!/^https?:$/.test(parsed.protocol)) throw new Error("Backend URL must use http or https.");
  return value;
}

function chatEndpoint(baseUrl) {
  const value = cleanBase(baseUrl);
  if (/\/chat\/completions$/.test(value)) return value;
  if (/\/v\d+$/.test(value)) return `${value}/chat/completions`;
  return `${value}/v1/chat/completions`;
}

// The same base, resolved to OpenAI's Responses endpoint (the sibling of
// customResponsesEndpoint in src/lib/openai-responses.ts).
function responsesEndpoint(baseUrl) {
  const value = cleanBase(baseUrl).replace(/\/chat\/completions$/, "");
  if (/\/responses$/.test(value)) return value;
  if (/\/v\d+$/.test(value)) return `${value}/responses`;
  return `${value}/v1/responses`;
}

function isOpenAiHost(baseUrl) {
  const host = new URL(cleanBase(baseUrl)).hostname.toLowerCase();
  return host === "openai.com" || host.endsWith(".openai.com");
}

async function postJson(endpoint, apiKey, body, timeoutMs) {
  const response = await fetch(endpoint, {
    method: "POST",
    redirect: "manual",
    headers: {
      "Content-Type": "application/json",
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (response.status >= 300 && response.status < 400) {
    throw new Error(`Backend redirected the authenticated request (${response.status}); redirects are not followed.`);
  }
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300);
    throw new Error(`Backend request failed (${response.status})${detail ? `: ${detail}` : ""}`);
  }
  return response;
}

// Streams an SSE body and hands every "data:" JSON object to `onEvent`.
async function readSse(response, onEvent) {
  if (!response.body) throw new Error("Streaming response had no body.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line.startsWith("data:")) {
        const payload = line.slice(5).trim();
        if (payload && payload !== "[DONE]") {
          try {
            onEvent(JSON.parse(payload));
          } catch {
            // Ignore non-JSON keepalive lines.
          }
        }
      }
      newline = buffer.indexOf("\n");
    }
  }
}

const GREETING = [
  { role: "system", content: "Reply briefly in Russian." },
  { role: "user", content: "Скажи одно короткое приветствие." },
];
const TOOL_ASK = [
  { role: "system", content: "You must use the supplied function tool when asked." },
  { role: "user", content: "Call probe_echo with word=куб and n=7. Do not answer in prose." },
];
const TOOL_FUNCTION = {
  name: "probe_echo",
  description: "Return the exact structured values requested by the compatibility probe.",
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      word: { type: "string" },
      n: { type: "integer" },
    },
    required: ["word", "n"],
  },
};

function parseArgs(raw) {
  try {
    return JSON.parse(raw || "");
  } catch {
    return null;
  }
}

// Chat Completions, as every OpenAI-compatible server speaks it. On the
// "chat-no-reasoning" route the tool requests carry reasoning_effort "none",
// which is what lets GPT-6 Sol and Luna call tools there (issue #129).
function chatTransport(baseUrl, apiKey, model, route, timeoutMs) {
  const endpoint = chatEndpoint(baseUrl);
  const tool = { type: "function", function: TOOL_FUNCTION };
  const toolFields = {
    tools: [tool],
    tool_choice: "auto",
    ...(route === "chat-no-reasoning" ? { reasoning_effort: "none" } : {}),
  };
  return {
    route,
    endpoint,
    async streamText() {
      const response = await postJson(endpoint, apiKey, { model, stream: true, messages: GREETING }, timeoutMs);
      let text = "";
      await readSse(response, (event) => {
        const delta = event?.choices?.[0]?.delta?.content;
        if (typeof delta === "string") text += delta;
      });
      return text;
    },
    async toolCall() {
      const response = await postJson(
        endpoint,
        apiKey,
        { model, stream: false, messages: TOOL_ASK, ...toolFields },
        timeoutMs,
      );
      const payload = await response.json();
      const assistant = payload?.choices?.[0]?.message;
      const call = Array.isArray(assistant?.tool_calls) ? assistant.tool_calls[0] : null;
      return {
        name: call?.function?.name || null,
        args: parseArgs(call?.function?.arguments),
        replay: (result) => [
          ...TOOL_ASK,
          assistant,
          { role: "tool", tool_call_id: call?.id || "probe-call", content: JSON.stringify(result) },
        ],
      };
    },
    async continuation(messages) {
      const response = await postJson(
        endpoint,
        apiKey,
        { model, stream: false, messages, ...toolFields },
        timeoutMs,
      );
      const payload = await response.json();
      const content = payload?.choices?.[0]?.message?.content;
      return typeof content === "string" ? content : "";
    },
  };
}

// OpenAI's Responses API, the only place GPT-6.1 Sol and GPT-6 Astra run
// function tools. Same three stages in its own shapes (input items, flat
// tool definitions, typed stream events), mirroring
// src/lib/openai-responses.ts.
function responsesTransport(baseUrl, apiKey, model, timeoutMs) {
  const endpoint = responsesEndpoint(baseUrl);
  const toolFields = { tools: [{ type: "function", ...TOOL_FUNCTION, strict: false }], tool_choice: "auto" };
  return {
    route: "responses",
    endpoint,
    async streamText() {
      const response = await postJson(
        endpoint,
        apiKey,
        { model, stream: true, store: false, input: GREETING },
        timeoutMs,
      );
      let text = "";
      await readSse(response, (event) => {
        if (event?.type === "response.output_text.delta" && typeof event.delta === "string") {
          text += event.delta;
        }
      });
      return text;
    },
    async toolCall() {
      const response = await postJson(
        endpoint,
        apiKey,
        { model, store: false, input: TOOL_ASK, ...toolFields },
        timeoutMs,
      );
      const payload = await response.json();
      const output = Array.isArray(payload?.output) ? payload.output : [];
      const call = output.find((item) => item?.type === "function_call") ?? null;
      return {
        name: call?.name || null,
        args: parseArgs(call?.arguments),
        replay: (result) => [
          ...TOOL_ASK,
          {
            type: "function_call",
            call_id: call?.call_id || "probe-call",
            name: call?.name || "probe_echo",
            arguments: call?.arguments || "{}",
          },
          { type: "function_call_output", call_id: call?.call_id || "probe-call", output: JSON.stringify(result) },
        ],
      };
    },
    async continuation(input) {
      const response = await postJson(endpoint, apiKey, { model, store: false, input, ...toolFields }, timeoutMs);
      const payload = await response.json();
      const output = Array.isArray(payload?.output) ? payload.output : [];
      return output
        .filter((item) => item?.type === "message" && Array.isArray(item.content))
        .flatMap((item) => item.content)
        .filter((part) => part?.type === "output_text" && typeof part.text === "string")
        .map((part) => part.text)
        .join("");
    },
  };
}

function transportFor(route, baseUrl, apiKey, model, timeoutMs) {
  return route === "responses"
    ? responsesTransport(baseUrl, apiKey, model, timeoutMs)
    : chatTransport(baseUrl, apiKey, model, route, timeoutMs);
}

async function runStages(transport) {
  const stages = {};
  const streamText = await transport.streamText();
  stages.streaming = { ok: Boolean(streamText.trim()), sample: streamText.trim().slice(0, 120) };

  const call = await transport.toolCall();
  const toolOk = call.name === "probe_echo" && call.args?.word === "куб" && call.args?.n === 7;
  stages.toolCall = { ok: toolOk, name: call.name, arguments: call.args };

  let continuationOk = false;
  let continuationSample = "";
  if (toolOk) {
    const content = await transport.continuation(call.replay({ ok: true, echo: call.args }));
    continuationSample = content.trim().slice(0, 120);
    continuationOk = Boolean(continuationSample);
  }
  stages.toolContinuation = { ok: continuationOk, sample: continuationSample };
  return stages;
}

// Tries a backend the way the DM loop uses it: a streamed reply, a real
// structured tool call, and a continuation after the tool result. The
// route is what the model's name says on OpenAI's own host; any other
// server starts on plain Chat Completions and, when its refusal names a
// route (reasoning_effort "none", or /v1/responses), is tried once more on
// that route, exactly as model-client.ts would learn it mid-campaign.
export async function probeBackend({ baseUrl, model, apiKey = "", timeoutMs = 20_000 }) {
  if (!String(model || "").trim()) throw new Error("Model name is required.");
  let route = isOpenAiHost(baseUrl) ? openAiToolRoute(model) : "chat";
  let transport = transportFor(route, baseUrl, apiKey, model, timeoutMs);
  let stages;
  try {
    stages = await runStages(transport);
  } catch (error) {
    const asked = toolRouteFromError(error instanceof Error ? error.message : String(error));
    if (!asked || asked === route) throw error;
    route = asked;
    transport = transportFor(route, baseUrl, apiKey, model, timeoutMs);
    stages = await runStages(transport);
  }

  return {
    ok: stages.streaming.ok && stages.toolCall.ok && stages.toolContinuation.ok,
    endpoint: transport.endpoint,
    model,
    route,
    stages,
  };
}

export { chatEndpoint, responsesEndpoint };
