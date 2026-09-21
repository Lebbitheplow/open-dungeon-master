// Turns what the DM loop sends a chat model into what an agent program is
// given: one system prompt and one opening message. Pure, no `@/` imports,
// so scripts/test-harness-render.mjs can load it directly.
//
// An agent program is not a chat endpoint. It takes a system prompt and a
// user message, and it keeps its own record of the conversation from there.
// So the table's history is written out once, as a transcript, when the
// program starts, and each later message (a correction, a nudge) is sent to
// the same running program rather than re-sending everything.

import type { McpToolDefinition } from "./types.ts";

type RenderMessage = {
  role: string;
  content: unknown;
  tool_calls?: unknown;
  tool_call_id?: string;
};

// The DM's tools are written in the OpenAI function format the chat backends
// take. MCP wants name, description and inputSchema; the JSON Schema itself
// carries over unchanged.
export function toMcpTools(tools: readonly unknown[] | undefined): McpToolDefinition[] {
  const out: McpToolDefinition[] = [];
  const seen = new Set<string>();
  for (const tool of tools ?? []) {
    const fn = (tool as { function?: { name?: unknown; description?: unknown; parameters?: unknown } })
      ?.function;
    const name = typeof fn?.name === "string" ? fn.name : "";
    if (!name || seen.has(name)) {
      continue;
    }
    seen.add(name);
    const parameters =
      fn?.parameters && typeof fn.parameters === "object"
        ? (fn.parameters as Record<string, unknown>)
        : { type: "object", properties: {} };
    out.push({
      name,
      description: typeof fn?.description === "string" ? fn.description : "",
      inputSchema:
        parameters.type === "object"
          ? { ...parameters, type: "object" }
          : { type: "object", properties: {} },
    });
  }
  return out;
}

export function toolNames(tools: readonly unknown[] | undefined): Set<string> {
  return new Set(toMcpTools(tools).map((tool) => tool.name));
}

// Text of one message's content, which is either a string or an array of
// text and image parts. Pictures cannot travel in this first version, so each
// is named rather than silently dropped.
export function contentText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .map((part) => {
      const typed = part as { type?: unknown; text?: unknown };
      if (typed?.type === "text" && typeof typed.text === "string") {
        return typed.text;
      }
      if (typed?.type === "image_url") {
        return "[a picture was shared here]";
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function toolCallsOf(message: RenderMessage): Array<{ id: string; name: string; args: string }> {
  if (!Array.isArray(message.tool_calls)) {
    return [];
  }
  return message.tool_calls.flatMap((call) => {
    const typed = call as { id?: unknown; function?: { name?: unknown; arguments?: unknown } };
    const name = typeof typed?.function?.name === "string" ? typed.function.name : "";
    if (!name) {
      return [];
    }
    const args =
      typeof typed.function?.arguments === "string"
        ? typed.function.arguments
        : JSON.stringify(typed.function?.arguments ?? {});
    return [{ id: typeof typed.id === "string" ? typed.id : "", name, args }];
  });
}

// Said once, above the DM's own rules, so the program knows what it is and
// what its tools are for. Everything after it is the same prompt the
// built-in storyteller gets.
export const HARNESS_PREAMBLE = [
  "You are running as the Dungeon Master of an Open Dungeon Master table.",
  "Your tools are the table's rules engine. They are the only way anything happens in the game: every roll, hit, point of damage, item, condition and scene change comes from calling them, never from your own prose.",
  "Tool names in the rules below are written without the prefix your tool list shows (request_roll is the same tool as mcp__odm__request_roll or odm_request_roll).",
  "Your final reply text is the narration the players read, exactly as you write it. Do not describe your tool calls, do not mention tools, the engine, prompts or being an AI, and do not add headings or commentary around the narration.",
  "When a tool answers that the turn is paused for dice or that no more tools are available this turn, stop calling tools and write the narration.",
].join("\n");

export type RenderedTurn = {
  system: string;
  prompt: string;
};

// The system message becomes the program's whole system prompt (replacing
// its own coding persona, never added to it). Everything after it becomes
// one opening message: the transcript so far, then the instruction to take
// the turn. A turn resumed after dice carries its own tool calls and results,
// which are written as engine lines so the program sees what was resolved.
export function renderTurn(messages: readonly RenderMessage[]): RenderedTurn {
  const systemParts: string[] = [];
  const lines: string[] = [];
  const toolNamesById = new Map<string, string>();
  let lastUser = "";

  for (const message of messages) {
    const text = contentText(message.content).trim();
    if (message.role === "system") {
      if (text) {
        systemParts.push(text);
      }
      continue;
    }
    if (message.role === "assistant") {
      if (text) {
        lines.push(`[Dungeon Master] ${text}`);
      }
      for (const call of toolCallsOf(message)) {
        toolNamesById.set(call.id, call.name);
        lines.push(`[engine] You called ${call.name} ${call.args}`);
      }
      continue;
    }
    if (message.role === "tool") {
      const name = toolNamesById.get(message.tool_call_id ?? "") ?? "a tool";
      lines.push(`[engine] ${name} answered: ${text}`);
      continue;
    }
    if (text) {
      lines.push(text);
      lastUser = text;
    }
  }

  const system = [HARNESS_PREAMBLE, ...systemParts].join("\n\n");
  const transcript = lines.length
    ? `<table_transcript>\n${lines.join("\n\n")}\n</table_transcript>`
    : "The table has not spoken yet.";
  const resumed = messages.some((message) => message.role === "tool");
  const instruction = resumed
    ? "The dice above have landed. Continue your turn as the Dungeon Master from exactly where it paused: call any further tools you need, then write the narration."
    : lastUser
      ? "It is your turn as the Dungeon Master. Resolve what the players just did with your tools, then write the narration."
      : "It is your turn as the Dungeon Master. Open the scene: use your tools for anything mechanical, then write the narration.";
  return { system, prompt: `${transcript}\n\n${instruction}` };
}

// Messages that arrived after a program started, rendered as the follow-up
// sent into that same running program: corrections, nudges and state
// updates. Tool results are not in here; they go back through MCP.
export function renderFollowUp(messages: readonly RenderMessage[]): string {
  return messages
    .filter((message) => message.role === "user" || message.role === "system")
    .map((message) => contentText(message.content).trim())
    .filter(Boolean)
    .join("\n\n");
}

// A plain completion (summaries, compaction, the narration guard's rewrite):
// the same transcript shape, but the last user message is the request itself
// rather than an instruction to take a turn.
export function renderCompletion(messages: readonly RenderMessage[]): RenderedTurn {
  const systemParts: string[] = [];
  const lines: string[] = [];
  const rest = [...messages];
  let finalAsk = "";
  for (let index = rest.length - 1; index >= 0; index -= 1) {
    if (rest[index].role === "user") {
      finalAsk = contentText(rest[index].content).trim();
      rest.splice(index, 1);
      break;
    }
  }
  for (const message of rest) {
    const text = contentText(message.content).trim();
    if (!text) {
      continue;
    }
    if (message.role === "system") {
      systemParts.push(text);
    } else if (message.role === "assistant") {
      lines.push(`[assistant] ${text}`);
    } else if (message.role === "tool") {
      lines.push(`[tool result] ${text}`);
    } else {
      lines.push(`[user] ${text}`);
    }
  }
  const system = [
    "Answer the request exactly as asked. Reply with the answer only: no preamble, no commentary, no tool use.",
    ...systemParts,
  ].join("\n\n");
  const prompt = lines.length
    ? `<conversation>\n${lines.join("\n\n")}\n</conversation>\n\n${finalAsk}`
    : finalAsk;
  return { system, prompt };
}
