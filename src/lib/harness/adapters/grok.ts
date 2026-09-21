// Grok Build (xAI's `grok`), driven over the Agent Client Protocol on stdio,
// the same way T3 Code drives it.
//
// NOT YET RUN on a real install (Grok Build is not installed on the machine
// this was written on), so the admin page marks its lockdown unproven.
//
// Lockdown, "contained": `--permission-mode dontAsk` refuses anything not
// pre-approved; every permission request ODM receives for anything but its
// own MCP tools is rejected; the session's agent profile names only ODM's
// tools; the Claude and Cursor MCP imports are switched off; the working
// folder is an empty scratch directory; and the program is told the client
// offers no file system or terminal at all.

import { writeFileSync } from "node:fs";
import path from "node:path";
import { startJsonRpc } from "../jsonrpc-stdio.ts";
import { runProgram } from "../process.ts";
import type { HarnessAdapter, HarnessModel, HarnessStartOptions } from "../types.ts";

export const GROK_ENV = {
  GROK_CLAUDE_MCPS_ENABLED: "0",
  GROK_CURSOR_MCPS_ENABLED: "0",
  GROK_DISABLE_AUTOUPDATER: "1",
};

// Pure, so scripts/test-harness-args.mjs can pin it.
export function grokArgs(): string[] {
  return ["--permission-mode", "dontAsk", "agent", "stdio"];
}

// An agent profile listing ODM's tools only. Grok names MCP tools
// server__tool; the image tools are added for a picture run alone.
export function grokAgentProfile(system: string, images: boolean): string {
  const tools = ["odm__*", ...(images ? ["image_gen"] : [])];
  return [
    "---",
    "name: odm-dm",
    "description: Open Dungeon Master",
    `tools: [${tools.map((tool) => JSON.stringify(tool)).join(", ")}]`,
    "---",
    "",
    system,
    "",
  ].join("\n");
}

export function parseGrokModels(output: string): HarnessModel[] {
  const models: HarnessModel[] = [];
  for (const line of output.split("\n")) {
    const match = /^\s*[-*]?\s*(grok[\w.-]*)/i.exec(line);
    if (match && !models.some((entry) => entry.id === match[1])) {
      models.push({ id: match[1], label: match[1], cheap: /mini|fast/i.test(match[1]) });
    }
  }
  return models;
}

function textOf(value: unknown): string {
  return typeof value === "string" ? value : "";
}

async function start(options: HarnessStartOptions) {
  const profilePath = path.join(options.cwd, "odm-dm.md");
  writeFileSync(profilePath, grokAgentProfile(options.system, Boolean(options.images)), { mode: 0o600 });
  let closed = false;
  let sessionId = "";
  let turnText = "";

  const peer = startJsonRpc(
    options.binary,
    grokArgs(),
    { cwd: options.cwd, env: { ...options.env, ...GROK_ENV } },
    {
      onNotification(method, params) {
        if (method !== "session/update") {
          return;
        }
        const update = (params.update ?? {}) as Record<string, unknown>;
        const kind = update.sessionUpdate;
        if (kind === "agent_message_chunk") {
          const content = (update.content ?? {}) as { type?: string; text?: string; data?: string; mimeType?: string };
          if (content.type === "text" && content.text) {
            turnText += content.text;
            options.onEvent({ type: "delta", text: content.text });
          } else if (content.type === "image" && content.data) {
            options.onEvent({ type: "image", bytes: Buffer.from(content.data, "base64"), mime: content.mimeType ?? "image/png" });
          }
          return;
        }
        if (kind === "tool_call" || kind === "tool_call_update") {
          // A new tool round begins; text written before it was not the
          // narration.
          turnText = "";
        }
      },
      onRequest(method, params) {
        if (method === "session/request_permission") {
          const toolCall = (params.toolCall ?? {}) as { title?: string; kind?: string; rawInput?: unknown };
          const title = textOf(toolCall.title);
          const odm = /\bodm__|^odm[_ ]/i.test(title) || toolCall.kind === "mcp";
          const opts = (params.options ?? []) as Array<{ optionId: string; kind?: string }>;
          const allow = opts.find((option) => option.kind === "allow_once") ?? opts.find((option) => /allow/.test(option.kind ?? ""));
          const reject = opts.find((option) => option.kind === "reject_once") ?? opts.find((option) => /reject/.test(option.kind ?? ""));
          if (odm && allow) {
            return { outcome: { outcome: "selected", optionId: allow.optionId } };
          }
          return reject ? { outcome: { outcome: "selected", optionId: reject.optionId } } : { outcome: { outcome: "cancelled" } };
        }
        if (method.startsWith("fs/") || method.startsWith("terminal/")) {
          throw new Error("This client offers no file system or terminal.");
        }
        if (method === "x.ai/ask_user_question" || method === "_x.ai/ask_user_question") {
          return { answers: [] };
        }
        throw new Error(`Unsupported request ${method}`);
      },
      onExit(code, stderr) {
        if (!closed) {
          if (code !== 0 && stderr) {
            options.onEvent({
              type: "error",
              kind: /log ?in|auth/i.test(stderr) ? "signed-out" : "crash",
              message: stderr.split("\n").filter(Boolean).slice(-2).join(" ").slice(0, 400),
            });
          }
          options.onEvent({ type: "exit", code });
        }
      },
    },
  );

  await peer.request("initialize", {
    protocolVersion: 1,
    clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
    clientInfo: { name: "open-dungeon-master", version: "1" },
  });
  await peer
    .request("authenticate", { methodId: options.env.XAI_API_KEY ? "xai.api_key" : "cached_token" })
    .catch(() => undefined);
  const created = await peer.request<{ sessionId?: string }>("session/new", {
    cwd: options.cwd,
    mcpServers: options.mcp
      ? [
          {
            type: "http",
            name: "odm",
            url: options.mcp.url,
            headers: [{ name: "Authorization", value: `Bearer ${options.mcp.token}` }],
          },
        ]
      : [],
    _meta: {
      agentProfile: profilePath,
      systemPromptOverride: options.system,
      rules: [
        { action: "deny", tool: "Bash" },
        { action: "deny", tool: "Edit" },
        { action: "deny", tool: "Write" },
        { action: "deny", tool: "Read" },
        { action: "deny", tool: "Grep" },
        { action: "deny", tool: "WebFetch" },
        { action: "deny", tool: "WebSearch" },
        { action: "allow", tool: "MCPTool(odm__*)" },
      ],
    },
  });
  sessionId = created.sessionId ?? "";
  if (!sessionId) {
    peer.kill();
    throw new Error("Grok Build did not start a session.");
  }
  if (options.model) {
    await peer.request("session/set_model", { sessionId, modelId: options.model }).catch(() => undefined);
  }
  options.onEvent({ type: "ready", tools: [] });

  return {
    send(text: string) {
      turnText = "";
      peer
        .request<{ stopReason?: string }>("session/prompt", { sessionId, prompt: [{ type: "text", text }] }, 30 * 60_000)
        .then((result) => {
          if (result.stopReason === "refusal") {
            options.onEvent({ type: "error", kind: "crash", message: "Grok declined this turn." });
            return;
          }
          options.onEvent({ type: "turn_end", text: turnText.trim() });
        })
        .catch((error) => {
          const message = error instanceof Error ? error.message : String(error);
          options.onEvent({
            type: "error",
            kind: /limit|quota|429/i.test(message) ? "limit" : /auth|log ?in/i.test(message) ? "signed-out" : "crash",
            message,
          });
        });
    },
    close() {
      closed = true;
      if (sessionId) {
        peer.notify("session/cancel", { sessionId });
      }
      peer.kill();
    },
  };
}

export const grokAdapter: HarnessAdapter = {
  id: "grok",
  label: "Grok Build",
  binaryNames: ["grok"],
  installHint: "curl -fsSL https://x.ai/cli/install.sh | bash",
  signInHint: "grok login",
  lockdown: "contained",
  paints: true,
  async probe(binary, env) {
    const version = await runProgram(binary, ["--version"], env, 15_000);
    const installed = version.code === 0;
    if (!installed) {
      return { installed: false, auth: { state: "unknown" }, models: [] };
    }
    const listed = await runProgram(binary, ["models"], { ...env, ...GROK_ENV }, 30_000);
    const text = `${listed.stdout}\n${listed.stderr}`;
    const signedOut = /not logged in|log in first|please log in/i.test(text);
    const models = parseGrokModels(listed.stdout);
    return {
      installed,
      version: version.stdout.trim().split(/\s+/).pop(),
      auth: signedOut
        ? { state: "signed-out" }
        : { state: models.length || /logged in/i.test(text) ? "ready" : "unknown", kind: env.XAI_API_KEY ? "api-key" : "subscription" },
      models: models.length ? models : [{ id: "grok-4.6", label: "Grok 4.6" }],
      lockdownProven: false,
      message: signedOut ? "Grok Build is installed but not signed in on this machine." : undefined,
    };
  },
  start,
};
