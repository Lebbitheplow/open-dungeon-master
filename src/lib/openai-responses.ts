// OpenAI's Responses API (/v1/responses) as a second transport for the
// custom backend, used only where Chat Completions cannot carry function
// tools: GPT-6.1 Sol and GPT-6 Astra (issue #129, the route table in
// scripts/lib/openai-tool-route.mjs). The DM loop speaks Chat Completions
// shapes everywhere (messages, tool_calls, tool_call_id), so this module
// translates on the way out and back and the loop never learns which
// transport answered.
//
// Nothing is stored on OpenAI's side (store: false): the table keeps its own
// transcript and sends it whole each call, as it does on Chat Completions.
// The model's reasoning items are therefore not handed back between a call
// and its result; it reasons afresh over the result, which OpenAI allows
// and which costs nothing a Chat Completions table did not already pay.
import {
  BackendRefusal,
  forEachStreamLine,
  MAX_BACKEND_BODY_BYTES,
  readBody,
} from "@/lib/backend-fetch";
import type { SamplingConfig } from "@/lib/dm/sampling-logic";
import type {
  ChatMessage,
  StreamDeltaHandler,
  StreamedToolCall,
  UpstreamChatMessage,
} from "@/lib/model-client";

// The sibling of customChatEndpoint: whatever the operator pasted, resolved
// to its /responses endpoint.
export function customResponsesEndpoint(baseUrl: string): string {
  const url = baseUrl
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/chat\/completions$/, "");
  if (/\/responses$/.test(url)) return url;
  if (/\/v\d+$/.test(url)) return `${url}/responses`;
  return `${url}/v1/responses`;
}

type ResponsesItem = Record<string, unknown>;

function contentText(content: ChatMessage["content"]): string {
  if (typeof content === "string") return content;
  return content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n\n");
}

// Chat Completions tool definitions, as every ODM tool is written, in the
// flat shape Responses takes. strict is set off by name: Responses defaults
// it on, and strict mode demands every property be required and every
// object closed, which ODM's schemas (optional fields everywhere) are not.
export function toResponsesTools(tools: readonly unknown[]): ResponsesItem[] {
  const out: ResponsesItem[] = [];
  for (const raw of tools) {
    const tool = raw as {
      function?: { name?: unknown; description?: unknown; parameters?: unknown };
    };
    if (typeof tool?.function?.name !== "string") continue;
    out.push({
      type: "function",
      name: tool.function.name,
      ...(typeof tool.function.description === "string"
        ? { description: tool.function.description }
        : {}),
      ...(tool.function.parameters !== undefined ? { parameters: tool.function.parameters } : {}),
      strict: false,
    });
  }
  return out;
}

// The transcript as Responses input items. An assistant turn becomes its
// text (if any) followed by one function_call item per call; a tool result
// becomes the function_call_output for that call. A call the stream left
// without an id is paired with the id-less results that follow it, in
// order, which is how Chat Completions read them.
export function toResponsesInput(messages: ChatMessage[]): ResponsesItem[] {
  const items: ResponsesItem[] = [];
  const unnamedCalls: string[] = [];
  let synthetic = 0;
  for (const message of messages) {
    if (message.role === "tool") {
      const output = contentText(message.content);
      const callId = message.tool_call_id || unnamedCalls.shift();
      if (callId) {
        items.push({ type: "function_call_output", call_id: callId, output });
      } else {
        // A result with no call to answer; the model still needs to see it.
        items.push({ role: "user", content: output });
      }
      continue;
    }
    if (message.role === "assistant") {
      const text = contentText(message.content);
      if (text) {
        items.push({ role: "assistant", content: text });
      }
      const calls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
      for (const raw of calls) {
        const call = raw as { id?: unknown; function?: { name?: unknown; arguments?: unknown } };
        const name = typeof call?.function?.name === "string" ? call.function.name : "";
        if (!name) continue;
        let callId = typeof call.id === "string" && call.id ? call.id : "";
        if (!callId) {
          synthetic += 1;
          callId = `call_odm_${synthetic}`;
          unnamedCalls.push(callId);
        }
        const args = call.function?.arguments;
        items.push({
          type: "function_call",
          call_id: callId,
          name,
          arguments: typeof args === "string" ? args : JSON.stringify(args ?? {}),
        });
      }
      continue;
    }
    if (typeof message.content === "string") {
      items.push({ role: message.role, content: message.content });
      continue;
    }
    items.push({
      role: message.role,
      content: message.content.map((part) =>
        part.type === "text"
          ? { type: "input_text", text: part.text }
          : { type: "input_image", image_url: part.image_url.url, detail: "auto" },
      ),
    });
  }
  return items;
}

// A response's output items as the Chat Completions message the DM loop
// reads: the message items' text, and each function_call as a tool call
// whose id is the call_id, so the loop's tool_call_id round-trips.
export function fromResponsesOutput(output: unknown): UpstreamChatMessage {
  const texts: string[] = [];
  const toolCalls: StreamedToolCall[] = [];
  for (const raw of Array.isArray(output) ? output : []) {
    const item = raw as {
      type?: unknown;
      content?: unknown;
      call_id?: unknown;
      id?: unknown;
      name?: unknown;
      arguments?: unknown;
    };
    if (item?.type === "message" && Array.isArray(item.content)) {
      for (const part of item.content as Array<{ type?: unknown; text?: unknown; refusal?: unknown }>) {
        if (part?.type === "output_text" && typeof part.text === "string") {
          texts.push(part.text);
        } else if (part?.type === "refusal" && typeof part.refusal === "string") {
          texts.push(part.refusal);
        }
      }
      continue;
    }
    if (item?.type === "function_call" && typeof item.name === "string") {
      const id =
        typeof item.call_id === "string" && item.call_id
          ? item.call_id
          : typeof item.id === "string"
            ? item.id
            : undefined;
      toolCalls.push({
        ...(id ? { id } : {}),
        type: "function",
        function: {
          name: item.name,
          arguments: typeof item.arguments === "string" ? item.arguments : "",
        },
      });
    }
  }
  return {
    content: texts.join(""),
    ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
  };
}

export function responsesPayload(input: {
  model: string;
  messages: ChatMessage[];
  sampling: SamplingConfig;
  maxOutputTokens: number;
  stream: boolean;
  tools?: readonly unknown[];
  toolChoice?: "auto" | "none";
}): Record<string, unknown> {
  return {
    model: input.model,
    input: toResponsesInput(input.messages),
    ...input.sampling,
    max_output_tokens: input.maxOutputTokens,
    store: false,
    ...(input.stream ? { stream: true } : {}),
    ...(input.tools?.length
      ? { tools: toResponsesTools(input.tools), tool_choice: input.toolChoice ?? "auto" }
      : {}),
  };
}

// finishReason is "length" when the output cap cut the response (OpenAI
// says status "incomplete" with incomplete_details.reason
// "max_output_tokens"), the same word the Chat Completions reader reports,
// so the turn's empty-reply warning (issue #120) names it on both routes.
export type ResponsesReply =
  | { message: UpstreamChatMessage; finishReason?: string }
  | { failure: string };

const cutByOutputCap = (response: { status?: unknown; incomplete_details?: { reason?: unknown } | null } | null | undefined) =>
  response?.status === "incomplete" && response?.incomplete_details?.reason === "max_output_tokens";

// Reads a 2xx reply, streamed or whole. Streaming is OpenAI's typed events:
// response.output_text.delta carries the prose as it lands, and
// response.completed (or response.incomplete, when the output cap cut it)
// carries the whole output, which is what the message is built from; the
// output_item.done items stand in if the stream ends without it. A
// response.failed or error event is the backend's own failure. Transport
// trouble (a cut stream, a flood) throws, as the Chat Completions reader's
// does, for the caller to word.
export async function readResponsesReply(
  upstream: Response,
  options: { onDelta?: StreamDeltaHandler; idleMs: number; onIdleAbort: () => void },
): Promise<ResponsesReply> {
  const { onDelta } = options;
  if (onDelta && upstream.body) {
    const deltas: string[] = [];
    const doneItems: Array<[number, unknown]> = [];
    let output: unknown = null;
    let failure = "";
    let finishReason = "";
    await forEachStreamLine(upstream, options.idleMs, options.onIdleAbort, (line) => {
      if (!line.startsWith("data:")) return;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(payload);
      } catch {
        return;
      }
      const event = parsed as {
        type?: unknown;
        delta?: unknown;
        item?: unknown;
        output_index?: unknown;
        message?: unknown;
        error?: { message?: unknown } | null;
        response?: {
          output?: unknown;
          error?: { message?: unknown } | null;
          status?: unknown;
          incomplete_details?: { reason?: unknown } | null;
        } | null;
      };
      switch (event.type) {
        case "response.output_text.delta":
          if (typeof event.delta === "string" && event.delta) {
            deltas.push(event.delta);
            onDelta(event.delta);
          }
          break;
        case "response.output_item.done":
          doneItems.push([
            typeof event.output_index === "number" ? event.output_index : doneItems.length,
            event.item,
          ]);
          break;
        case "response.completed":
        case "response.incomplete":
          output = event.response?.output ?? null;
          if (cutByOutputCap(event.response)) {
            finishReason = "length";
          }
          break;
        case "response.failed":
          failure =
            (typeof event.response?.error?.message === "string" && event.response.error.message) ||
            "The backend reported a failed response.";
          break;
        case "error":
          failure =
            (typeof event.message === "string" && event.message) ||
            (typeof event.error?.message === "string" && event.error.message) ||
            "The backend reported a stream error.";
          break;
        default:
          break;
      }
    });
    if (failure) {
      return { failure };
    }
    const items =
      output ?? doneItems.sort((a, b) => a[0] - b[0]).map(([, item]) => item);
    const message = fromResponsesOutput(items);
    if (!message.content && deltas.length) {
      message.content = deltas.join("");
    }
    return { message, ...(finishReason ? { finishReason } : {}) };
  }

  const body = await readBody(upstream, MAX_BACKEND_BODY_BYTES);
  if (!body.complete) {
    throw new BackendRefusal("The backend's reply was far larger than any reply.");
  }
  let data: {
    output?: unknown;
    error?: { message?: unknown } | null;
    status?: unknown;
    incomplete_details?: { reason?: unknown } | null;
  };
  try {
    data = JSON.parse(body.text) as typeof data;
  } catch {
    return { failure: "The backend returned an unreadable response." };
  }
  if (data?.error && typeof data.error === "object") {
    return {
      failure:
        (typeof data.error.message === "string" && data.error.message) ||
        "The backend reported a failed response.",
    };
  }
  return {
    message: fromResponsesOutput(data?.output),
    ...(cutByOutputCap(data) ? { finishReason: "length" } : {}),
  };
}
