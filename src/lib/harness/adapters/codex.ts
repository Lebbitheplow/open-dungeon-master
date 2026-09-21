// Codex, driven through `codex app-server` (JSON-RPC over stdio), the same
// protocol T3 Code uses.
//
// NOT YET RUN on a real install (Codex is not installed on the machine this
// was written on), so the admin page marks its lockdown unproven until the
// probe's test turn passes.
//
// Lockdown, "contained": Codex has no switch that removes its apply_patch
// tool (openai/codex#8161 was closed as not planned). What it gets instead:
// the shell, unified exec, web search, image viewing, apps and sub-agents
// all switched off; a read-only sandbox; approvals set to never, with ODM
// declining every command or file-change approval that is still requested;
// an empty scratch folder as its working directory; and the admin's own MCP
// servers disabled by name so only ODM's is connected.

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
    ["tools.view_image", false],
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

async function probeAppServer(binary: string, env: Record<string, string>) {
  const cwd = os.tmpdir();
  const models: HarnessModel[] = [];
  let auth: { state: "ready" | "signed-out" | "unknown"; kind?: "subscription" | "api-key"; plan?: string; account?: string } = {
    state: "unknown",
  };
  const peer = startJsonRpc(binary, ["app-server"], { cwd, env }, {
    onNotification: () => undefined,
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
  return { auth, models };
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
    const { auth, models } = await probeAppServer(binary, env).catch(() => ({
      auth: { state: "unknown" as const },
      models: [] as HarnessModel[],
    }));
    return {
      installed,
      version: version.stdout.trim().split(/\s+/).pop(),
      auth,
      models,
      lockdownProven: false,
      message: auth.state === "signed-out" ? "Codex is installed but not signed in on this machine." : undefined,
    };
  },
  start,
};
