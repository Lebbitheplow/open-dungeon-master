// Codex, driven through `codex app-server` (JSON-RPC over stdio), the same
// protocol T3 Code uses.
//
// Run for real on 2026-10-07 against Codex 0.159.2 and on 2026-10-09 against
// 0.162.1 with a ChatGPT sign-in (scripts/smoke-harness.mjs, HARNESS=codex):
// every test stage and narrated turns. The admin page still marks the
// lockdown unproven on each install until its own test turn passes.
//
// Lockdown, "contained": Codex has no switch that removes its apply_patch
// tool (openai/codex#8161 was closed as not planned). What it gets instead:
// the shell, web search, image viewing, apps and sub-agents all switched
// off; a read-only sandbox; approvals set to never, with ODM declining every
// command or file-change approval that is still requested; an empty scratch
// folder as its working directory; and the admin's own MCP servers disabled
// by name so only ODM's is connected.
//
// The switches were checked on 2026-10-09 by asking Codex itself to name its
// tools under these flags (0.159.2 and 0.162.1 agree): `features.view_image`
// and `agents.enabled` are the keys that remove the image viewer and the
// collaboration tools; `tools.view_image` never existed and
// `features.multi_agent` does not cover the current models. What stays is
// Codex's own code-mode runner (`exec`/`wait`, JavaScript over its own
// tools, no shell), goals, the clock, request_user_input (answered empty)
// and apply_patch, all inside the read-only sandbox. Codex reports any
// setting it does not recognise as a `configWarning` notification; the probe
// listens for it and the admin card shows the key, so the next rename is
// seen rather than silently ignored.

import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { startJsonRpc } from "../jsonrpc-stdio.ts";
import { runProgram } from "../process.ts";
import type { HarnessAdapter, HarnessModel, HarnessStartOptions } from "../types.ts";

const TOKEN_ENV = "ODM_MCP_TOKEN";

export function codexHome(env: Record<string, string | undefined>): string {
  return env.CODEX_HOME || path.join(env.HOME || os.homedir(), ".codex");
}

// Names of MCP servers in the admin's own Codex config, to switch off.
export function userCodexMcpServers(configToml: string): string[] {
  const names = new Set<string>();
  for (const match of configToml.matchAll(/^\s*\[mcp_servers\.("?)([^\]."]+)\1\]/gm)) {
    names.add(match[2]);
  }
  return [...names].filter((name) => name !== "odm");
}

function toml(value: string | boolean | number): string {
  return typeof value === "string" ? JSON.stringify(value) : String(value);
}

// Pure, so scripts/test-harness-args.mjs can pin every override.
export function codexArgs(options: {
  mcpUrl: string | null;
  images: boolean;
  disableServers: readonly string[];
}): string[] {
  const overrides: Array<[string, string | boolean | number]> = [
    ["features.shell_tool", false],
    ["features.unified_exec", false],
    ["features.apps", false],
    ["features.multi_agent", false],
    ["features.image_generation", options.images],
    // The image viewer is a feature flag, not a `tools` entry: Codex ignores
    // `tools.view_image` with a warning and keeps the tool.
    ["features.view_image", false],
    // The collaboration (sub-agent) tools. On current models they are not
    // governed by `features.multi_agent`; this is the switch that removes
    // them, and it is honoured from 0.159.2 on.
    ["agents.enabled", false],
    ["web_search", "disabled"],
    ["sandbox_mode", "read-only"],
    ["approval_policy", "never"],
    ["check_for_update_on_startup", false],
    ["history.persistence", "none"],
  ];
  for (const name of options.disableServers) {
    overrides.push([`mcp_servers.${name}.enabled`, false]);
  }
  if (options.mcpUrl) {
    overrides.push(["mcp_servers.odm.url", options.mcpUrl]);
    overrides.push(["mcp_servers.odm.bearer_token_env_var", TOKEN_ENV]);
    overrides.push(["mcp_servers.odm.tool_timeout_sec", 600]);
    overrides.push(["mcp_servers.odm.startup_timeout_sec", 30]);
    // Current Codex asks for approval before every MCP tool call, and with
    // approval_policy "never" that question is answered no: "MCP tool call
    // requires approval, but approval policy is never" (issue #131, seen on
    // 0.159.2). Pre-approving ODM's own server is the narrow fix: its tools
    // are the table's and nothing else, while commands and file changes keep
    // being refused, which the lockdown stage still proves.
    overrides.push(["mcp_servers.odm.default_tools_approval_mode", "approve"]);
  }
  const args = ["app-server"];
  for (const [key, value] of overrides) {
    args.push("-c", `${key}=${toml(value)}`);
  }
  return args;
}

function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

async function start(options: HarnessStartOptions) {
  let configToml = "";
  try {
    const file = path.join(codexHome(options.env), "config.toml");
    if (existsSync(file)) {
      configToml = readFileSync(file, "utf8");
    }
  } catch {
    configToml = "";
  }
  const args = codexArgs({
    mcpUrl: options.mcp?.url ?? null,
    images: Boolean(options.images),
    disableServers: userCodexMcpServers(configToml),
  });
  let closed = false;
  let threadId = "";
  let lastMessage = "";
  const agentMessages = new Map<string, string>();

  const peer = startJsonRpc(
    options.binary,
    args,
    { cwd: options.cwd, env: { ...options.env, ...(options.mcp ? { [TOKEN_ENV]: options.mcp.token } : {}) } },
    {
      onNotification(method, params) {
        if (method === "item/agentMessage/delta") {
          const delta = asText(params.delta);
          const itemId = asText(params.itemId);
          if (delta) {
            agentMessages.set(itemId, (agentMessages.get(itemId) ?? "") + delta);
            options.onEvent({ type: "delta", text: delta });
          }
          return;
        }
        if (method === "item/completed") {
          const item = (params.item ?? {}) as Record<string, unknown>;
          if (item.type === "agentMessage") {
            lastMessage = asText(item.text) || agentMessages.get(asText(item.id)) || lastMessage;
          } else if (item.type === "imageGeneration") {
            // Either the bytes ride in `result` (base64) or the picture was
            // saved to disk; both are checked by the image runner before use.
            let bytes: Buffer | null = null;
            if (typeof item.result === "string" && item.result) {
              try {
                bytes = Buffer.from(item.result, "base64");
              } catch {
                bytes = null;
              }
            }
            if ((!bytes || bytes.length < 64) && typeof item.savedPath === "string" && item.savedPath) {
              try {
                bytes = readFileSync(item.savedPath);
              } catch {
                bytes = null;
              }
            }
            if (bytes && bytes.length > 64) {
              options.onEvent({ type: "image", bytes, mime: "image/png" });
            }
          } else if (item.type === "commandExecution" || item.type === "fileChange") {
            // Should never happen with the shell off and a read-only sandbox.
            // If it does, the lockdown did not hold: stop.
            options.onEvent({
              type: "error",
              kind: "lockdown",
              message: `Codex tried to use its own ${String(item.type)} tool, so the turn was stopped.`,
            });
            peer.kill();
          }
          return;
        }
        if (method === "turn/completed") {
          const turn = (params.turn ?? {}) as { status?: string; error?: { message?: string } };
          if (turn.status === "failed" || turn.error) {
            const message = turn.error?.message ?? "Codex could not finish the turn.";
            options.onEvent({
              type: "error",
              kind: /limit|quota|429/i.test(message) ? "limit" : /auth|log ?in|401/i.test(message) ? "signed-out" : "crash",
              message,
            });
            return;
          }
          options.onEvent({ type: "turn_end", text: lastMessage.trim() });
          lastMessage = "";
          agentMessages.clear();
          return;
        }
        if (method === "account/rateLimits/updated") {
          const limits = params.rateLimits as { primary?: { usedPercent?: number; resetsAt?: number } } | undefined;
          if (typeof limits?.primary?.usedPercent === "number") {
            options.onEvent({
              type: "rate_limit",
              utilization: limits.primary.usedPercent / 100,
              resetsAt: limits.primary.resetsAt,
            });
          }
          return;
        }
        if (method === "error") {
          const error = params.error as { message?: string } | undefined;
          if (error?.message) {
            options.onEvent({ type: "error", kind: "crash", message: error.message });
          }
        }
      },
      onRequest(method, params) {
        // Commands and file changes are refused outright; the lockdown is
        // what should stop them ever being asked for.
        if (method === "item/commandExecution/requestApproval" || method === "item/fileChange/requestApproval") {
          return { decision: "decline" };
        }
        if (method === "item/permissions/requestApproval") {
          return { decision: "decline" };
        }
        // ODM's own tools may ask to be confirmed; they are the point.
        if (method === "mcpServer/elicitation/request") {
          const server = asText(params.serverName ?? params.server);
          return server === "odm" ? { action: "accept", content: {} } : { action: "decline" };
        }
        if (method === "item/tool/requestUserInput") {
          return { answers: {} };
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
    clientInfo: { name: "open_dungeon_master", title: "Open Dungeon Master", version: "1" },
    capabilities: { experimentalApi: true },
  });
  peer.notify("initialized", {});
  const started = await peer.request<{ thread?: { id?: string }; threadId?: string }>("thread/start", {
    cwd: options.cwd,
    approvalPolicy: "never",
    sandbox: "read-only",
    ephemeral: true,
    baseInstructions: options.system,
    ...(options.model ? { model: options.model } : {}),
  });
  threadId = started.thread?.id ?? started.threadId ?? "";
  if (!threadId) {
    peer.kill();
    throw new Error("Codex did not start a thread.");
  }
  options.onEvent({ type: "ready", tools: [] });

  return {
    send(text: string) {
      peer
        .request("turn/start", {
          threadId,
          input: [{ type: "text", text }],
          approvalPolicy: "never",
          sandboxPolicy: { type: "readOnly" },
          ...(options.model ? { model: options.model } : {}),
          ...(options.effort ? { effort: options.effort === "max" || options.effort === "xhigh" ? "high" : options.effort } : {}),
        })
        .catch((error) =>
          options.onEvent({ type: "error", kind: "crash", message: error instanceof Error ? error.message : String(error) }),
        );
    },
    close() {
      closed = true;
      peer.request("turn/interrupt", { threadId }, 2_000).catch(() => undefined);
      peer.kill();
    },
  };
}

// The config keys named in a Codex `configWarning`, e.g.
// "  session-flags: `tools.view_image` is ignored." -> ["tools.view_image"].
export function ignoredCodexSettings(summary: string): string[] {
  return [...new Set([...summary.matchAll(/`([^`]+)` is ignored/g)].map((match) => match[1]))];
}

async function probeAppServer(binary: string, env: Record<string, string>) {
  const cwd = os.tmpdir();
  const models: HarnessModel[] = [];
  const ignored: string[] = [];
  let auth: { state: "ready" | "signed-out" | "unknown"; kind?: "subscription" | "api-key"; plan?: string; account?: string } = {
    state: "unknown",
  };
  // Started with the table's own lockdown flags, so that a key this version
  // of Codex no longer recognises is reported here, on the admin card,
  // rather than discovered when a turn has already run without it.
  const peer = startJsonRpc(binary, codexArgs({ mcpUrl: null, images: false, disableServers: [] }), { cwd, env }, {
    onNotification(method, params) {
      if (method === "configWarning") {
        ignored.push(...ignoredCodexSettings(asText(params.summary)));
      }
    },
    onRequest: () => ({}),
    onExit: () => undefined,
  });
  try {
    await peer.request("initialize", {
      clientInfo: { name: "open_dungeon_master", title: "Open Dungeon Master", version: "1" },
      capabilities: { experimentalApi: true },
    }, 20_000);
    peer.notify("initialized", {});
    const account = await peer
      .request<{ account?: { type?: string; email?: string; planType?: string } | null }>("account/read", {}, 15_000)
      .catch(() => null);
    if (account) {
      const info = account.account;
      auth = info
        ? {
            state: "ready",
            kind: info.type === "chatgpt" ? "subscription" : "api-key",
            plan: info.planType,
            account: info.email,
          }
        : { state: "signed-out" };
    }
    let cursor: string | undefined;
    for (let page = 0; page < 5; page += 1) {
      const listed = await peer
        .request<{ data?: Array<{ id?: string; model?: string; displayName?: string }>; nextCursor?: string }>(
          "model/list",
          cursor ? { cursor } : {},
          15_000,
        )
        .catch(() => null);
      for (const entry of listed?.data ?? []) {
        const id = entry.model ?? entry.id;
        if (id) {
          models.push({ id, label: entry.displayName ?? id, cheap: /mini|nano/i.test(id) });
        }
      }
      cursor = listed?.nextCursor;
      if (!cursor) {
        break;
      }
    }
  } finally {
    peer.kill();
  }
  return { auth, models, ignored };
}

export const codexAdapter: HarnessAdapter = {
  id: "codex",
  label: "Codex",
  binaryNames: ["codex"],
  installHint: "npm install -g @openai/codex",
  signInHint: "codex login",
  lockdown: "contained",
  paints: true,
  async probe(binary, env) {
    const version = await runProgram(binary, ["--version"], env, 15_000);
    const installed = version.code === 0;
    if (!installed) {
      return { installed: false, auth: { state: "unknown" }, models: [] };
    }
    const { auth, models, ignored } = await probeAppServer(binary, env).catch(() => ({
      auth: { state: "unknown" as const },
      models: [] as HarnessModel[],
      ignored: [] as string[],
    }));
    const notes: string[] = [];
    if (auth.state === "signed-out") {
      notes.push("Codex is installed but not signed in on this machine.");
    }
    if (ignored.length > 0) {
      notes.push(
        `This Codex ignores ${ignored.length === 1 ? "a setting" : "settings"} the lockdown relies on (${ignored.map((key) => `\`${key}\``).join(", ")}). Update Open Dungeon Master, or hold Codex at a version it supports.`,
      );
    }
    return {
      installed,
      version: version.stdout.trim().split(/\s+/).pop(),
      auth,
      models,
      lockdownProven: false,
      message: notes.length > 0 ? notes.join(" ") : undefined,
    };
  },
  start,
};
