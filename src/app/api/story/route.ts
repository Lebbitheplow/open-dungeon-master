import { z } from "zod";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  addMessage,
  getStorySummary,
  listCharacters,
  setStorySummary,
  updateChatTitleFromInput,
} from "@/lib/db";
import { serverEnv } from "@/lib/server-env";
import {
  buildStoryMessages,
  createStreamingArtifactFilter,
  extractStoryText,
  packStoryHistory,
} from "@/lib/story-prompt";
import {
  DEFAULT_LOCAL_TEXT_MODEL,
  LOCAL_TEXT_MODEL_IDS,
  localModelContextWindow,
} from "@/lib/text-models";
import { PROSE_SIZE_VALUES } from "@/lib/types";
import type { Attachment, StoryCharacter, StoryMessage } from "@/lib/types";

export const runtime = "nodejs";

const MAX_IMAGE_REFERENCES = 2;
const DEFAULT_MAX_OUTPUT_TOKENS = 16_384;
const MAX_CONFIGURABLE_OUTPUT_TOKENS = 65_536;
const DEFAULT_LOCAL_MAX_OUTPUT_TOKENS = 4_096;
const DEFAULT_CUSTOM_TEXT_TIMEOUT_MS = 3 * 60 * 1000;
const DEFAULT_LOCAL_TEXT_TIMEOUT_MS = 6 * 60 * 1000;
const MIN_TEXT_TIMEOUT_MS = 30 * 1000;
const MAX_TEXT_TIMEOUT_MS = 30 * 60 * 1000;
const WINDOWS_DEFAULT_LOCAL_CONTEXT_TOKENS = 65_536;
// Rough chars-per-token for English prose, used to budget story history.
const HISTORY_CHARS_PER_TOKEN = 3.6;
// Tokens held back for the system prompt, character portraits, and the reply.
const HISTORY_RESERVE_TOKENS = 8_192;
// Stay comfortably under the context window so a turn can never max it out.
const CONTEXT_SAFETY_MARGIN = 0.9;
const MIN_HISTORY_CHAR_BUDGET = 48_000;
// History budget for remote/custom backends, whose context window we can't
// introspect. ~43K tokens; long stories still compact via the rolling summary.
const REMOTE_HISTORY_CHAR_BUDGET = 172_800;
const supportedVisionTypes = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

type TextContentPart = {
  type: "text";
  text: string;
};

type ImageContentPart = {
  type: "image_url";
  image_url: {
    url: string;
  };
};

type OpenRouterMessage = {
  role: "system" | "user" | "assistant";
  content: string | Array<TextContentPart | ImageContentPart>;
};

const attachmentSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  url: z.string(),
  dataUrl: z.string().optional(),
});

const messageSchema = z.object({
  id: z.string(),
  role: z.enum(["user", "assistant"]),
  content: z.string(),
  createdAt: z.string(),
  attachments: z.array(attachmentSchema).optional(),
});

const requestSchema = z.object({
  chatId: z.string().optional(),
  userMessageId: z.string().optional(),
  // turn     — a normal player action; the input is persisted as a user message.
  // kickoff  — write the opening passage from a directive (not persisted).
  // continue — advance the story with no player action (not persisted).
  // retry    — regenerate the latest passage; input is the prior player action,
  //            already saved, so it is not persisted again.
  // opening — the player wrote the first passage themselves; store it verbatim
  //           as the opening narration, with no model call.
  mode: z.enum(["turn", "kickoff", "continue", "retry", "opening"]).default("turn"),
  // When true the narration is delivered as NDJSON events (delta/done/error)
  // instead of a single JSON body. Opening mode and request-level failures
  // still answer with plain JSON.
  stream: z.boolean().default(false),
  input: z.string().min(1),
  messages: z.array(messageSchema).default([]),
  attachments: z.array(attachmentSchema).default([]),
  settings: z.object({
    world: z.string().default(""),
    style: z.string().default(""),
    textProvider: z.enum(["local", "custom"]).default("local"),
    localTextModel: z.enum(LOCAL_TEXT_MODEL_IDS).default(DEFAULT_LOCAL_TEXT_MODEL),
    customBaseUrl: z.string().trim().max(500).default(""),
    customModel: z.string().trim().max(200).default(""),
    customApiKey: z.string().trim().max(400).default(""),
    imageMode: z.enum(["fast", "slow"]).default("slow"),
    imageBackend: z.enum(["mflux-hs", "sdnq-hs", "comfyui"]).default("mflux-hs"),
    comfyUrl: z.string().trim().max(500).default(""),
    comfyCheckpoint: z.string().trim().max(300).default(""),
    aspect: z.enum(["square", "portrait", "landscape"]).default("square"),
    imageGenerationEnabled: z.boolean().default(true),
    autoImages: z.boolean().default(true),
    proseSize: z.enum(PROSE_SIZE_VALUES).default("medium"),
  }),
});

const generateImageTool = {
  type: "function",
  function: {
    name: "generate_image",
    description:
      "Request one local FLUX image for a meaningful visual beat in the current roleplay scene. Use sparingly.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        prompt: {
          type: "string",
          description:
            "Detailed visual prompt. Include subject, environment, composition, lighting, camera style, mood, and avoid text overlays. For established characters, describe visible physical features and whether each person is a man or woman; do not rely on character names inside the prompt.",
        },
        reason: {
          type: "string",
          description: "Short private reason this scene benefits from an image.",
        },
        characterIds: {
          type: "array",
          maxItems: MAX_IMAGE_REFERENCES,
          items: { type: "string" },
          description:
            "Exact saved character IDs to pass as visual references. Use at most two, and only when those characters should appear.",
        },
      },
      required: ["prompt"],
    },
  },
} as const;

const imageToolArgsSchema = z.object({
  prompt: z.string().min(1),
  reason: z.string().optional(),
  characterIds: z.array(z.string()).max(MAX_IMAGE_REFERENCES).optional(),
});

function mimeFromAttachment(attachment: Attachment) {
  if (supportedVisionTypes.has(attachment.type)) {
    return attachment.type;
  }

  const extension = attachment.url.split(".").pop()?.toLowerCase();
  if (extension === "png") {
    return "image/png";
  }
  if (extension === "jpg" || extension === "jpeg") {
    return "image/jpeg";
  }
  if (extension === "webp") {
    return "image/webp";
  }
  if (extension === "gif") {
    return "image/gif";
  }

  return null;
}

function localImageDataUrl(attachment: Attachment) {
  if (attachment.dataUrl?.startsWith("data:image/")) {
    return attachment.dataUrl;
  }

  const mime = mimeFromAttachment(attachment);
  if (!mime || !attachment.url.startsWith("/")) {
    return null;
  }

  const publicDir = path.join(process.cwd(), "public");
  const localPath = path.resolve(publicDir, attachment.url.replace(/^\/+/, ""));

  if (!localPath.startsWith(`${publicDir}${path.sep}`) || !existsSync(localPath)) {
    return null;
  }

  const encoded = readFileSync(localPath).toString("base64");
  return `data:${mime};base64,${encoded}`;
}

function buildCharacterVisionMessage(characters: StoryCharacter[]): OpenRouterMessage | null {
  const parts: Array<TextContentPart | ImageContentPart> = [
    {
      type: "text",
      text:
        "Saved character portrait references for visual continuity. Each portrait is labeled with the character's name and exact ID. Use these images to understand what the characters look like, and use exact IDs when calling generate_image.characterIds.",
    },
  ];

  let attachedCount = 0;
  for (const character of characters) {
    if (!character.portrait) {
      continue;
    }

    const dataUrl = localImageDataUrl(character.portrait);
    if (!dataUrl) {
      continue;
    }

    attachedCount += 1;
    parts.push({
      type: "text",
      text: [
        `Character portrait ${attachedCount}: ${character.name}`,
        `ID: ${character.id}`,
        character.details ? `Details: ${character.details}` : "",
        `The next image is ${character.name}.`,
      ]
        .filter(Boolean)
        .join("\n"),
    });
    parts.push({
      type: "image_url",
      image_url: {
        url: dataUrl,
      },
    });
  }

  if (attachedCount === 0) {
    return null;
  }

  return {
    role: "user",
    content: parts,
  };
}

function parseGenerateImageToolCall(toolCalls: unknown) {
  if (!Array.isArray(toolCalls)) {
    return null;
  }

  for (const call of toolCalls) {
    if (!call || typeof call !== "object" || !("function" in call)) {
      continue;
    }

    const fn = call.function;
    if (!fn || typeof fn !== "object" || !("name" in fn) || fn.name !== "generate_image") {
      continue;
    }

    const rawArguments = "arguments" in fn ? fn.arguments : undefined;

    let parsed: unknown = rawArguments;
    if (typeof rawArguments === "string") {
      try {
        parsed = JSON.parse(rawArguments) as unknown;
      } catch {
        return null;
      }
    } else if (!rawArguments) {
      parsed = {};
    }

    const result = imageToolArgsSchema.safeParse(parsed);
    return result.success ? result.data : null;
  }

  return null;
}

function configuredMaxOutputTokens() {
  const raw = serverEnv("OPENROUTER_MAX_TOKENS");
  const parsed = Number.parseInt(raw, 10);

  if (!Number.isFinite(parsed)) {
    return DEFAULT_MAX_OUTPUT_TOKENS;
  }

  return Math.max(512, Math.min(parsed, MAX_CONFIGURABLE_OUTPUT_TOKENS));
}

function localMaxOutputTokens() {
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
function localContextTokens(model: string) {
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

function configuredTextTimeoutMs(envKey: string, fallback: number) {
  const parsed = Number.parseInt(serverEnv(envKey), 10);

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.max(MIN_TEXT_TIMEOUT_MS, Math.min(parsed, MAX_TEXT_TIMEOUT_MS));
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

type StreamDeltaHandler = (text: string) => void;

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

type StreamedToolCall = { function: { name: string; arguments: string } };

type UpstreamChatMessage = {
  content?: unknown;
  tool_calls?: unknown;
};

type UpstreamResult = {
  message?: UpstreamChatMessage;
  error?: Response;
};

type OllamaChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
  images?: string[];
};

function toOllamaMessages(messages: OpenRouterMessage[]): OllamaChatMessage[] {
  return messages.map((message) => {
    if (typeof message.content === "string") {
      return { role: message.role, content: message.content };
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

function hasImageParts(messages: OpenRouterMessage[]) {
  return messages.some(
    (message) =>
      typeof message.content !== "string" &&
      message.content.some((part) => part.type === "image_url"),
  );
}

// Flatten multimodal messages to text-only for backends that can't take
// images (e.g. llama.cpp without an mmproj file). Portrait labels survive as
// text, so character continuity degrades gracefully instead of erroring.
function stripImageParts(messages: OpenRouterMessage[]): OpenRouterMessage[] {
  return messages.map((message) => {
    if (typeof message.content === "string") {
      return message;
    }

    return {
      role: message.role,
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
function customChatEndpoint(baseUrl: string): string {
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
async function requestCustomMessage(
  baseUrl: string,
  model: string,
  apiKey: string,
  messages: OpenRouterMessage[],
  includeImageTool: boolean,
  onDelta?: StreamDeltaHandler,
): Promise<UpstreamResult> {
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

  const isOpenRouter = /(^|\.)openrouter\.ai/i.test(trimmedBase);
  const resolvedModel =
    (model || "").trim() ||
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
  // In-app key wins; otherwise fall back to the matching env var.
  const resolvedKey =
    (apiKey || "").trim() ||
    (isOpenRouter ? serverEnv("OPENROUTER_API_KEY") : "") ||
    serverEnv("OPENAI_COMPAT_API_KEY");
  const requestPayload: Record<string, unknown> = {
    model: resolvedModel,
    messages,
    temperature: 0.9,
    max_tokens: configuredMaxOutputTokens(),
    ...(onDelta ? { stream: true } : {}),
  };

  if (includeImageTool) {
    requestPayload.tools = [generateImageTool];
    requestPayload.tool_choice = "auto";
  }

  const timeoutMs = configuredTextTimeoutMs(
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
              "X-Title": serverEnv("OPENROUTER_APP_TITLE", "Open Dungeon"),
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
        includeImageTool,
        onDelta,
      );
    }

    // Some servers don't implement function tools; retry without auto images.
    if (includeImageTool && /tool|function|not support/i.test(text)) {
      return requestCustomMessage(trimmedBase, resolvedModel, apiKey, messages, false, onDelta);
    }

    return {
      error: Response.json(
        {
          error: `${isOpenRouter ? "OpenRouter" : "Backend"} request failed (${upstream.status}).`,
          detail: text.slice(0, 1000),
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
            const raw = call as { index?: number; function?: { name?: unknown; arguments?: unknown } };
            const index = typeof raw.index === "number" ? raw.index : 0;
            const target = (toolCalls[index] ??= { function: { name: "", arguments: "" } });
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
            detail: upstreamError.slice(0, 1000),
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

  const data = (await upstream.json()) as {
    choices?: Array<{ message?: UpstreamChatMessage }>;
  };

  return { message: data?.choices?.[0]?.message };
}

async function requestLocalMessage(
  model: string,
  messages: OpenRouterMessage[],
  includeImageTool: boolean,
  disableThinking = true,
  onDelta?: StreamDeltaHandler,
): Promise<UpstreamResult> {
  const baseUrl = serverEnv("OLLAMA_BASE_URL", "http://127.0.0.1:11434").replace(/\/$/, "");
  const requestPayload: Record<string, unknown> = {
    model,
    messages: toOllamaMessages(messages),
    stream: Boolean(onDelta),
    // Keep the model (and the story's prompt cache) resident between turns.
    keep_alive: "30m",
    options: {
      temperature: 0.9,
      num_predict: localMaxOutputTokens(),
      num_ctx: localContextTokens(model),
    },
  };

  // Gemma 4 is a hybrid reasoning model; without this it spends most of the
  // token budget on a hidden "thinking" channel before any story text.
  if (disableThinking) {
    requestPayload.think = false;
  }

  if (includeImageTool) {
    requestPayload.tools = [generateImageTool];
  }

  const timeoutMs = configuredTextTimeoutMs("LOCAL_TEXT_TIMEOUT_MS", DEFAULT_LOCAL_TEXT_TIMEOUT_MS);
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

    // Some local models lack a tool-call template; retry the turn without auto images.
    if (includeImageTool && /does not support tools/i.test(text)) {
      return requestLocalMessage(model, messages, false, disableThinking, onDelta);
    }

    // Models without a thinking channel reject the think parameter; retry without it.
    if (disableThinking && /does not support think/i.test(text)) {
      return requestLocalMessage(model, messages, includeImageTool, false, onDelta);
    }

    const hint = /not found/i.test(text)
      ? ` The model is not installed — run \`ollama pull ${model}\`.`
      : "";
    return {
      error: Response.json(
        {
          error: `Local model request failed (${upstream.status}).${hint}`,
          detail: text.slice(0, 1000),
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
            detail: upstreamError.slice(0, 1000),
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

  const data = (await upstream.json()) as { message?: UpstreamChatMessage };
  return { message: data?.message };
}

const SUMMARIZER_SYSTEM = `You maintain the canonical "story so far" memory for an ongoing interactive roleplay. Merge the existing summary with the new passages into one updated summary.

Preserve, with priority: active plot threads and their current state; characters (names, roles, relationships, distinctive physical details); promises, debts, secrets, injuries, and items that could matter later; locations and the order of major events; choices the player made that shaped the story.

Write compact prose in past tense, no headings or lists, at most 500 words. Output only the updated summary.`;

type StoryRequestSettings = z.infer<typeof requestSchema>["settings"];

// Single place that picks the upstream provider for a turn.
function requestStoryMessage(
  settings: StoryRequestSettings,
  messages: OpenRouterMessage[],
  includeImageTool: boolean,
  onDelta?: StreamDeltaHandler,
): Promise<UpstreamResult> {
  if (settings.textProvider === "local") {
    return requestLocalMessage(settings.localTextModel, messages, includeImageTool, true, onDelta);
  }
  return requestCustomMessage(
    settings.customBaseUrl,
    settings.customModel,
    settings.customApiKey,
    messages,
    includeImageTool,
    onDelta,
  );
}

// Codex-style compaction adapted for stories: passages that scroll out of the
// context window are folded into a rolling summary instead of being forgotten.
// Best-effort — a failed summary never blocks the player's turn.
async function summarizeEvictedPassages(
  settings: StoryRequestSettings,
  existingSummary: string,
  passages: Array<{ role: "user" | "assistant"; content: string }>,
): Promise<string | null> {
  const transcript = passages
    .map((message) => `${message.role === "user" ? "Player" : "Narrator"}: ${message.content}`)
    .join("\n\n");
  const messages: OpenRouterMessage[] = [
    { role: "system", content: SUMMARIZER_SYSTEM },
    {
      role: "user",
      content: `Existing summary:\n${existingSummary || "(none yet)"}\n\nNew passages to fold in:\n${transcript}`,
    },
  ];

  const { message, error } = await requestStoryMessage(settings, messages, false);

  if (error) {
    return null;
  }

  const summary = extractStoryText(message?.content);
  return summary ? summary.slice(0, 8_000) : null;
}

export async function POST(request: Request) {
  const body = requestSchema.parse(await request.json());
  const characters = body.chatId ? listCharacters(body.chatId) : [];
  const knownCharacterIds = new Set(characters.map((character) => character.id));
  const userMessage: StoryMessage = {
    id: body.userMessageId || crypto.randomUUID(),
    role: "user",
    content: body.input,
    createdAt: new Date().toISOString(),
    attachments: body.attachments,
  };

  if (body.chatId && body.mode === "turn") {
    addMessage(body.chatId, userMessage);
    updateChatTitleFromInput(body.chatId, body.input);
  }

  // Player-authored opening: persist the text as the first narration passage
  // and return it, with no model call.
  if (body.mode === "opening") {
    const openingMessage: StoryMessage = {
      id: crypto.randomUUID(),
      role: "assistant",
      content: body.input,
      createdAt: new Date().toISOString(),
    };
    if (body.chatId) {
      addMessage(body.chatId, openingMessage);
    }
    return Response.json({ id: openingMessage.id, content: openingMessage.content });
  }

  const provider = body.settings.textProvider;
  const historyCharBudget =
    provider === "local"
      ? Math.max(
          MIN_HISTORY_CHAR_BUDGET,
          Math.round(
            (localContextTokens(body.settings.localTextModel) - HISTORY_RESERVE_TOKENS) *
              CONTEXT_SAFETY_MARGIN *
              HISTORY_CHARS_PER_TOKEN,
          ),
        )
      : REMOTE_HISTORY_CHAR_BUDGET;

  const { recent, evicted } = packStoryHistory(body.messages, historyCharBudget);
  let storySummary = "";

  if (body.chatId) {
    const stored = getStorySummary(body.chatId);
    storySummary = stored.summary;

    if (evicted.length > stored.coveredCount) {
      const folded = await summarizeEvictedPassages(
        body.settings,
        stored.summary,
        evicted.slice(stored.coveredCount),
      );
      if (folded) {
        storySummary = folded;
        setStorySummary(body.chatId, folded, evicted.length);
      }
    }
  }

  const storyMessages = buildStoryMessages(
    [
      ...recent,
      ...(body.attachments.length
        ? [
            {
              id: "pending-attachments",
              role: "user" as const,
              content: "The player included visual references for this turn.",
              createdAt: new Date().toISOString(),
              attachments: body.attachments,
            },
          ]
        : []),
    ],
    body.input,
    body.settings,
    characters,
    storySummary,
  ) as OpenRouterMessage[];
  const characterVisionMessage = buildCharacterVisionMessage(characters);
  const messages = characterVisionMessage
    ? [storyMessages[0], characterVisionMessage, ...storyMessages.slice(1)]
    : storyMessages;
  const includeImageTool = body.settings.imageGenerationEnabled && body.settings.autoImages;

  // Shared tail of a narration turn: extract, validate, persist.
  const finalizeTurn = (
    message: UpstreamChatMessage | undefined,
  ):
    | { failure: { error: string; detail?: unknown }; assistantMessage?: undefined }
    | { assistantMessage: StoryMessage; failure?: undefined } => {
    const storyText = extractStoryText(message?.content);
    const imageToolArgs = parseGenerateImageToolCall(message?.tool_calls);

    if (!storyText && !imageToolArgs) {
      return {
        failure: {
          error: `${provider === "local" ? "The local model" : "The backend"} returned no story content.`,
          detail: message,
        },
      };
    }

    const characterIds =
      imageToolArgs?.characterIds
        ?.filter((id) => knownCharacterIds.has(id))
        .slice(0, MAX_IMAGE_REFERENCES) || [];
    const assistantMessage: StoryMessage = {
      id: crypto.randomUUID(),
      role: "assistant",
      content: storyText || "The moment hangs there, waiting for what you do next.",
      createdAt: new Date().toISOString(),
      imageRequest:
        includeImageTool && imageToolArgs?.prompt
          ? {
              needed: true,
              prompt: imageToolArgs.prompt,
              mode: body.settings.imageMode,
              backend: body.settings.imageBackend,
              aspect: body.settings.aspect,
              reason: imageToolArgs.reason,
              characterIds,
            }
          : { needed: false },
    };

    if (body.chatId) {
      addMessage(body.chatId, assistantMessage);
    }

    return { assistantMessage };
  };

  if (body.stream) {
    // NDJSON events: {type:"delta"} chunks of visible story text as the model
    // writes, then one {type:"done"} carrying the sanitized persisted message
    // the client reconciles to, or {type:"error"}.
    const encoder = new TextEncoder();
    const filter = createStreamingArtifactFilter();
    let cancelled = false;

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const send = (event: Record<string, unknown>) => {
          if (cancelled) {
            return;
          }
          try {
            controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
          } catch {
            cancelled = true;
          }
        };

        void (async () => {
          try {
            const { message, error } = await requestStoryMessage(
              body.settings,
              messages,
              includeImageTool,
              (text) => {
                const visible = filter.push(text);
                if (visible) {
                  send({ type: "delta", text: visible });
                }
              },
            );

            if (error) {
              const payload = (await error.json().catch(() => null)) as {
                error?: string;
                detail?: unknown;
              } | null;
              send({
                type: "error",
                error: payload?.error || "Story request failed.",
                ...(payload?.detail !== undefined ? { detail: payload.detail } : {}),
              });
              return;
            }

            const trailing = filter.flush();
            if (trailing) {
              send({ type: "delta", text: trailing });
            }

            const result = finalizeTurn(message);
            if (result.failure) {
              send({ type: "error", ...result.failure });
              return;
            }

            send({
              type: "done",
              id: result.assistantMessage.id,
              content: result.assistantMessage.content,
              imageRequest: result.assistantMessage.imageRequest,
            });
          } catch (streamFailure) {
            send({
              type: "error",
              error:
                streamFailure instanceof Error ? streamFailure.message : "Story request failed.",
            });
          } finally {
            if (!cancelled) {
              try {
                controller.close();
              } catch {
                // The client went away first; nothing left to close cleanly.
              }
            }
          }
        })();
      },
      cancel() {
        cancelled = true;
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  }

  const { message, error } = await requestStoryMessage(body.settings, messages, includeImageTool);

  if (error) {
    return error;
  }

  const result = finalizeTurn(message);
  if (result.failure) {
    return Response.json(result.failure, { status: 502 });
  }

  return Response.json({
    id: result.assistantMessage.id,
    content: result.assistantMessage.content,
    imageRequest: result.assistantMessage.imageRequest,
  });
}
