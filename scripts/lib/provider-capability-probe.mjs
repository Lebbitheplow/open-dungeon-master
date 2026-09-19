function chatEndpoint(baseUrl) {
  const value = String(baseUrl || "").trim().replace(/\/+$/, "");
  if (!value) throw new Error("Backend URL is required.");
  const parsed = new URL(value);
  if (!/^https?:$/.test(parsed.protocol)) throw new Error("Backend URL must use http or https.");
  if (/\/chat\/completions$/.test(value)) return value;
  if (/\/v\d+$/.test(value)) return `${value}/chat/completions`;
  return `${value}/v1/chat/completions`;
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

async function readSseText(response) {
  if (!response.body) throw new Error("Streaming response had no body.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
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
            const parsed = JSON.parse(payload);
            const delta = parsed?.choices?.[0]?.delta?.content;
            if (typeof delta === "string") text += delta;
          } catch {
            // Ignore non-JSON keepalive lines.
          }
        }
      }
      newline = buffer.indexOf("\n");
    }
  }
  return text;
}

export async function probeBackend({ baseUrl, model, apiKey = "", timeoutMs = 20_000 }) {
  if (!String(model || "").trim()) throw new Error("Model name is required.");
  const endpoint = chatEndpoint(baseUrl);
  const stages = {};

  const streamed = await postJson(
    endpoint,
    apiKey,
    {
      model,
      stream: true,
      messages: [
        { role: "system", content: "Reply briefly in Russian." },
        { role: "user", content: "Скажи одно короткое приветствие." },
      ],
    },
    timeoutMs,
  );
  const streamText = await readSseText(streamed);
  stages.streaming = { ok: Boolean(streamText.trim()), sample: streamText.trim().slice(0, 120) };

  const tool = {
    type: "function",
    function: {
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
    },
  };
  const toolResponse = await postJson(
    endpoint,
    apiKey,
    {
      model,
      stream: false,
      messages: [
        { role: "system", content: "You must use the supplied function tool when asked." },
        { role: "user", content: "Call probe_echo with word=куб and n=7. Do not answer in prose." },
      ],
      tools: [tool],
      tool_choice: "auto",
    },
    timeoutMs,
  );
  const toolPayload = await toolResponse.json();
  const assistant = toolPayload?.choices?.[0]?.message;
  const call = Array.isArray(assistant?.tool_calls) ? assistant.tool_calls[0] : null;
  let args = null;
  try {
    args = JSON.parse(call?.function?.arguments || "");
  } catch {
    args = null;
  }
  const toolOk = call?.function?.name === "probe_echo" && args?.word === "куб" && args?.n === 7;
  stages.toolCall = {
    ok: toolOk,
    name: call?.function?.name || null,
    arguments: args,
  };

  let continuationOk = false;
  let continuationSample = "";
  if (toolOk) {
    const continuation = await postJson(
      endpoint,
      apiKey,
      {
        model,
        stream: false,
        messages: [
          { role: "system", content: "You must use the supplied function tool when asked." },
          { role: "user", content: "Call probe_echo with word=куб and n=7. Do not answer in prose." },
          assistant,
          { role: "tool", tool_call_id: call.id || "probe-call", content: JSON.stringify({ ok: true, echo: args }) },
        ],
        tools: [tool],
        tool_choice: "auto",
      },
      timeoutMs,
    );
    const payload = await continuation.json();
    const content = payload?.choices?.[0]?.message?.content;
    continuationSample = typeof content === "string" ? content.trim().slice(0, 120) : "";
    continuationOk = Boolean(continuationSample);
  }
  stages.toolContinuation = { ok: continuationOk, sample: continuationSample };

  return {
    ok: stages.streaming.ok && stages.toolCall.ok && stages.toolContinuation.ok,
    endpoint,
    model,
    stages,
  };
}

export { chatEndpoint };
