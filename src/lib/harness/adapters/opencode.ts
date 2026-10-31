// opencode 2.x, driven through its own HTTP server (`opencode serve`).
//
// Proven on 2.0.27 against a recording fake model endpoint: a dedicated agent
// whose rules deny every action and then allow "odm_*" (opencode takes the
// last matching rule), with ODM's MCP server outside Code Mode, sends the
// model ODM's tools and nothing else. The rules opencode actually resolved
// are read back and checked before any prompt is sent.
//
// Each run gets an empty config folder of its own (OPENCODE_CONFIG_DIR),
// holding only the config ODM writes there, so the admin's plugins, MCP
// servers and global AGENTS.md never join it; only the providers and default
// models from their global config are carried over, so a model they set up
// there still runs. opencode keeps every session, transcript included, in its
// own store: the run deletes its session when it closes, and the next run
// deletes any that a killed server, or a killed ODM, left behind. That takes
// them off opencode's session list. It does not take everything: opencode
// lists each run's temp folder among its projects and has no way to remove
// one, and its database file can keep deleted text in pages SQLite has freed
// but not yet reused (docs/agent-harness.md).
//
// The server speaks HTTP with basic auth and streams events over SSE. Each
// run gets its own server on a free loopback port and a random password, and
// the server dies with the run. opencode 1.x had another API and is refused.

import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { onWindows } from "../../host-platform.ts";
import { parseJsonLine, runProgram, spawnProgram } from "../process.ts";
import { makeRunDir, removeRunDir } from "../run-dir.ts";
import type {
  HarnessAdapter,
  HarnessConfig,
  HarnessErrorKind,
  HarnessEvent,
  HarnessModel,
  HarnessStartOptions,
} from "../types.ts";
import { HARNESS_MAX_RUN_MS, isHarnessEffort } from "../types.ts";

const AGENT = "odm-dm";
const TITLE = "Open Game Master";
// Set on every session ODM creates and never by opencode, so the sweep can
// tell ODM's sessions from the admin's own.
const SESSION_TAG = { openDungeonMaster: "run" };
// The run folder bridge.ts makes for each run, directly in the temp dir.
const RUN_DIR_PREFIX = "odm-harness-";
const LOAD_TIMEOUT_MS = 30_000;
const TOOLS_SETTLE_MS = 1_000;
// A session this long past its last change is left behind even when its
// run folder is still there: no run lives longer than HARNESS_MAX_RUN_MS,
// and the margin covers a clock that is a little off.
const STALE_AFTER_MS = HARNESS_MAX_RUN_MS + 10 * 60_000;
// How many times opencode may fail to reach a provider before the turn
// stops with its reason: about six seconds of its backoff on 2.0.27, where
// the turn would otherwise wait out its whole timeout.
const TRANSPORT_TRIES = 3;

// opencode 2's own installer: the address opencode 1.19 itself uses for the
// jump to 2.x. Its npm package is @opencode/cli; `opencode-ai` is 1.x.
const INSTALL_HINT = "curl -fsSL https://opencode.ai/v2/install | bash";
const INSTALL_HINT_WINDOWS = "npm install -g @opencode/cli";
const NO_MODEL_MESSAGE = "opencode has no model it can use outside its own app. Connect a provider with `opencode auth login`.";

type Effect = "allow" | "ask" | "deny";
export type OpencodeRule = { action: string; resource: string; effect: Effect };

const LOCKDOWN_RULES = (mcp: boolean): OpencodeRule[] => [
  { action: "*", resource: "*", effect: "deny" },
  ...(mcp ? [{ action: "odm_*", resource: "*", effect: "allow" as const }] : []),
];

// What opencode 2.0.27 offers a model with every rule allowing, plus the
// browser it adds where it can, and a name it does not have yet: each must
// resolve to deny.
export const OPENCODE_BUILT_IN_ACTIONS = [
  "edit",
  "glob",
  "grep",
  "question",
  "read",
  "shell",
  "skill",
  "subagent",
  "webfetch",
  "websearch",
  "write",
  "execute",
  "browser",
  "a-tool-opencode-adds-later",
];

// What the admin's global config gives a run: the providers they set up, in
// 1.x's shape (`provider`, which opencode 2 converts itself, and only under
// that key) and in 2.x's (`providers`), and the models they chose as the
// defaults (`model`, and 1.x's `small_model`, which opencode 2 makes its
// title agent's model). Nothing else in it reaches ODM's run.
export type AdminOpencodeConfig = {
  provider: Record<string, unknown>;
  providers: Record<string, unknown>;
  model?: unknown;
  small_model?: unknown;
};

// Pure, so scripts/test-harness-logic.mjs can pin the lockdown.
export function opencodeConfig(options: {
  system: string;
  mcp: { url: string; token: string } | null;
  admin: AdminOpencodeConfig;
}) {
  const permissions = LOCKDOWN_RULES(Boolean(options.mcp));
  const { provider, providers, model, small_model } = options.admin;
  return {
    share: "disabled",
    snapshots: false,
    permissions,
    ...(Object.keys(provider).length ? { provider } : {}),
    ...(Object.keys(providers).length ? { providers } : {}),
    ...(model !== undefined ? { model } : {}),
    ...(small_model !== undefined ? { small_model } : {}),
    ...(options.mcp
      ? {
          mcp: {
            servers: {
              odm: {
                type: "remote",
                url: options.mcp.url,
                headers: { Authorization: `Bearer ${options.mcp.token}` },
                oauth: false,
                // Code Mode puts MCP tools behind opencode's own `execute`
                // tool, which the rules deny.
                codemode: false,
                timeout: { execution: 600_000 },
              },
            },
          },
        }
      : {}),
    agents: {
      [AGENT]: { mode: "primary", description: TITLE, system: options.system, permissions },
    },
  };
}

// opencode's own wildcard match (2.0.27): `*` is any run of characters and
// `?` any one, a trailing " *" may also match nothing, and a backslash counts
// as a slash.
function globMatches(pattern: string, value: string): boolean {
  let source = pattern
    .replaceAll("\\", "/")
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  if (source.endsWith(" .*")) {
    source = `${source.slice(0, -3)}( .*)?`;
  }
  return new RegExp(`^${source}$`, "s").test(value.replaceAll("\\", "/"));
}

// What an action may do under opencode's rules: the last rule matching it on
// every resource decides, and a later rule for some resources that is not a
// deny still opens that much. No rule at all counts as allow.
export function opencodeEffect(rules: readonly OpencodeRule[], action: string): Effect {
  let effect: Effect = "allow";
  for (const rule of rules) {
    if (!globMatches(rule.action, action)) {
      continue;
    }
    if (rule.resource === "*") {
      effect = rule.effect;
    } else if (effect === "deny" && rule.effect !== "deny") {
      effect = rule.effect;
    }
  }
  return effect;
}

export function opencodeLockdownHolds(rules: readonly OpencodeRule[], mcp: boolean): boolean {
  return (
    OPENCODE_BUILT_IN_ACTIONS.every((action) => opencodeEffect(rules, action) === "deny") &&
    opencodeEffect(rules, "odm_request_roll") === (mcp ? "allow" : "deny")
  );
}

type OpencodeModelInfo = {
  id: string;
  providerID: string;
  variants: Array<{ id: string }>;
  limit: { context: number };
};

// Free models opencode's own service offers refuse to answer anything that
// is not opencode's own app, so they are not offered. Every model says which
// efforts it has, an empty list included: the admin card offers only those.
export function opencodeModels(models: readonly OpencodeModelInfo[]): HarnessModel[] {
  return models
    .filter((model) => model.providerID !== "opencode")
    // Which is the light one is the catalog's call, by price
    // (src/lib/model-registry/catalog.ts enrichHarnessModels).
    .map((model) => {
      const id = `${model.providerID}/${model.id}`;
      const efforts = model.variants.map((variant) => variant.id).filter(isHarnessEffort);
      return {
        id,
        label: id,
        ...(model.limit.context > 0 ? { contextTokens: model.limit.context } : {}),
        efforts,
      };
    });
}

// The model a run asks for when ODM names none ("The program's own
// default"): opencode's own default when a run can use it, which is the
// admin's `model` when their config names one, else the first model a run
// can use. Left to itself opencode falls back to one of its own free models,
// which answer nothing outside its own app.
export function opencodeDefaultModel(
  models: readonly OpencodeModelInfo[],
  programDefault: OpencodeModelInfo | null,
): string | null {
  const usable = opencodeModels(models).map((model) => model.id);
  const preferred = programDefault ? `${programDefault.providerID}/${programDefault.id}` : "";
  return usable.includes(preferred) ? preferred : (usable[0] ?? null);
}

// opencode takes effort as the model's variant; a model that does not list
// the admin's effort runs at its own default.
export function opencodeVariant(
  models: readonly OpencodeModelInfo[],
  model: string,
  effort: HarnessConfig["effort"],
): string | undefined {
  const found = models.find((entry) => `${entry.providerID}/${entry.id}` === model);
  return effort && found?.variants.some((variant) => variant.id === effort) ? effort : undefined;
}

export function opencodeVersion(output: string): { version: string; supported: boolean } | null {
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(output);
  return match ? { version: match[0], supported: Number(match[1]) >= 2 } : null;
}

// opencode.jsonc allows comments and trailing commas; JSON.parse does not.
// Each comment becomes spaces (its line breaks kept) and each trailing comma
// one space, so a position in the result is the same line and column in the
// file. Strings pass through untouched.
function stripJsonc(text: string): string {
  let out = "";
  // Where the last comma went, until the next token says whether it trails.
  let comma = -1;
  for (let at = 0; at < text.length; at += 1) {
    const char = text[at];
    if (char === "/" && (text[at + 1] === "/" || text[at + 1] === "*")) {
      const line = text[at + 1] === "/";
      const close = line ? text.indexOf("\n", at) : text.indexOf("*/", at + 2);
      const end = close < 0 ? text.length : line ? close : close + 2;
      out += text.slice(at, end).replace(/[^\r\n]/g, " ");
      at = end - 1;
      continue;
    }
    if (char === " " || char === "\t" || char === "\n" || char === "\r") {
      out += char;
      continue;
    }
    if ((char === "}" || char === "]") && comma >= 0) {
      out = `${out.slice(0, comma)} ${out.slice(comma + 1)}`;
    }
    comma = char === "," ? out.length : -1;
    if (char === '"') {
      const end = /"(?:[^"\\]|\\.)*"/y;
      end.lastIndex = at;
      const string = end.exec(text);
      if (!string) {
        return out + text.slice(at);
      }
      out += string[0];
      at += string[0].length - 1;
    } else {
      out += char;
    }
  }
  return out;
}

// Where JSON text stops being JSON, as a line and column, or null when that
// cannot be told.
function jsonErrorPosition(json: string): { line: number; column: number } | null {
  const STRING = /"(?:[^"\\\u0000-\u001f]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*"/y;
  const LITERAL = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null/y;
  let at = 0;
  const skip = () => {
    while (json[at] === " " || json[at] === "\t" || json[at] === "\n" || json[at] === "\r") {
      at += 1;
    }
  };
  const take = (pattern: RegExp) => {
    pattern.lastIndex = at;
    const match = pattern.exec(json);
    at += match ? match[0].length : 0;
    return Boolean(match);
  };
  const value = (): boolean => {
    skip();
    const open = json[at];
    if (open !== "{" && open !== "[") {
      return take(open === '"' ? STRING : LITERAL);
    }
    const close = open === "{" ? "}" : "]";
    at += 1;
    skip();
    if (json[at] === close) {
      at += 1;
      return true;
    }
    for (;;) {
      if (close === "}") {
        skip();
        if (!take(STRING)) {
          return false;
        }
        skip();
        if (json[at] !== ":") {
          return false;
        }
        at += 1;
      }
      if (!value()) {
        return false;
      }
      skip();
      if (json[at] === close) {
        at += 1;
        return true;
      }
      if (json[at] !== ",") {
        return false;
      }
      at += 1;
    }
  };
  try {
    if (value()) {
      skip();
    }
  } catch {
    // Nested too deep to follow.
    return null;
  }
  const lines = json.slice(0, at).split("\n");
  return { line: lines.length, column: lines[lines.length - 1].length + 1 };
}

// Says where a config file stops being JSON, and nothing of what it holds.
class OpencodeConfigError extends Error {}

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

// What one global config file gives a run (AdminOpencodeConfig). opencode
// itself reads a file that starts with a byte order mark, as Windows
// PowerShell writes one, so it is skipped here too.
export function adminOpencodeConfig(text: string): AdminOpencodeConfig {
  const json = stripJsonc(text.startsWith("\uFEFF") ? text.slice(1) : text);
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    // JSON.parse's own message quotes the text around the mistake, and the
    // file holds API keys.
    const at = jsonErrorPosition(json);
    throw new OpencodeConfigError(`it is not valid JSON${at ? ` at line ${at.line}, column ${at.column}` : ""}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new OpencodeConfigError("it does not hold a JSON object");
  }
  const config = parsed as Record<string, unknown>;
  return {
    provider: record(config.provider),
    providers: record(config.providers),
    ...(typeof config.model === "string" || (config.model && typeof config.model === "object") ? { model: config.model } : {}),
    ...(typeof config.small_model === "string" ? { small_model: config.small_model } : {}),
  };
}

function readAdminConfig(env: Record<string, string>): AdminOpencodeConfig {
  const dir =
    env.OPENCODE_CONFIG_DIR ||
    path.join(env.XDG_CONFIG_HOME || path.join(env.HOME || os.homedir(), ".config"), "opencode");
  let admin: AdminOpencodeConfig = { provider: {}, providers: {} };
  for (const name of ["opencode.json", "opencode.jsonc"]) {
    const file = path.join(dir, name);
    if (!existsSync(file)) {
      continue;
    }
    let read: AdminOpencodeConfig;
    try {
      read = adminOpencodeConfig(readFileSync(file, "utf8"));
    } catch (error) {
      const why =
        error instanceof OpencodeConfigError
          ? error.message
          : `it could not be opened (${(error as NodeJS.ErrnoException).code ?? "unknown error"})`;
      throw new Error(`${file} could not be read: ${why}.`);
    }
    admin = {
      ...admin,
      ...read,
      provider: { ...admin.provider, ...read.provider },
      providers: { ...admin.providers, ...read.providers },
    };
  }
  return admin;
}

type OpencodeSession = {
  id: string;
  metadata?: Record<string, unknown>;
  location?: { directory?: string };
  time?: { updated?: number };
};

// Sessions a run left behind: ODM's tag, in a run folder directly in this
// server's temp dir, and either that folder gone (the server was killed
// before it could delete its session) or the session older than any run
// can be (ODM itself was killed, the desktop app quit mid-turn, and the
// folder stayed). A live run's folder exists until it closes, and its
// session is younger than that, so no running table is touched. `tmpdir` is
// the temp dir's real path and `canonical` gives a folder's (or null), so
// the two compare whatever form opencode reports: macOS's temp dir is a
// symlink, and Windows' may be a short name, in either slash or case.
export function staleOdmSessions(
  sessions: readonly OpencodeSession[],
  options: { tmpdir: string; now: number; exists: (dir: string) => boolean; canonical: (dir: string) => string | null },
): string[] {
  return sessions
    .filter((session) => {
      const directory = session.location?.directory ?? "";
      if (
        session.metadata?.openDungeonMaster !== SESSION_TAG.openDungeonMaster ||
        !directory ||
        !path.basename(directory).startsWith(RUN_DIR_PREFIX) ||
        options.canonical(path.dirname(path.resolve(directory))) !== options.tmpdir
      ) {
        return false;
      }
      const updated = session.time?.updated;
      return !options.exists(directory) || (typeof updated === "number" && options.now - updated > STALE_AFTER_MS);
    })
    .map((session) => session.id);
}

function canonicalDir(dir: string): string | null {
  try {
    return realpathSync.native(dir);
  } catch {
    return null;
  }
}

export type OpencodeTurn = { text: string; inputTokens: number; outputTokens: number };

type OpencodeEvent = { type: string; data: Record<string, unknown> };
type OpencodeError = { type?: string; message?: string };

function errorEvent(error: OpencodeError | undefined): HarnessEvent {
  return {
    type: "error",
    kind: error?.type === "provider.auth" ? "signed-out" : error?.type === "provider.rate-limit" ? "limit" : "crash",
    message: error?.message || "opencode could not finish the turn.",
  };
}

const count = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : 0);

// One event from opencode's stream, already known to be this run's session,
// as what ODM hears. Updates `turn`; reasoning is never passed on, the
// players must not see it.
export function readOpencodeEvent(turn: OpencodeTurn, event: OpencodeEvent): HarnessEvent[] {
  if (event.type === "session.text.delta") {
    if (typeof event.data.delta !== "string") {
      return [];
    }
    turn.text += event.data.delta;
    return [{ type: "delta", text: event.data.delta }];
  }
  if (event.type === "session.step.ended") {
    // opencode splits a step's prompt into uncached, cache-read and
    // cache-written tokens, and its reply into text and reasoning; the
    // ledger counts the whole prompt and everything generated, as an
    // OpenAI-compatible backend reports them. A figure it leaves out counts
    // as none.
    const tokens = record(event.data.tokens);
    const cache = record(tokens.cache);
    turn.inputTokens += count(tokens.input) + count(cache.read) + count(cache.write);
    turn.outputTokens += count(tokens.output) + count(tokens.reasoning);
    return [];
  }
  if (event.type === "session.execution.succeeded") {
    const ended: HarnessEvent = {
      type: "turn_end",
      text: turn.text.trim(),
      usage: { inputTokens: turn.inputTokens, outputTokens: turn.outputTokens },
    };
    Object.assign(turn, { text: "", inputTokens: 0, outputTokens: 0 });
    return [ended];
  }
  if (event.type === "session.execution.failed") {
    return [errorEvent(event.data.error as OpencodeError | undefined)];
  }
  if (event.type === "session.retry.scheduled") {
    const error = event.data.error as OpencodeError | undefined;
    // opencode retries a rate limit on its own backoff for as long as it
    // lasts; the turn stops instead, as it does for the other programs.
    if (error?.type === "provider.rate-limit") {
      return [errorEvent(error)];
    }
    // A provider it cannot reach (a local model server that is not
    // running) it retries for as long as the turn would wait, which then
    // ends with no reason given; a few tries are enough to say why. Retry
    // number N comes after N - 1 failed tries.
    if (error?.type === "provider.transport" && count(event.data.attempt) > TRANSPORT_TRIES) {
      return [
        {
          type: "error",
          kind: "crash",
          message: `opencode could not reach the model's provider: ${error.message || "no answer"}`,
        },
      ];
    }
  }
  return [];
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Polls until `check` gives a value or the directory's config had time to
// load.
async function waitFor<T>(check: () => Promise<T | null>): Promise<T | null> {
  for (const until = Date.now() + LOAD_TIMEOUT_MS; Date.now() < until; await sleep(150)) {
    const value = await check();
    if (value !== null) {
      return value;
    }
  }
  return null;
}

// opencode 1.19 reaches 2.x with `upgrade --major`; plain `upgrade` keeps it
// on 1.x.
function unsupportedMessage(version: string | undefined) {
  const install = onWindows() ? INSTALL_HINT_WINDOWS : INSTALL_HINT;
  return `${version ? `opencode ${version} is installed` : "This opencode is older than 2.x"}; Open Game Master drives opencode 2.x. Upgrade with \`opencode upgrade --major\` (opencode 1.19 or later), or install it with \`${install}\`.`;
}

type OpencodeApi = <T>(method: string, route: string, body?: unknown, missing?: T) => Promise<T>;

// A server on the run's own config folder. Resolves once it listens.
async function startServer(options: {
  binary: string;
  env: Record<string, string>;
  cwd: string;
  config: unknown;
  onExit: (code: number | null, stderr: string) => void;
}) {
  const port = await freePort();
  const password = randomBytes(24).toString("base64url");
  const authHeader = `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`;
  const base = `http://127.0.0.1:${port}`;
  const configDir = path.join(options.cwd, "opencode-config");
  mkdirSync(configDir, { recursive: true });
  // The run's whole config, in the folder opencode reads as its global one,
  // readable by this user alone. Not in an environment variable: a
  // campaign's system prompt runs to tens of kilobytes, more than one
  // reliably carries (Linux refuses 128 KiB, Windows caps a variable at
  // 32 K characters), and every program opencode starts inherits its
  // environment, provider keys carried over from the admin's config with it.
  writeFileSync(path.join(configDir, "opencode.json"), JSON.stringify(options.config), { mode: 0o600 });
  let settle: (listening: boolean) => void = () => undefined;
  const ready = new Promise<boolean>((resolve) => {
    settle = resolve;
  });
  const program = spawnProgram(options.binary, ["serve", "--hostname", "127.0.0.1", "--port", String(port)], {
    cwd: options.cwd,
    env: {
      ...options.env,
      OPENCODE_CONFIG_DIR: configDir,
      OPENCODE_DISABLE_PROJECT_CONFIG: "1",
      OPENCODE_SERVER_PASSWORD: password,
      OPENCODE_DISABLE_AUTOUPDATE: "1",
    },
    onLine: (line) => {
      if (/listening/i.test(line)) {
        settle(true);
      }
    },
    onExit: (code) => {
      settle(false);
      options.onExit(code, program.stderrTail());
    },
  });
  if (!(await Promise.race([ready, sleep(45_000).then(() => false)]))) {
    program.kill();
    throw new Error(`opencode's server did not start: ${program.stderrTail().trim().slice(-400) || "no answer within 45 seconds"}`);
  }

  // `missing` is the answer to a 404 where one is expected: the directory's
  // config loads after the server starts, and until then the agent is not
  // there.
  const api: OpencodeApi = async <T>(method: string, route: string, body?: unknown, missing?: T): Promise<T> => {
    const response = await fetch(`${base}${route}`, {
      method,
      headers: { authorization: authHeader, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (response.status === 404 && missing !== undefined) {
      return missing;
    }
    // opencode 1.x answers the routes it shares with 2.x (the session list
    // among them) with JSON, and those it lacks, ODM's agent first, with its
    // web app's page: the run stops there, before any session or prompt.
    if (response.headers.get("content-type")?.includes("text/html")) {
      throw new Error(unsupportedMessage(undefined));
    }
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`opencode ${method} ${route}: ${response.status} ${text.slice(0, 200)}`);
    }
    return (text ? JSON.parse(text) : null) as T;
  };
  return { program, base, authHeader, api };
}

async function sweepStaleSessions(api: OpencodeApi) {
  const tmpdir = realpathSync.native(os.tmpdir());
  const stale: string[] = [];
  let cursor: string | null = null;
  // The listing itself stays strict, so an opencode that answers it with
  // its web app's page (1.x) is refused here.
  do {
    const page: { data: OpencodeSession[]; cursor: { next: string | null } } = await api(
      "GET",
      `/api/session?search=${encodeURIComponent(TITLE)}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
    );
    stale.push(...staleOdmSessions(page.data, { tmpdir, now: Date.now(), exists: existsSync, canonical: canonicalDir }));
    cursor = page.data.length ? page.cursor.next : null;
  } while (cursor);
  // Clearing up never fails a run. A run starting at the same moment may
  // have deleted the same session already (404, which counts as done), and
  // a session that cannot be deleted now is tried again at the next start.
  try {
    for (const id of stale) {
      await api("DELETE", `/api/session/${id}`, undefined, null);
    }
  } catch (error) {
    console.warn(
      `[harness] opencode kept a session an earlier run left behind; the next run tries again: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function start(options: HarnessStartOptions) {
  return startOpencode(
    options,
    opencodeConfig({ system: options.system, mcp: options.mcp, admin: readAdminConfig(options.env) }),
  );
}

// start() with the config passed in: a check of the lockdown refusals hands
// it a config without ODM's agent, or with rules that allow more.
export async function startOpencode(options: HarnessStartOptions, config: unknown) {
  let closed = false;
  const server = await startServer({
    binary: options.binary,
    env: options.env,
    cwd: options.cwd,
    config,
    onExit: (code, stderr) => {
      if (!closed) {
        options.onEvent({ type: "error", kind: "crash", message: stderr.slice(-400) || `opencode exited (${code})` });
        options.onEvent({ type: "exit", code });
      }
    },
  });
  const { api, program } = server;
  const abort = new AbortController();
  let sessionId = "";

  const shutDown = async () => {
    closed = true;
    abort.abort();
    if (sessionId) {
      const id = sessionId;
      // A server that already went down cannot be asked, and one that hangs
      // must not keep the run open: either way the next run's sweep deletes
      // the session.
      await Promise.race([
        api("POST", `/api/session/${id}/interrupt`)
          .then(() => api("DELETE", `/api/session/${id}`))
          .catch(() => undefined),
        sleep(5_000),
      ]);
    }
    program.kill();
  };
  // Refuses the run before any prompt: the server goes, and the bridge hears
  // why before the start fails.
  const refuse = async (kind: HarnessErrorKind, message: string): Promise<never> => {
    await shutDown();
    options.onEvent({ type: "error", kind, message });
    throw new Error(message);
  };

  const turn: OpencodeTurn = { text: "", inputTokens: 0, outputTokens: 0 };
  void (async () => {
    const response = await fetch(`${server.base}/api/event`, {
      headers: { authorization: server.authHeader },
      signal: abort.signal,
    });
    if (!response.body) {
      throw new Error("opencode's event stream has no body.");
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      let index = buffer.indexOf("\n\n");
      while (index >= 0) {
        const data = buffer
          .slice(0, index)
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trim())
          .join("");
        buffer = buffer.slice(index + 2);
        index = buffer.indexOf("\n\n");
        // A frame that is not a JSON object carries nothing for ODM, and
        // must not end the stream for the frames after it.
        const event = data ? parseJsonLine(data) : null;
        const eventData = event ? record(event.data) : {};
        if (event && sessionId && eventData.sessionID === sessionId) {
          for (const heard of readOpencodeEvent(turn, { type: String(event.type), data: eventData })) {
            options.onEvent(heard);
          }
        }
      }
    }
  })().catch((error: unknown) => {
    if (!closed) {
      options.onEvent({ type: "error", kind: "crash", message: error instanceof Error ? error.message : String(error) });
    }
  });

  try {
    await sweepStaleSessions(api);

    const agent = await waitFor(() => api<{ data: { permissions: OpencodeRule[] } } | null>("GET", `/api/agent/${AGENT}`, undefined, null));
    if (!agent) {
      return await refuse("lockdown", `opencode did not load ODM's ${AGENT} agent, so no turn was started.`);
    }
    // The agent's rules as opencode resolved them (its defaults, any system
    // config, ODM's), checked alone: the session's rules come on top and
    // must not hide an agent that would allow more.
    if (!opencodeLockdownHolds(agent.data.permissions, Boolean(options.mcp))) {
      return await refuse("lockdown", "opencode's resolved rules allow more than ODM's tools, so no turn was started.");
    }

    // Every opencode model is named "provider/model"; anything else is no
    // choice at all, and runs on the default.
    const models = (await api<{ data: OpencodeModelInfo[] }>("GET", "/api/model")).data;
    let wanted = options.model.includes("/") ? options.model : "";
    if (!wanted) {
      const programDefault = await api<{ data: OpencodeModelInfo | null } | null>("GET", "/api/model/default", undefined, null);
      wanted = opencodeDefaultModel(models, programDefault?.data ?? null) ?? "";
      if (!wanted) {
        return await refuse("signed-out", NO_MODEL_MESSAGE);
      }
    }
    const [providerID, ...rest] = wanted.split("/");
    const variant = opencodeVariant(models, wanted, options.effort);
    const model = { providerID, id: rest.join("/"), ...(variant ? { variant } : {}) };
    const created = await api<{ data: { id: string } }>("POST", "/api/session", {
      title: TITLE,
      agent: AGENT,
      metadata: SESSION_TAG,
      permissions: LOCKDOWN_RULES(Boolean(options.mcp)),
      model,
    });
    sessionId = created.data.id;

    // A prompt sent before ODM's MCP server is connected goes out with no
    // tools: the directory's MCP servers connect after the server starts.
    if (options.mcp) {
      let status = "not listed";
      await waitFor(async () => {
        const servers = await api<{ data: Array<{ name: string; status: { status: string; error?: string } }> }>("GET", "/api/mcp");
        const odm = servers.data.find((entry) => entry.name === "odm");
        status = odm ? [odm.status.status, odm.status.error].filter(Boolean).join(": ") : "not listed";
        return status === "connected" || null;
      });
      if (status !== "connected") {
        return await refuse("crash", `opencode could not reach ODM's tools (MCP status: ${status}), so no turn was started.`);
      }
      // "connected" comes before the tools are offered: opencode rebuilds
      // its tool list from the server's 100 ms after it connects (2.0.27,
      // with no event to say when), and a prompt before that still goes out
      // with no tools.
      await sleep(TOOLS_SETTLE_MS);
    }
  } catch (error) {
    if (!closed) {
      await shutDown();
    }
    throw error;
  }

  options.onEvent({ type: "ready", tools: [] });

  return {
    send(text: string) {
      api("POST", `/api/session/${sessionId}/prompt`, { text }).catch((error: unknown) => {
        options.onEvent({ type: "error", kind: "crash", message: error instanceof Error ? error.message : String(error) });
      });
    },
    close() {
      void shutDown();
    },
  };
}

export const opencodeAdapter: HarnessAdapter = {
  id: "opencode",
  label: "opencode",
  // opencode 2's npm package installs it as `opencode2` too, which is 2.x
  // wherever a 1.x `opencode` is still installed as well.
  binaryNames: ["opencode2", "opencode"],
  installHint: INSTALL_HINT,
  installHintWindows: INSTALL_HINT_WINDOWS,
  signInHint: "opencode auth login",
  lockdown: "removed",
  paints: false,
  async probe(binary, env) {
    const printed = await runProgram(binary, ["--version"], env, 15_000);
    if (printed.code !== 0) {
      return { installed: false, auth: { state: "unknown" }, models: [] };
    }
    const version = opencodeVersion(printed.stdout);
    if (!version?.supported) {
      return {
        installed: true,
        version: version?.version,
        auth: { state: "unknown" },
        models: [],
        message: unsupportedMessage(version?.version),
      };
    }
    // `opencode models` asks the admin's background service, which runs
    // their plugins; a private server on the run's own config lists exactly
    // what a run can use.
    const cwd = makeRunDir("odm-opencode-probe-");
    let models: HarnessModel[];
    let defaultEfforts: HarnessModel["efforts"];
    try {
      const server = await startServer({
        binary,
        env,
        cwd,
        config: opencodeConfig({ system: "", mcp: null, admin: readAdminConfig(env) }),
        onExit: () => undefined,
      });
      try {
        const listed = (await server.api<{ data: OpencodeModelInfo[] }>("GET", "/api/model")).data;
        models = opencodeModels(listed);
        // The model a run on the program's default gets: its efforts are what
        // a blank model offers.
        const programDefault = await server.api<{ data: OpencodeModelInfo | null } | null>("GET", "/api/model/default", undefined, null);
        const defaultId = opencodeDefaultModel(listed, programDefault?.data ?? null);
        defaultEfforts = models.find((model) => model.id === defaultId)?.efforts;
      } finally {
        server.program.kill();
      }
    } finally {
      // Windows cannot remove the folder while opencode is still going down,
      // and it holds the admin's opencode config: it is tried again later and
      // swept if still left (run-dir.ts, issue 652). The probe's answer
      // stands either way.
      removeRunDir(cwd);
    }
    return {
      installed: true,
      version: version.version,
      auth: models.length ? { state: "ready", kind: "api-key" } : { state: "signed-out" },
      models,
      defaultEfforts,
      lockdownProven: true,
      message: models.length ? undefined : NO_MODEL_MESSAGE,
    };
  },
  start,
};
