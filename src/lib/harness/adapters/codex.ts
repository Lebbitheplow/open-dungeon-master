// Codex, driven through `codex app-server` (JSON-RPC over stdio), the same
// protocol T3 Code uses.
//
// Run for real on 2026-10-07 against Codex 0.159.2 and on 2026-10-09 against
// 0.162.1 with a ChatGPT sign-in (scripts/smoke-harness.mjs, HARNESS=codex):
// every test stage and narrated turns. The admin page still marks the
// lockdown unproven on each install until its own test turn passes.
//
// What the model is sent, checked on 0.162.1 on 2026-10-14 by recording the
// request Codex makes: ODM's system prompt as the one developer block, ODM's
// tools, and five tools of Codex's own that no setting removes: apply_patch
// (openai/codex#8161 was closed as not planned), request_user_input
// (answered empty) and the three MCP resource readers, which see only ODM's
// server. Nothing of the admin's own: Codex reads their AGENTS.md from its
// home whatever the settings say, so each run gets a home of its own
// (prepareCodexHome) and refuses to start if Codex names any instructions it
// loaded; their skills, plugins and MCP servers are switched off. Codex's
// shell, web search, image viewer, apps, sub-agents, goals, clock and
// code-mode runner are gone, as are its permissions, collaboration mode and
// environment blocks.
//
// Lockdown, "contained" while apply_patch remains: a read-only sandbox,
// approvals set to never with ODM declining every command or file-change
// approval that is still requested, and a scratch folder as its working
// directory, holding only the run's own Codex home. Codex reports any setting
// it does not recognise as a `configWarning` notification; the probe listens
// for it and the admin card shows the key, so the next rename is seen rather
// than silently ignored.

import { existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { noteSpeed } from "@/lib/speed-status";
import os from "node:os";
import path from "node:path";
import { onWindows } from "../../host-platform.ts";
import { startJsonRpc } from "../jsonrpc-stdio.ts";
import { runProgram } from "../process.ts";
import { isHarnessEffort } from "../types.ts";
import type { HarnessAdapter, HarnessConfig, HarnessModel, HarnessStartOptions, HarnessStatus, HarnessUsage } from "../types.ts";

const TOKEN_ENV = "ODM_MCP_TOKEN";

export function codexHome(env: Record<string, string | undefined>): string {
  return env.CODEX_HOME || path.join(env.HOME || os.homedir(), ".codex");
}

// What a run's own Codex home holds of the admin's: the sign-in, their
// config (a provider or an API-key setup lives there) and the installation id.
// Their AGENTS.md, skills and plugins stay behind, and the stores Codex keeps
// go with the run folder.
const LINKED_FROM_ADMIN_HOME = ["auth.json", "config.toml", "installation_id"] as const;

// Codex rewrites auth.json in place when it refreshes the sign-in, so through
// a link the refreshed tokens land in the admin's own file. Windows needs a
// privilege for a file symlink but none for a hard link, and its temp folder
// usually sits on the profile's drive (codexHomeTrouble when it does not).
export function prepareCodexHome(adminHome: string, runHome: string): void {
  mkdirSync(runHome, { recursive: true });
  for (const name of LINKED_FROM_ADMIN_HOME) {
    const target = path.join(adminHome, name);
    if (existsSync(target)) {
      (onWindows() ? linkSync : symlinkSync)(target, path.join(runHome, name));
    }
  }
}

export type CodexCatalogModel = {
  slug: string;
  supported_reasoning_levels: Array<{ effort: string }>;
  [key: string]: unknown;
};

// `codex debug models`: the catalog this Codex runs with for this sign-in.
export function parseCodexCatalog(raw: string): CodexCatalogModel[] {
  const catalog = JSON.parse(raw) as { models?: unknown };
  const models = Array.isArray(catalog.models) ? (catalog.models as CodexCatalogModel[]) : [];
  if (models.length === 0 || !models.every((model) => typeof model.slug === "string" && Array.isArray(model.supported_reasoning_levels))) {
    throw new Error("Codex listed no models it can run.");
  }
  return models;
}

// Current models are listed as "code_mode_only": every tool, ODM's included,
// is reached through Codex's own JavaScript runner after a search, and a
// clock and a message tool ride along. The same catalog marked "direct" puts
// ODM's tools in the request, callable on the first step.
export function directCatalog(models: readonly CodexCatalogModel[]): string {
  return JSON.stringify({
    models: models.map((model) => ({ ...model, tool_mode: "direct", supports_search_tool: false, experimental_supported_tools: [] })),
  });
}

// The admin's effort, as long as the chosen model offers it; otherwise the
// model runs at its own default (the admin card says so).
export function codexEffort(
  models: readonly CodexCatalogModel[],
  model: string,
  effort: HarnessConfig["effort"],
): string | null {
  const levels = models.find((entry) => entry.slug === model)?.supported_reasoning_levels ?? [];
  return effort && levels.some((level) => level.effort === effort) ? effort : null;
}

export type CodexTokens = { inputTokens: number; outputTokens: number };

// `thread/tokenUsage/updated` reports the thread's running total. Codex's
// input already counts the cached prompt, and its output the reasoning: what
// the ledger counts for an OpenAI-compatible backend.
export function codexTokenTotal(params: Record<string, unknown>): CodexTokens | null {
  const total = (params.tokenUsage as { total?: { inputTokens?: unknown; outputTokens?: unknown } } | undefined)?.total;
  return typeof total?.inputTokens === "number" && typeof total.outputTokens === "number"
    ? { inputTokens: total.inputTokens, outputTokens: total.outputTokens }
    : null;
}

export function codexTurnUsage(atTurnStart: CodexTokens, now: CodexTokens): HarnessUsage {
  return { inputTokens: now.inputTokens - atTurnStart.inputTokens, outputTokens: now.outputTokens - atTurnStart.outputTokens };
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
  catalogPath: string | null;
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
    // What the direct catalog (directCatalog) still lets Codex add, each
    // checked against the request it sends: goals, plugins (which bring
    // skills and MCP servers of their own), the list of Codex's own skills,
    // and its blocks beside ODM's prompt: sandbox rules, collaboration mode,
    // and the folder, shell, date and timezone it runs in.
    ["features.goals", false],
    ["features.plugins", false],
    ["skills.include_instructions", false],
    ["include_permissions_instructions", false],
    ["include_collaboration_mode_instructions", false],
    ["include_environment_context", false],
    ["sandbox_mode", "read-only"],
    ["approval_policy", "never"],
    ["check_for_update_on_startup", false],
    ["history.persistence", "none"],
  ];
  if (options.catalogPath) {
    overrides.push(["model_catalog_json", options.catalogPath]);
  }
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

// `codex debug models` took ~0.5 s in each fresh run home (measured
// 2026-10-17, Codex 0.162.1), and every agent turn starts one. Its answer
// depends on the binary and the sign-in, so it is kept for a few minutes per
// binary, its modification time and those of the admin's auth and config;
// each run still gets its own home and catalog file, as before
// (docs/agent-context-efficiency-audit-2026-10-17.md, additional item 4).
const CATALOG_TTL_MS = 5 * 60_000;

declare global {
  var __odmCodexCatalogs: Map<string, { at: number; stdout: string }> | undefined;
}

function modified(file: string): number {
  try {
    return statSync(file).mtimeMs;
  } catch {
    return 0;
  }
}

export function codexCatalogKey(binary: string, adminHome: string): string {
  return [binary, modified(binary), modified(path.join(adminHome, "auth.json")), modified(path.join(adminHome, "config.toml"))].join("|");
}

async function codexCatalogText(binary: string, adminHome: string, env: Record<string, string>, cwd: string): Promise<string> {
  const cache = (globalThis.__odmCodexCatalogs ??= new Map());
  const key = codexCatalogKey(binary, adminHome);
  const known = cache.get(key);
  if (known && Date.now() - known.at < CATALOG_TTL_MS) {
    return known.stdout;
  }
  const dumped = await runProgram(binary, ["debug", "models"], env, 30_000, cwd, Number.POSITIVE_INFINITY);
  if (dumped.code !== 0) {
    throw new Error(`Codex could not list its models: ${dumped.stderr.split("\n").filter(Boolean).slice(-2).join(" ").slice(0, 400)}`);
  }
  cache.set(key, { at: Date.now(), stdout: dumped.stdout });
  return dumped.stdout;
}

async function start(options: HarnessStartOptions) {
  const adminHome = codexHome(options.env);
  const runHome = path.join(options.cwd, "codex-home");
  try {
    prepareCodexHome(adminHome, runHome);
  } catch (error) {
    throw new Error(codexHomeTrouble(error));
  }
  const env = { ...options.env, CODEX_HOME: runHome };
  // The whole catalog: Codex takes this file in place of its own list.
  const catalog = parseCodexCatalog(await codexCatalogText(options.binary, adminHome, env, options.cwd));
  const catalogPath = path.join(runHome, "catalog.json");
  writeFileSync(catalogPath, directCatalog(catalog));
  let configToml = "";
  try {
    const file = path.join(adminHome, "config.toml");
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
    catalogPath,
  });
  let closed = false;
  let tokens: CodexTokens = { inputTokens: 0, outputTokens: 0 };
  let tokensAtTurnStart = tokens;
  let threadId = "";
  let lastMessage = "";
  const agentMessages = new Map<string, string>();

  const peer = startJsonRpc(
    options.binary,
    args,
    { cwd: options.cwd, env: { ...env, ...(options.mcp ? { [TOKEN_ENV]: options.mcp.token } : {}) } },
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
                bytes = readFileSync(/*turbopackIgnore: true*/ item.savedPath);
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
          // A failed turn ends without a turn_end, so the tokens it spent
          // are counted with the next one that finishes.
          if (turn.status === "failed" || turn.error) {
            const message = turn.error?.message ?? "Codex could not finish the turn.";
            options.onEvent({
              type: "error",
              kind: /limit|quota|429/i.test(message) ? "limit" : /auth|log ?in|401/i.test(message) ? "signed-out" : "crash",
              message,
            });
            return;
          }
          options.onEvent({ type: "turn_end", text: lastMessage.trim(), usage: codexTurnUsage(tokensAtTurnStart, tokens) });
          tokensAtTurnStart = tokens;
          lastMessage = "";
          agentMessages.clear();
          return;
        }
        if (method === "thread/tokenUsage/updated") {
          tokens = codexTokenTotal(params) ?? tokens;
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
  const started = await peer.request<{
    thread?: { id?: string };
    threadId?: string;
    serviceTier?: string | null;
    model: string;
    instructionSources?: string[];
  }>("thread/start", {
    cwd: options.cwd,
    approvalPolicy: "never",
    sandbox: "read-only",
    ephemeral: true,
    baseInstructions: options.system,
    ...(options.model ? { model: options.model } : {}),
    // Fast for this thread alone (issue 255): the app-server's own
    // parameter, so the user's config.toml is never changed.
    ...(options.speed ? { serviceTier: "fast" } : {}),
  });
  if (options.speed) {
    noteSpeed(options.speed.role === "utility" ? "agent-utility" : "agent-story", {
      model: options.model,
      reported: typeof started.serviceTier === "string" ? started.serviceTier : null,
    });
  }
  threadId = started.thread?.id ?? started.threadId ?? "";
  if (!threadId) {
    peer.kill();
    throw new Error("Codex did not start a thread.");
  }
  // Codex names every AGENTS.md it loaded; the run's own home holds none, so
  // one here came from somewhere ODM did not expect, and nothing is sent.
  const loaded = started.instructionSources ?? [];
  if (loaded.length > 0) {
    const message = `Codex loaded instructions of its own (${loaded.join(", ")}), so no turn was started.`;
    peer.kill();
    options.onEvent({ type: "error", kind: "lockdown", message });
    throw new Error(message);
  }
  // Checked against the model the thread runs on, the program's default
  // included, as opencode's adapter does.
  const effort = codexEffort(catalog, started.model, options.effort);
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
          ...(effort ? { effort } : {}),
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

// `model/list`'s entry for one model, as far as the card reads it.
type CodexListedModel = {
  id?: string;
  model?: string;
  displayName?: string;
  serviceTiers?: Array<{ id?: string }>;
  supportedReasoningEfforts?: Array<{ reasoningEffort?: string }>;
  // The model Codex runs when none is chosen.
  isDefault?: boolean;
};

export function codexModel(entry: CodexListedModel): HarnessModel | null {
  const id = entry.model ?? entry.id;
  if (!id) {
    return null;
  }
  return {
    id,
    label: entry.displayName ?? id,
    // The tiers this sign-in offers for the model (issue 255).
    fast: (entry.serviceTiers ?? []).some((tier) => /^(fast|priority)$/i.test(tier.id ?? "")),
    efforts: (entry.supportedReasoningEfforts ?? [])
      .map((level) => level.reasoningEffort ?? "")
      .filter(isHarnessEffort),
  };
}

// Shown on the card when a run could not get its own Codex home: every run
// would fail the same way. On Windows the sign-in is hard-linked, which only
// works on the drive the temp folder is on.
export function codexHomeTrouble(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  const detail = error instanceof Error ? error.message : String(error);
  return code === "EXDEV"
    ? `A table's Codex run links your Codex sign-in into a folder of its own, and your Codex folder is on another drive than the temp folder (${detail}). Move CODEX_HOME to the temp folder's drive.`
    : `A table's Codex run links your Codex sign-in into a folder of its own, and that failed here (${detail}).`;
}

async function probeAppServer(binary: string, env: Record<string, string>, cwd: string) {
  const models: HarnessModel[] = [];
  let defaultEfforts: HarnessModel["efforts"];
  const ignored: string[] = [];
  let auth: { state: "ready" | "signed-out" | "unknown"; kind?: "subscription" | "api-key"; plan?: string; account?: string } = {
    state: "unknown",
  };
  // Started with the table's own lockdown flags, so that a key this version
  // of Codex no longer recognises is reported here, on the admin card,
  // rather than discovered when a turn has already run without it.
  const peer = startJsonRpc(binary, codexArgs({ mcpUrl: null, images: false, disableServers: [], catalogPath: null }), { cwd, env }, {
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
        .request<{ data?: CodexListedModel[]; nextCursor?: string }>(
          "model/list",
          cursor ? { cursor } : {},
          15_000,
        )
        .catch(() => null);
      for (const entry of listed?.data ?? []) {
        const model = codexModel(entry);
        if (model) {
          models.push(model);
          if (entry.isDefault) {
            defaultEfforts = model.efforts;
          }
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
  return { auth, models, defaultEfforts, ignored };
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
    // The same kind of home a run gets, so the card shows what a run will see.
    const cwd = mkdtempSync(path.join(os.tmpdir(), "odm-codex-probe-"));
    const notes: string[] = [];
    let probed: { auth: HarnessStatus["auth"]; models: HarnessModel[]; defaultEfforts?: HarnessModel["efforts"]; ignored: string[] } = {
      auth: { state: "unknown" },
      models: [],
      ignored: [],
    };
    try {
      const runHome = path.join(cwd, "codex-home");
      prepareCodexHome(codexHome(env), runHome);
      probed = await probeAppServer(binary, { ...env, CODEX_HOME: runHome }, cwd).catch(() => probed);
    } catch (error) {
      notes.push(codexHomeTrouble(error));
    } finally {
      // Best effort, as the bridge's own run folders: on Windows Codex may
      // still hold it while going down.
      try {
        rmSync(cwd, { recursive: true, force: true });
      } catch {
        // A temp folder.
      }
    }
    const { auth, models, defaultEfforts, ignored } = probed;
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
      defaultEfforts,
      lockdownProven: false,
      message: notes.length > 0 ? notes.join(" ") : undefined,
    };
  },
  start,
};
