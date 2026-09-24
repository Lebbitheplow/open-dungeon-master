// Claude Code, driven through its own CLI in headless stream-json mode.
//
// Lockdown: `--tools ""` removes every built-in tool (proven on 2.1.278: the
// init event lists only mcp__odm__* tools), `--strict-mcp-config` ignores the
// admin's own MCP servers, `--setting-sources ""` loads no user or project
// settings, hooks or CLAUDE.md, and `--permission-mode dontAsk` refuses
// anything that was not pre-approved. The init event's tool list is checked
// on every run, and a run that reports any other tool is killed.

import { writeFileSync } from "node:fs";
import path from "node:path";
import { THIS_TURN_HEADING } from "@/lib/prompt-boundary";
import { parseJsonLine, runProgram, spawnProgram } from "../process.ts";
import type { HarnessAdapter, HarnessModel, HarnessStartOptions } from "../types.ts";

export const CLAUDE_MCP_PREFIX = "mcp__odm__";

export const CLAUDE_MODELS: HarnessModel[] = [
  { id: "sonnet", label: "Sonnet (latest)", contextTokens: 1_000_000 },
  { id: "opus", label: "Opus (latest)", contextTokens: 1_000_000 },
  { id: "haiku", label: "Haiku (latest)", contextTokens: 200_000, cheap: true },
  { id: "claude-sonnet-5", label: "Claude Sonnet 5", contextTokens: 1_000_000 },
  { id: "claude-opus-5", label: "Claude Opus 5", contextTokens: 1_000_000 },
  { id: "claude-fable-5-1", label: "Claude Fable 5.1", contextTokens: 1_000_000 },
  { id: "claude-haiku-4-5", label: "Claude Haiku 4.5", contextTokens: 200_000, cheap: true },
];

// Pure, so scripts/test-harness-logic.mjs can pin every lockdown flag.
export function claudeArgs(options: {
  systemPromptPath: string;
  model: string;
  effort: string;
  mcpConfigPath: string | null;
}): string[] {
  const args = [
    "-p",
    "--input-format",
    "stream-json",
    "--output-format",
    "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--system-prompt-file",
    options.systemPromptPath,
    "--tools",
    "",
    "--strict-mcp-config",
    "--setting-sources",
    "",
    "--settings",
    JSON.stringify({ disableAllHooks: true }),
    "--permission-mode",
    "dontAsk",
    "--no-session-persistence",
    "--disable-slash-commands",
  ];
  if (options.mcpConfigPath) {
    args.push("--mcp-config", options.mcpConfigPath, "--allowedTools", `${CLAUDE_MCP_PREFIX}*`);
  }
  if (options.model) {
    args.push("--model", options.model);
  }
  if (options.effort) {
    args.push("--effort", options.effort);
  }
  return args;
}

export const CLAUDE_ENV = {
  // The claude.ai connectors and an open IDE would both add tools.
  ENABLE_CLAUDEAI_MCP_SERVERS: "false",
  CLAUDE_CODE_AUTO_CONNECT_IDE: "0",
  DISABLE_AUTOUPDATER: "1",
  // Long engine calls (a parked roll, a slow handler) must not time out
  // inside the program before ODM answers them.
  MCP_TOOL_TIMEOUT: "600000",
  MCP_TIMEOUT: "30000",
};

// Claude Code (2.1.275+) caches the system prompt file in two blocks, split
// at a line holding only this marker, which it then removes: the part above
// it, the campaign's static rules, is read from the cache on later turns
// instead of written again. Only the first heading is ours: the DM rules
// come before anything a player writes. Through Bedrock, Vertex or a gateway
// Claude Code sends one block, as without the marker.
// https://code.claude.com/docs/en/agent-sdk/modifying-system-prompts
export function withCacheBoundary(system: string): string {
  return system.replace(THIS_TURN_HEADING, "__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__");
}

function textOf(value: unknown): string {
  return typeof value === "string" ? value : "";
}

async function start(options: HarnessStartOptions) {
  let mcpConfigPath: string | null = null;
  if (options.mcp) {
    // A file in the run's own scratch folder, readable only by this user and
    // deleted with the folder, so the token never appears on a command line.
    mcpConfigPath = path.join(options.cwd, "odm-mcp.json");
    writeFileSync(
      mcpConfigPath,
      JSON.stringify({
        mcpServers: {
          odm: {
            type: "http",
            url: options.mcp.url,
            headers: { Authorization: `Bearer ${options.mcp.token}` },
          },
        },
      }),
      { mode: 0o600 },
    );
  }
  // The system prompt goes by file as well. A campaign's prompt runs to
  // tens of kilobytes, and Windows caps a whole command line at 32 K
  // characters (Linux caps one argument at 128 K), so on argv the program
  // could not start at all.
  const systemPromptPath = path.join(options.cwd, "odm-system-prompt.md");
  writeFileSync(systemPromptPath, withCacheBoundary(options.system), { mode: 0o600 });
  const args = claudeArgs({
    systemPromptPath,
    model: options.model,
    effort: options.effort,
    mcpConfigPath,
  });
  let turnText = "";
  let closed = false;
  const program = spawnProgram(options.binary, args, {
    cwd: options.cwd,
    env: { ...options.env, ...CLAUDE_ENV },
    onLine: (line) => {
      const event = parseJsonLine(line);
      if (!event) {
        return;
      }
      if (event.type === "system" && event.subtype === "init") {
        const tools = Array.isArray(event.tools) ? event.tools.map(String) : [];
        const stray = tools.filter((tool) => !tool.startsWith(CLAUDE_MCP_PREFIX));
        if (stray.length) {
          options.onEvent({
            type: "error",
            kind: "lockdown",
            message: `Claude Code started with its own tools still on (${stray.slice(0, 4).join(", ")}), so the turn was stopped.`,
          });
          program.kill();
          return;
        }
        const servers = Array.isArray(event.mcp_servers) ? event.mcp_servers : [];
        const odm = servers.find((server) => (server as { name?: unknown }).name === "odm") as
          | { status?: unknown }
          | undefined;
        if (options.mcp && odm && odm.status !== "connected") {
          options.onEvent({
            type: "error",
            kind: "crash",
            message: `Claude Code could not reach the game engine (MCP status: ${String(odm.status)}).`,
          });
          program.kill();
          return;
        }
        options.onEvent({ type: "ready", tools });
        return;
      }
      if (event.type === "stream_event") {
        const inner = event.event as { type?: unknown; delta?: { type?: unknown; text?: unknown } } | undefined;
        if (inner?.type === "content_block_delta" && inner.delta?.type === "text_delta") {
          const text = textOf(inner.delta.text);
          if (text) {
            turnText += text;
            options.onEvent({ type: "delta", text });
          }
        }
        return;
      }
      if (event.type === "rate_limit_event") {
        const info = event.rate_limit_info as
          | { utilization?: unknown; resetsAt?: unknown; rateLimitType?: unknown; status?: unknown }
          | undefined;
        if (info && typeof info.utilization === "number") {
          options.onEvent({
            type: "rate_limit",
            utilization: info.utilization,
            resetsAt: typeof info.resetsAt === "number" ? info.resetsAt : undefined,
            window: typeof info.rateLimitType === "string" ? info.rateLimitType : undefined,
          });
        }
        return;
      }
      if (event.type === "result") {
        const usage = event.usage as { input_tokens?: unknown; output_tokens?: unknown } | undefined;
        const text = turnText.trim() || textOf(event.result).trim();
        turnText = "";
        if (event.is_error === true || (event.subtype !== "success" && event.subtype !== undefined)) {
          const message = textOf(event.result) || `Claude Code stopped (${String(event.subtype)}).`;
          options.onEvent({
            type: "error",
            kind: /limit|quota|usage/i.test(message) ? "limit" : /log ?in|auth|credential/i.test(message) ? "signed-out" : "crash",
            message,
          });
          return;
        }
        options.onEvent({
          type: "turn_end",
          text,
          usage: {
            inputTokens: typeof usage?.input_tokens === "number" ? usage.input_tokens : undefined,
            outputTokens: typeof usage?.output_tokens === "number" ? usage.output_tokens : undefined,
            costUsd: typeof event.total_cost_usd === "number" ? event.total_cost_usd : undefined,
          },
        });
        return;
      }
      if (event.type === "assistant") {
        // A whole message arrives after its deltas; text already streamed is
        // not counted twice. The deltas are the record.
        return;
      }
    },
    onExit: (code) => {
      if (!closed) {
        const tail = program.stderrTail();
        if (code !== 0 && tail) {
          options.onEvent({
            type: "error",
            kind: /not logged in|log in|authenticat/i.test(tail) ? "signed-out" : "crash",
            message: tail.split("\n").filter(Boolean).slice(-2).join(" ").slice(0, 400),
          });
        }
        options.onEvent({ type: "exit", code });
      }
    },
  });
  return {
    send(text: string) {
      program.write(JSON.stringify({ type: "user", message: { role: "user", content: text } }));
    },
    close() {
      closed = true;
      program.kill();
    },
  };
}

export const claudeAdapter: HarnessAdapter = {
  id: "claude",
  label: "Claude Code",
  binaryNames: ["claude"],
  installHint: "curl -fsSL https://claude.ai/install.sh | bash",
  signInHint: "claude auth login",
  lockdown: "removed",
  paints: false,
  async probe(binary, env) {
    const version = await runProgram(binary, ["--version"], env, 15_000);
    const installed = version.code === 0;
    const status = installed ? await runProgram(binary, ["auth", "status"], env, 20_000) : null;
    let auth: { state: "ready" | "signed-out" | "unknown"; kind?: "subscription" | "api-key"; plan?: string; account?: string } = {
      state: "unknown",
    };
    if (status) {
      try {
        const body = JSON.parse(status.stdout) as {
          loggedIn?: boolean;
          authMethod?: string;
          subscriptionType?: string;
          email?: string;
        };
        auth = body.loggedIn
          ? {
              state: "ready",
              kind: body.authMethod === "claude.ai" ? "subscription" : "api-key",
              plan: body.subscriptionType ? body.subscriptionType : undefined,
              account: body.email,
            }
          : { state: "signed-out" };
      } catch {
        auth = { state: status.code === 0 ? "ready" : "signed-out" };
      }
      if (env.ANTHROPIC_API_KEY && auth.state !== "ready") {
        auth = { state: "ready", kind: "api-key" };
      }
    }
    return {
      installed,
      version: installed ? version.stdout.trim().split(/\s+/)[0] : undefined,
      auth,
      models: CLAUDE_MODELS,
      lockdownProven: true,
      message: installed
        ? auth.state === "signed-out"
          ? "Claude Code is installed but not signed in on this machine."
          : undefined
        : undefined,
    };
  },
  start,
};
