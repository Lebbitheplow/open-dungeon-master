import { getGlobalConfig } from "@/lib/db/app-settings";
import { serverEnv } from "@/lib/server-env";
import { localModelContextWindow } from "@/lib/text-models";

// Shared chat-completion client for both providers:
// - custom: any OpenAI-compatible /chat/completions (llama.cpp, LM Studio,
//   vLLM, OpenRouter, remote Ollama), streaming SSE
// - local: Ollama /api/chat, streaming NDJSON
// Used by the solo narrator (/api/story) and the campaign DM loop.

const DEFAULT_MAX_OUTPUT_TOKENS = 16_384;
const MAX_CONFIGURABLE_OUTPUT_TOKENS = 65_536;
const DEFAULT_LOCAL_MAX_OUTPUT_TOKENS = 4_096;
const DEFAULT_CUSTOM_TEXT_TIMEOUT_MS = 3 * 60 * 1000;
const DEFAULT_LOCAL_TEXT_TIMEOUT_MS = 6 * 60 * 1000;
const MIN_TEXT_TIMEOUT_MS = 30 * 1000;
const MAX_TEXT_TIMEOUT_MS = 30 * 60 * 1000;
const WINDOWS_DEFAULT_LOCAL_CONTEXT_TOKENS = 65_536;

export type TextContentPart = {
  type: "text";
  text: string;
};

export type ImageContentPart = {
  type: "image_url";
  image_url: {
    url: string;
  };
};

export type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | Array<TextContentPart | ImageContentPart>;
  tool_calls?: unknown;
  tool_call_id?: string;
};

export type StreamDeltaHandler = (text: string) => void;

export type StreamedToolCall = {
  id?: string;
  type?: "function";
  function: { name: string; arguments: string };
};

export type UpstreamChatMessage = {
  content?: unknown;
  tool_calls?: unknown;
};

export type UpstreamResult = {
  message?: UpstreamChatMessage;
  error?: Response;
};

export type ChatRequestOptions = {
  tools?: readonly unknown[];
  toolChoice?: "auto" | "none";
  temperature?: number;
  onDelta?: StreamDeltaHandler;
  timeoutMs?: number;
  // Ask the backend for reasoning/thinking mode on this call. Qwen-family
  // models are unreliable tool callers without it under long prompts
  // (measured ~1/5 request_roll without vs ~4/5 with on qwen3.6-35b);
  // llama.cpp and vLLM honor chat_template_kwargs, other backends ignore
  // the unknown field. Reasoning deltas never reach onDelta: the stream
  // parser forwards only delta.content.
  thinking?: boolean;
};

export function configuredMaxOutputTokens() {
  const raw = serverEnv("OPENROUTER_MAX_TOKENS");
  const parsed = Number.parseInt(raw, 10);

  if (!Number.isFinite(parsed)) {
    return DEFAULT_MAX_OUTPUT_TOKENS;
  }

  return Math.max(512, Math.min(parsed, MAX_CONFIGURABLE_OUTPUT_TOKENS));
}

export function localMaxOutputTokens() {
  const parsed = Number.parseInt(serverEnv("LOCAL_TEXT_MAX_TOKENS"), 10);

  if (!Number.isFinite(parsed)) {
    return DEFAULT_LOCAL_MAX_OUTPUT_TOKENS;
  }

  return Math.max(256, Math.min(parsed, MAX_CONFIGURABLE_OUTPUT_TOKENS));
}

// Defaults to the model's full native window: Gemma 4's sliding-window
// attention keeps the KV cache small even at 256K, so memory is not the
// limiting factor. LOCAL_TEXT_CONTEXT can cap it to bound worst-case
// prefill time on very long stories.
export function localContextTokens(model: string) {
  const native = localModelContextWindow(model);
  const raw = serverEnv("LOCAL_TEXT_CONTEXT");
  const parsed = Number.parseInt(raw, 10);

  if (!Number.isFinite(parsed)) {
    return process.platform === "win32"
      ? Math.min(native, WINDOWS_DEFAULT_LOCAL_CONTEXT_TOKENS)
      : native;
  }

  return Math.max(2_048, Math.min(parsed, native));
}

export function resolveTextTimeoutMs(
  explicit: number | undefined,
  envKey: string,
  fallback: number,
) {
  const raw = explicit ?? Number.parseInt(serverEnv(envKey), 10);

  if (!Number.isFinite(raw)) {
    return fallback;
  }

  return Math.max(MIN_TEXT_TIMEOUT_MS, Math.min(raw, MAX_TEXT_TIMEOUT_MS));
}

// Story-arc generation and chapter summaries digest the whole story so far
// with no streaming, so the entire reply must land inside one timeout.
export function arcTextTimeoutMs() {
  return resolveTextTimeoutMs(undefined, "ARC_TEXT_TIMEOUT_MS", 8 * 60 * 1000);
}

function formatTimeout(ms: number) {
  const seconds = Math.round(ms / 1000);
  if (seconds >= 60) {
    const minutes = Math.round(seconds / 60);
    return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
  }

  return `${seconds} seconds`;
}

function createRequestTimeout(ms: number) {
  const controller = new AbortController();
  let timedOut = false;
  const abortNow = () => {
    timedOut = true;
    controller.abort();
  };
  const timeoutId = setTimeout(abortNow, ms);

  return {
    signal: controller.signal,
    clear: () => clearTimeout(timeoutId),
    timedOut: () => timedOut,
    abortNow,
  };
}

// Reads an upstream streaming body line by line with an idle timeout that
// resets on every chunk, so a stalled model server can't hold the turn open
// forever while a slow-but-alive one is given all the time it needs.
async function forEachStreamLine(
  upstream: Response,
  idleMs: number,
  onIdleAbort: () => void,
  onLine: (line: string) => void,
) {
  const reader = upstream.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  const resetIdle = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(onIdleAbort, idleMs);
  };

  resetIdle();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      resetIdle();
      buffer += decoder.decode(value, { stream: true });
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line) {
          onLine(line);
        }
        newline = buffer.indexOf("\n");
      }
    }
    buffer += decoder.decode();
    const rest = buffer.trim();
    if (rest) {
      onLine(rest);
    }
  } finally {
    clearTimeout(idleTimer);
  }
}

type OllamaChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  images?: string[];
  tool_calls?: unknown;
};

function toOllamaMessages(messages: ChatMessage[]): OllamaChatMessage[] {
  return messages.map((message) => {
    if (typeof message.content === "string") {
      return {
        role: message.role,
        content: message.content,
        ...(message.tool_calls ? { tool_calls: message.tool_calls } : {}),
      };
    }

    const textParts: string[] = [];
    const images: string[] = [];
    for (const part of message.content) {
      if (part.type === "text") {
        textParts.push(part.text);
        continue;
      }

      // Only data URLs reach this point; Ollama wants the bare base64 payload.
      const base64 = part.image_url.url.split(",")[1];
      if (base64) {
        images.push(base64);
      }
    }

    return {
      role: message.role,
      content: textParts.join("\n\n"),
      ...(images.length ? { images } : {}),
    };
  });
}

function hasImageParts(messages: ChatMessage[]) {
  return messages.some(
    (message) =>
      typeof message.content !== "string" &&
      message.content.some((part) => part.type === "image_url"),
  );
}

// Flatten multimodal messages to text-only for backends that can't take
// images (e.g. llama.cpp without an mmproj file). Portrait labels survive as
// text, so character continuity degrades gracefully instead of erroring.
function stripImageParts(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((message) => {
    if (typeof message.content === "string") {
      return message;
    }

    return {
      ...message,
      content: message.content
        .filter((part): part is TextContentPart => part.type === "text")
        .map((part) => part.text)
        .join("\n\n"),
    };
  });
}

// Resolve a user-entered backend URL to its /chat/completions endpoint.
// Accepts a bare host (http://127.0.0.1:8080), a versioned base (.../v1), or
// the full endpoint, so people can paste whatever their server prints.
export function customChatEndpoint(baseUrl: string): string {
  const url = baseUrl.trim().replace(/\/+$/, "");
  if (/\/chat\/completions$/.test(url)) return url;
  if (/\/v\d+$/.test(url)) return `${url}/chat/completions`;
  return `${url}/v1/chat/completions`;
}

// Any OpenAI-compatible server: llama.cpp, LM Studio, vLLM, TabbyAPI,
// KoboldCpp, OpenRouter, a remote Ollama, etc. The model name and base URL are
// per-chat settings; the key is optional (most local servers need none). When
// the URL is OpenRouter we add its attribution headers and fall back to the
// OPENROUTER_* env vars; otherwise the fallback is OPENAI_COMPAT_API_KEY.
export async function requestCustomMessage(
  baseUrl: string,
  model: string,
  apiKey: string,
  messages: ChatMessage[],
  options: ChatRequestOptions = {},
): Promise<UpstreamResult> {
  const { tools, toolChoice, temperature, onDelta } = options;
  const trimmedBase = (baseUrl || "").trim();

  if (!trimmedBase) {
    return {
      error: Response.json(
        {
          error:
            "No backend URL set. Add your server's URL (for example http://127.0.0.1:8080/v1) in Text Model settings.",
        },
        { status: 400 },
      ),
    };
  }

  const globalText = getGlobalConfig().text;
  const isOpenRouter = /(^|\.)openrouter\.ai/i.test(trimmedBase);
  const resolvedModel =
    (model || "").trim() ||
    globalText.customModel ||
    serverEnv("OPENAI_COMPAT_MODEL") ||
    (isOpenRouter ? serverEnv("OPENROUTER_MODEL", "google/gemini-3.5-flash") : "");

  if (!resolvedModel) {
    return {
      error: Response.json(
        {
          error:
            "No model name set. Enter the model your server serves in Text Model settings.",
        },
        { status: 400 },
      ),
    };
  }

  const endpoint = customChatEndpoint(trimmedBase);
  // Per-campaign key wins, then the admin-panel key, then the env vars.
  // Fallback keys belong to the admin-configured backend: attaching them to
  // any other URL would hand the server's key to whatever host a campaign's
  // settings point at. The OpenRouter env key is already host-gated above.
  const globalBase = (globalText.customBaseUrl || serverEnv("OPENAI_COMPAT_BASE_URL") || "").trim();
  const isGlobalBackend = Boolean(globalBase) && customChatEndpoint(globalBase) === endpoint;
  const resolvedKey =
    (apiKey || "").trim() ||
    (isGlobalBackend ? globalText.customApiKey : "") ||
    (isOpenRouter ? serverEnv("OPENROUTER_API_KEY") : "") ||
    (isGlobalBackend ? serverEnv("OPENAI_COMPAT_API_KEY") : "");
  const requestPayload: Record<string, unknown> = {
    model: resolvedModel,
    messages,
    // Thinking runs cooler per Qwen guidance; 0.9 there makes the thought
    // ramble past the point of ever emitting the tool call.
    temperature: temperature ?? (options.thinking ? 0.7 : 0.9),
    // Explicit 0 so a server-side sampler preset cannot override it: a
    // positive presence penalty over the long DM prompt suppresses the
    // tool-call token sequence (measured 2/5 vs 4/5 request_roll rate on
    // llama-server with the qwen preset's 1.5).
    presence_penalty: 0,
    max_tokens: configuredMaxOutputTokens(),
    ...(options.thinking ? { chat_template_kwargs: { enable_thinking: true } } : {}),
    ...(onDelta ? { stream: true } : {}),
  };

  if (tools?.length) {
    requestPayload.tools = tools;
    requestPayload.tool_choice = toolChoice ?? "auto";
  }

  const timeoutMs = resolveTextTimeoutMs(
    options.timeoutMs,
    "CUSTOM_TEXT_TIMEOUT_MS",
    DEFAULT_CUSTOM_TEXT_TIMEOUT_MS,
  );
  const requestTimeout = createRequestTimeout(timeoutMs);
  let upstream: Response;
  try {
    upstream = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(resolvedKey ? { Authorization: `Bearer ${resolvedKey}` } : {}),
        ...(isOpenRouter
          ? {
              "HTTP-Referer": serverEnv("OPENROUTER_APP_URL", "http://localhost:3000"),
              "X-Title": serverEnv("OPENROUTER_APP_TITLE", "Open Dungeon Master"),
            }
          : {}),
      },
      body: JSON.stringify(requestPayload),
      signal: requestTimeout.signal,
    });
  } catch {
    if (requestTimeout.timedOut()) {
      return {
        error: Response.json(
          {
            error: `${isOpenRouter ? "OpenRouter" : "Backend"} request timed out after ${formatTimeout(timeoutMs)}. The server may still be generating in the background; wait a moment, then retry or lower that backend's context/output settings.`,
          },
          { status: 504 },
        ),
      };
    }

    return {
      error: Response.json(
        {
          error: `Could not reach the backend at ${endpoint}. Check the URL and that your server is running.`,
        },
        { status: 502 },
      ),
    };
  } finally {
    requestTimeout.clear();
  }

  if (!upstream.ok) {
    const text = await upstream.text();

    // Some servers can't accept image inputs at all (llama.cpp without an
    // mmproj, plain text models); retry the turn with text-only messages.
    if (hasImageParts(messages) && /image input|mmproj|image_url|vision/i.test(text)) {
      return requestCustomMessage(
        trimmedBase,
        resolvedModel,
        apiKey,
        stripImageParts(messages),
        options,
      );
    }

    // Some servers don't implement function tools; retry without them.
    if (tools?.length && /tool|function|not support/i.test(text)) {
      return requestCustomMessage(trimmedBase, resolvedModel, apiKey, messages, {
        ...options,
        tools: undefined,
        toolChoice: undefined,
      });
    }

    return {
      error: Response.json(
        {
          error: `${isOpenRouter ? "OpenRouter" : "Backend"} request failed (${upstream.status}).`,
          detail: text.slice(0, 300),
        },
        { status: upstream.status },
      ),
    };
  }

  if (onDelta && upstream.body) {
    // OpenAI-compatible SSE: "data: {...}" lines carrying content and
    // tool-call fragments, terminated by "data: [DONE]".
    const contentParts: string[] = [];
    const toolCalls: Array<StreamedToolCall | undefined> = [];
    let upstreamError = "";

    try {
      await forEachStreamLine(upstream, timeoutMs, requestTimeout.abortNow, (line) => {
        if (!line.startsWith("data:")) {
          return;
        }
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") {
          return;
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(payload);
        } catch {
          return;
        }
        const record = parsed as {
          choices?: Array<{ delta?: { content?: unknown; tool_calls?: unknown } }>;
          error?: { message?: string } | string;
        };
        if (record.error) {
          upstreamError =
            typeof record.error === "string"
              ? record.error
              : record.error.message || "The backend reported a stream error.";
          return;
        }
        const delta = record.choices?.[0]?.delta;
        if (typeof delta?.content === "string" && delta.content) {
          contentParts.push(delta.content);
          onDelta(delta.content);
        }
        if (Array.isArray(delta?.tool_calls)) {
          for (const call of delta.tool_calls) {
            const raw = call as {
              index?: number;
              id?: unknown;
              function?: { name?: unknown; arguments?: unknown };
            };
            const index = typeof raw.index === "number" ? raw.index : 0;
            const target = (toolCalls[index] ??= {
              type: "function",
              function: { name: "", arguments: "" },
            });
            if (typeof raw.id === "string" && raw.id) {
              target.id = raw.id;
            }
            if (typeof raw.function?.name === "string") {
              target.function.name += raw.function.name;
            }
            if (typeof raw.function?.arguments === "string") {
              target.function.arguments += raw.function.arguments;
            }
          }
        }
      });
    } catch {
      return {
        error: Response.json(
          {
            error: requestTimeout.timedOut()
              ? `${isOpenRouter ? "OpenRouter" : "Backend"} stream stalled for ${formatTimeout(timeoutMs)}. Retry, or lower that backend's context/output settings.`
              : `The ${isOpenRouter ? "OpenRouter" : "backend"} stream was interrupted. Check the server and retry.`,
          },
          { status: requestTimeout.timedOut() ? 504 : 502 },
        ),
      };
    }

    if (upstreamError) {
      return {
        error: Response.json(
          {
            error: `${isOpenRouter ? "OpenRouter" : "Backend"} stream failed.`,
            detail: upstreamError.slice(0, 300),
          },
          { status: 502 },
        ),
      };
    }

    const completedToolCalls = toolCalls.filter(Boolean) as StreamedToolCall[];
    return {
      message: {
        content: contentParts.join(""),
        ...(completedToolCalls.length ? { tool_calls: completedToolCalls } : {}),
      },
    };
  }

  let data: { choices?: Array<{ message?: UpstreamChatMessage }> };
  try {
    data = (await upstream.json()) as typeof data;
  } catch {
    return {
      error: Response.json(
        { error: "The backend returned an unreadable response." },
        { status: 502 },
      ),
    };
  }

  return { message: data?.choices?.[0]?.message };
}

export async function requestLocalMessage(
  model: string,
  messages: ChatMessage[],
  options: ChatRequestOptions & { disableThinking?: boolean } = {},
): Promise<UpstreamResult> {
  const { tools, temperature, onDelta } = options;
  const disableThinking = options.disableThinking ?? true;
  const baseUrl = serverEnv("OLLAMA_BASE_URL", "http://127.0.0.1:11434").replace(/\/$/, "");
  const requestPayload: Record<string, unknown> = {
    model,
    messages: toOllamaMessages(messages),
    stream: Boolean(onDelta),
    // Keep the model (and the story's prompt cache) resident between turns.
    keep_alive: "30m",
    options: {
      temperature: temperature ?? 0.9,
      num_predict: localMaxOutputTokens(),
      num_ctx: localContextTokens(model),
    },
  };

  // Gemma 4 is a hybrid reasoning model; without this it spends most of the
  // token budget on a hidden "thinking" channel before any story text.
  if (disableThinking) {
    requestPayload.think = false;
  }

  if (tools?.length) {
    requestPayload.tools = tools;
  }

  const timeoutMs = resolveTextTimeoutMs(
    options.timeoutMs,
    "LOCAL_TEXT_TIMEOUT_MS",
    DEFAULT_LOCAL_TEXT_TIMEOUT_MS,
  );
  const requestTimeout = createRequestTimeout(timeoutMs);
  let upstream: Response;
  try {
    upstream = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestPayload),
      signal: requestTimeout.signal,
    });
  } catch {
    if (requestTimeout.timedOut()) {
      return {
        error: Response.json(
          {
            error: `The local model took longer than ${formatTimeout(timeoutMs)} to answer. Ollama may still be working in the background; wait a moment, then retry, restart Ollama if your fans stay high, or lower LOCAL_TEXT_CONTEXT / LOCAL_TEXT_MAX_TOKENS.`,
          },
          { status: 504 },
        ),
      };
    }

    return {
      error: Response.json(
        {
          error: `Could not reach Ollama at ${baseUrl}. Start the Ollama app (or \`ollama serve\`), pull the model with \`ollama pull ${model}\`, or switch this chat to a custom backend (LM Studio, llama.cpp, OpenRouter, ...) in Text Model settings.`,
        },
        { status: 502 },
      ),
    };
  } finally {
    requestTimeout.clear();
  }

  if (!upstream.ok) {
    const text = await upstream.text();

    // Some local models lack a tool-call template; retry the turn without tools.
    if (tools?.length && /does not support tools/i.test(text)) {
      return requestLocalMessage(model, messages, { ...options, tools: undefined });
    }

    // Models without a thinking channel reject the think parameter; retry without it.
    if (disableThinking && /does not support think/i.test(text)) {
      return requestLocalMessage(model, messages, { ...options, disableThinking: false });
    }

    const hint = /not found/i.test(text)
      ? ` The model is not installed — run \`ollama pull ${model}\`.`
      : "";
    return {
      error: Response.json(
        {
          error: `Local model request failed (${upstream.status}).${hint}`,
          detail: text.slice(0, 300),
        },
        { status: 502 },
      ),
    };
  }

  if (onDelta && upstream.body) {
    // Ollama streams NDJSON: one JSON object per line with message.content
    // fragments; tool calls arrive whole on whichever line carries them.
    const contentParts: string[] = [];
    const toolCalls: unknown[] = [];
    let upstreamError = "";

    try {
      await forEachStreamLine(upstream, timeoutMs, requestTimeout.abortNow, (line) => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(line);
        } catch {
          return;
        }
        const record = parsed as {
          message?: { content?: unknown; tool_calls?: unknown };
          error?: unknown;
        };
        if (record.error) {
          upstreamError = String(record.error);
          return;
        }
        if (typeof record.message?.content === "string" && record.message.content) {
          contentParts.push(record.message.content);
          onDelta(record.message.content);
        }
        if (Array.isArray(record.message?.tool_calls)) {
          toolCalls.push(...record.message.tool_calls);
        }
      });
    } catch {
      return {
        error: Response.json(
          {
            error: requestTimeout.timedOut()
              ? `The local model stalled for ${formatTimeout(timeoutMs)} mid-passage. Ollama may still be working; wait a moment, then retry, or lower LOCAL_TEXT_CONTEXT / LOCAL_TEXT_MAX_TOKENS.`
              : "The local model stream was interrupted. Check that Ollama is still running and retry.",
          },
          { status: requestTimeout.timedOut() ? 504 : 502 },
        ),
      };
    }

    if (upstreamError) {
      return {
        error: Response.json(
          {
            error: "Local model stream failed.",
            detail: upstreamError.slice(0, 300),
          },
          { status: 502 },
        ),
      };
    }

    return {
      message: {
        content: contentParts.join(""),
        ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
      },
    };
  }

  let data: { message?: UpstreamChatMessage };
  try {
    data = (await upstream.json()) as typeof data;
  } catch {
    return {
      error: Response.json(
        { error: "The backend returned an unreadable response." },
        { status: 502 },
      ),
    };
  }
  return { message: data?.message };
}
