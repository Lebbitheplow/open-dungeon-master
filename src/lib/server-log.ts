import { format } from "node:util";

// The server's own console, kept in memory for the admin's Server log
// (issue #383). Diagnosing a stuck turn, a player who cannot connect or a
// model that refuses used to mean reaching the machine's console: the
// terminal, `docker logs`, the journal or the desktop app's
// local-server.log. Every one of those still gets every line; this keeps
// the last few thousand as well, so an admin on a phone or across the
// network can read them in the app.
//
// Installed once per process from src/instrumentation.ts. Secrets are cut
// out twice: when a line is recorded (key and token shapes, and the values
// of the environment's own secrets) and again when it is read (the keys the
// admin saved in the panel, which can change while the server runs).

export type ServerLogLevel = "debug" | "info" | "warn" | "error";

export type ServerLogEntry = {
  seq: number;
  // Epoch millis.
  at: number;
  level: ServerLogLevel;
  text: string;
};

export const SERVER_LOG_CAPACITY = 2_000;
// One stack trace is a few kilobytes; a line past this was something else
// (a whole payload) and is cut.
const MAX_LINE_CHARS = 4_000;

type Store = {
  entries: ServerLogEntry[];
  seq: number;
  startedAt: number;
  installed: boolean;
  envSecrets: string[];
};

declare global {
  var __odmServerLog: Store | undefined;
}

function store(): Store {
  return (globalThis.__odmServerLog ??= {
    entries: [],
    seq: 0,
    startedAt: Date.now(),
    installed: false,
    envSecrets: [],
  });
}

const SECRET_NAME = /key|secret|token|password|passwd|credential/i;

// The values of the environment's own secrets, longest first so one that
// contains another is cut whole.
function envSecretValues(env: NodeJS.ProcessEnv = process.env): string[] {
  return Object.entries(env)
    .filter(([name, value]) => SECRET_NAME.test(name) && typeof value === "string" && value.trim().length >= 8)
    .map(([, value]) => String(value).trim())
    .sort((a, b) => b.length - a.length);
}

const PATTERNS: Array<[RegExp, string]> = [
  // Authorization headers, however they were printed.
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, "$1 [redacted]"],
  // Provider key shapes: OpenAI and OpenRouter's sk-..., and their kin.
  [/\b(?:sk|rk|pk)-[A-Za-z0-9_-]{12,}/g, "[redacted key]"],
  // name=value and "name": "value" for anything named like a secret.
  [
    /\b([A-Za-z_]*(?:api[_-]?key|apikey|token|secret|password|passwd|authorization|access[_-]?key)[A-Za-z_]*)(["']?\s*[:=]\s*["']?)([^\s"',&;]{4,})/gi,
    "$1$2[redacted]",
  ],
  // Keys carried in a URL's query.
  [/([?&](?:key|token|api_key|apikey|access_token|sig|signature)=)[^&\s"']+/gi, "$1[redacted]"],
];

export function redactSecrets(text: string, secrets: readonly string[] = []): string {
  let out = text;
  for (const secret of secrets) {
    if (secret) {
      out = out.split(secret).join("[redacted]");
    }
  }
  for (const [pattern, replacement] of PATTERNS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

const METHODS: Array<["debug" | "log" | "info" | "warn" | "error", ServerLogLevel]> = [
  ["debug", "debug"],
  ["log", "info"],
  ["info", "info"],
  ["warn", "warn"],
  ["error", "error"],
];

// Keeps a line. Never throws: a log that cannot be kept must not take the
// call that wrote it down with it.
export function recordServerLog(level: ServerLogLevel, args: unknown[]): void {
  try {
    const log = store();
    let text = format(...args);
    if (text.length > MAX_LINE_CHARS) {
      text = `${text.slice(0, MAX_LINE_CHARS)} [... ${text.length - MAX_LINE_CHARS} more characters]`;
    }
    log.seq += 1;
    log.entries.push({ seq: log.seq, at: Date.now(), level, text: redactSecrets(text, log.envSecrets) });
    if (log.entries.length > SERVER_LOG_CAPACITY) {
      log.entries.splice(0, log.entries.length - SERVER_LOG_CAPACITY);
    }
  } catch {
    // Nothing to do: the console itself already printed the line.
  }
}

export function installServerLog(): void {
  const log = store();
  if (log.installed) {
    return;
  }
  log.installed = true;
  log.envSecrets = envSecretValues();
  for (const [method, level] of METHODS) {
    const original = console[method].bind(console);
    console[method] = (...args: unknown[]) => {
      original(...args);
      recordServerLog(level, args);
    };
  }
}

export type ServerLogPage = {
  entries: ServerLogEntry[];
  latestSeq: number;
  // The oldest line still kept; anything before it scrolled out.
  firstSeq: number;
  startedAt: number;
  capacity: number;
  installed: boolean;
};

// The lines after `after`, at most `limit` of the newest, with the secrets
// the admin saved cut out as well.
export function readServerLog(options: { after?: number; limit?: number; secrets?: readonly string[] } = {}): ServerLogPage {
  const log = store();
  const after = Math.max(0, Math.floor(options.after ?? 0));
  const limit = Math.max(1, Math.min(SERVER_LOG_CAPACITY, Math.floor(options.limit ?? SERVER_LOG_CAPACITY)));
  const secrets = [...(options.secrets ?? [])].filter((value) => value.length >= 8).sort((a, b) => b.length - a.length);
  const fresh = log.entries.filter((entry) => entry.seq > after).slice(-limit);
  return {
    entries: secrets.length ? fresh.map((entry) => ({ ...entry, text: redactSecrets(entry.text, secrets) })) : fresh,
    latestSeq: log.seq,
    firstSeq: log.entries[0]?.seq ?? log.seq + 1,
    startedAt: log.startedAt,
    capacity: SERVER_LOG_CAPACITY,
    installed: log.installed,
  };
}

// Every string in a config object held under a secret-looking name: the
// admin panel's keys, whatever section they live in.
export function secretValuesIn(value: unknown, name = ""): string[] {
  if (typeof value === "string") {
    return SECRET_NAME.test(name) && value.trim().length >= 8 ? [value.trim()] : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => secretValuesIn(item, name));
  }
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).flatMap(([key, item]) => secretValuesIn(item, key));
  }
  return [];
}

// The whole kept log as a text file, oldest first.
export function serverLogText(entries: readonly ServerLogEntry[]): string {
  return entries.map((entry) => `${new Date(entry.at).toISOString()} ${entry.level.toUpperCase().padEnd(5)} ${entry.text}`).join("\n") + "\n";
}
