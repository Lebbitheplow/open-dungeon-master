import type { ExportedTurn } from "@/lib/narrator-quality";
import { redactSecrets } from "@/lib/redact-secrets";
import { setupLines, type ReportSetup } from "@/lib/report-setup";

export type { ReportSetup } from "@/lib/report-setup";
export { BUG_REPORT_URL, bugReportUrl } from "@/lib/report-setup";

// The report bundle (issue #459): one file the server's admin saves to
// their own device and drags into a GitHub bug report. Only the admin may
// make one (the routes refuse everyone else): a player tells whoever runs
// the server, who can check its setup before anything reaches GitHub.
// Nothing here sends it anywhere; the privacy page's promise holds because
// the person attaches it themselves.
//
// At a table the admin's seat still decides the table's parts, below: an
// admin seated as a player gets a player's transcript and no turn records.
//
// Who may put what in it is decided here, once, as a pure function of the
// viewer the server resolved (src/lib/report-bundle-server.ts). The page
// only says which tick boxes were ticked: a part the viewer may not include
// is dropped whatever the request asked, and the transcript and the turn
// records are off unless asked for.
//
// The privacy rules, in the issue's words:
// - A turn's full record carries the DM's secret arc and the prompt, so only
//   whoever steers the story (the party lead at an AI table, the DM
//   otherwise) may include what the narrator did. Even then the prompt's text
//   is never copied: it holds every player's lines and the whispers. What
//   goes is the tool calls, the context trace and the call timings, and a
//   tool's arguments only for the storyteller tier and never for a whisper.
// - A transcript carries other players' messages. Only the reporter's own
//   lines and the DM's narration go; other players' lines, system lines and
//   whispers (kept apart from the transcript altogether) never do.
// - Every string in the bundle passes through the secret cutter last, with
//   the server's known key values, so a key a player pasted into chat or a
//   log line that printed a header is cut too.
//
// Pure: no "@/" import that touches the database, so the privacy suite
// (scripts/test-report-bundle.mjs) builds bundles from plain objects.

// 2: the setup names every AI piece and what to check first (src/lib/report-setup.ts).
export const REPORT_BUNDLE_FORMAT = 2;
// The last few turns: what the transcript, the timings and the records cover.
export const REPORT_TURNS = 5;
export const REPORT_LOG_LINES = 300;
export const PAGE_ERROR_LIMIT = 20;
const MAX_TEXT = 4_000;
const MAX_ERROR_TEXT = 1_000;

export type ReportPartId = "setup" | "pageErrors" | "turnTimings" | "serverLog" | "transcript" | "turnRecords";

export type ReportViewer = {
  // A global admin of this server.
  isAdmin: boolean;
  // Made at a table, rather than from Admin.
  atTable: boolean;
  // The party lead, or a person in a DM seat.
  leadOrDm: boolean;
  // Story authority (src/lib/dm/viewer.ts steersStory): the lead at an AI
  // table, the DM at a table a person runs.
  steersStory: boolean;
  // The tier above it: a person running the table, never a player.
  storytellerSecrets: boolean;
};

type ReportPart = {
  id: ReportPartId;
  label: string;
  hint: string;
  defaultOn: boolean;
  // Whether this viewer may include the part at all.
  allowed: (viewer: ReportViewer) => boolean;
  // Gathered in the browser, not by the server.
  fromBrowser?: true;
};

const PARTS: readonly ReportPart[] = [
  {
    id: "setup",
    label: "Version and setup",
    hint: "Versions, how the server and the app were installed, the server's machine, the DM mode, and every AI piece by kind and model (narrator, helper, agent program, pictures, narration, dictation), with what is below the supported minimum. No addresses or keys. It also fills in the form's Your setup.",
    defaultOn: true,
    allowed: () => true,
  },
  {
    id: "pageErrors",
    label: "Errors on this page",
    hint: "Errors the game pages hit in this browser, with keys and tokens cut out.",
    defaultOn: true,
    allowed: () => true,
    fromBrowser: true,
  },
  {
    id: "turnTimings",
    label: "Turn timings",
    hint: `The ids and timings of the last ${REPORT_TURNS} turns, how each call to the narrator ended, and how often the table had to fix the narrator lately, with ids hashed and no names.`,
    defaultOn: true,
    allowed: (viewer) => viewer.atTable && viewer.leadOrDm,
  },
  {
    id: "serverLog",
    label: "Server log",
    hint: `The last ${REPORT_LOG_LINES} lines of the server log, with keys and tokens cut out.`,
    defaultOn: true,
    allowed: (viewer) => viewer.isAdmin,
  },
  {
    id: "transcript",
    label: "Transcript of the last few turns",
    hint: `Your own lines and the DM's narration from the last ${REPORT_TURNS} turns. Never other players' lines or whispers.`,
    defaultOn: false,
    allowed: (viewer) => viewer.atTable,
  },
  {
    id: "turnRecords",
    label: "What the narrator did",
    hint: "The tools the narrator called and how its prompt was spent. It can show the secret story's shape, so read it before you share it.",
    defaultOn: false,
    allowed: (viewer) => viewer.atTable && viewer.steersStory,
  },
];

export type OfferedPart = { id: ReportPartId; label: string; hint: string; defaultOn: boolean; fromBrowser: boolean };

// The tick boxes this viewer sees, in order.
export function offeredParts(viewer: ReportViewer): OfferedPart[] {
  return PARTS.filter((part) => part.allowed(viewer)).map((part) => ({
    id: part.id,
    label: part.label,
    hint: part.hint,
    defaultOn: part.defaultOn,
    fromBrowser: Boolean(part.fromBrowser),
  }));
}

// What goes in, from what the page asked: only parts the viewer may include,
// a part the request did not mention at its default, and anything that is
// not a plain true or false read as off.
export function chosenParts(requested: unknown, viewer: ReportViewer): Set<ReportPartId> {
  const asked = requested && typeof requested === "object" && !Array.isArray(requested) ? (requested as Record<string, unknown>) : {};
  const chosen = new Set<ReportPartId>();
  for (const part of PARTS) {
    if (!part.allowed(viewer)) continue;
    const value = Object.hasOwn(asked, part.id) ? asked[part.id] : part.defaultOn;
    if (value === true) chosen.add(part.id);
  }
  return chosen;
}

// ---- what the server gathers ----

export type ReportLogLine = { at: number; level: string; text: string };

export type ReportCall = {
  task: string;
  durationMs?: number;
  firstTokenMs?: number;
  finishReason?: string;
  error?: string;
};

export type ReportToolCall = { name: string; arguments: string };

export type ReportTurnSource = {
  id: string;
  status: string;
  actor: string;
  createdAt: string;
  updatedAt: string;
  modelCalls: number;
  rolls: number;
  calls: ReportCall[];
  // The turn's own tool calls, in order.
  toolCalls: ReportToolCall[];
  // The context trace, already cut for this viewer (traceForViewer).
  trace: unknown;
};

export type ReportMessageSource = {
  seq: number;
  authorType: "player" | "dm" | "system";
  userId: string | null;
  content: string;
  createdAt: string;
};

export type ReportSources = {
  setup: ReportSetup;
  serverLog?: ReportLogLine[];
  // Oldest first.
  turns?: ReportTurnSource[];
  // Oldest first.
  messages?: ReportMessageSource[];
  // Issue #460's correction ledger: this table's newest narrator quality
  // rows and their fixes, every id hashed and no name, prompt or narration
  // (src/lib/narrator-quality.ts exportedTurns). Under the turn timings'
  // rule: the party lead or a DM, at the table.
  narratorQuality?: ExportedTurn[];
};

// ---- the file ----

export type PageError = {
  at: string;
  kind: "error" | "rejection";
  message: string;
  // The page's path, with no query or fragment.
  where: string;
  stack?: string;
};

export type ReportBundle = {
  kind: "odm-report";
  format: typeof REPORT_BUNDLE_FORMAT;
  createdAt: string;
  madeFrom: "table" | "admin";
  included: ReportPartId[];
  setup?: ReportSetup;
  pageErrors?: PageError[];
  turnTimings?: Array<{
    id: string;
    status: string;
    actor: string;
    startedAt: string;
    finishedAt: string;
    seconds: number;
    modelCalls: number;
    rolls: number;
    calls: ReportCall[];
  }>;
  narratorQuality?: ExportedTurn[];
  serverLog?: string[];
  transcript?: Array<{ seq: number; at: string; from: "you" | "dm"; text: string }>;
  turnRecords?: Array<{
    id: string;
    toolCalls: Array<{ name: string; arguments?: unknown; withheld?: string }>;
    trace: unknown;
  }>;
  // The same, for a person reading the file rather than a program.
  readable: string[];
};

function cut(text: string, limit = MAX_TEXT): string {
  return text.length > limit ? `${text.slice(0, limit)} [... ${text.length - limit} more characters]` : text;
}

// A name or value that holds a session or a cookie, which the shared cutter
// (made for log lines) leaves alone.
const SESSION_SHAPES: Array<[RegExp, string]> = [
  [/\b([A-Za-z_-]*(?:cookie|session)[A-Za-z_-]*)(["']?\s*[:=]\s*["']?)([^\s"',&;]{8,})/gi, "$1$2[redacted]"],
];

// Public services whose names say nothing about the owner. An address on any
// other host (the server's own domain, a machine on the owner's network, a
// webhook) is cut to "[address]", so a report still says which provider
// failed without naming where anything lives.
const PUBLIC_HOSTS = ["github.com", "githubusercontent.com", "openai.com", "openrouter.ai", "anthropic.com", "googleapis.com", "huggingface.co", "models.dev", "npmjs.org", "ollama.com"];

function isPublicHost(host: string): boolean {
  const name = host.toLowerCase();
  return PUBLIC_HOSTS.some((suffix) => name === suffix || name.endsWith(`.${suffix}`));
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// A web address: its scheme, its host (with any user and port), its path,
// and its query and fragment, which are dropped whole.
const URL_SHAPE = /\b([a-z][a-z0-9+.-]*:\/\/)([^\s/?#"'<>()\\]*)([^\s?#"'<>()\\]*)(?:[?#][^\s"'<>()\\]*)?/gi;
const IPV4 = /\b(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}(?::\d{1,5})?\b/g;
// Node's network errors name the host they could not reach.
const NETWORK_ERROR_HOST = /\b(ENOTFOUND|EAI_AGAIN|EHOSTUNREACH|ECONNREFUSED|ETIMEDOUT|ECONNRESET)\s+([^\s,;)'"]+)/g;
const EMAIL = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}\b/g;
// A home folder names the person who owns it: /home/name, /Users/name and
// C:\Users\name (a model file's path, a stack frame in the apps).
const HOME_FOLDER = /([\\/](?:home|Users)[\\/]+)([^\\/\s"'<>:)]+)/gi;

function cutAddresses(text: string, addresses: readonly string[]): string {
  let out = text;
  for (const address of addresses) {
    out = out.replace(new RegExp(escapeRegExp(address), "gi"), "[address]");
  }
  out = out.replace(URL_SHAPE, (_whole, scheme: string, authority: string, path: string) => {
    if (!authority) return `${scheme}${path}`;
    const host = authority.replace(/^.*@/, "").replace(/:\d+$/, "");
    return isPublicHost(host) ? `${scheme}${host}${path}` : `${scheme}[address]${path}`;
  });
  return out
    .replace(NETWORK_ERROR_HOST, "$1 [address]")
    .replace(IPV4, "[address]")
    .replace(EMAIL, "[email]")
    .replace(HOME_FOLDER, "$1[user]");
}

function cleanText(text: string, secrets: readonly string[], addresses: readonly string[] = []): string {
  let out = redactSecrets(text, secrets);
  for (const [pattern, replacement] of SESSION_SHAPES) {
    out = out.replace(pattern, replacement);
  }
  return cutAddresses(out, addresses);
}

// Every string in the value, cut. Keys are the bundle's own names.
function cleanDeep<T>(value: T, secrets: readonly string[], addresses: readonly string[]): T {
  if (typeof value === "string") return cleanText(value, secrets, addresses) as T;
  if (Array.isArray(value)) return value.map((item) => cleanDeep(item, secrets, addresses)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cleanDeep(item, secrets, addresses)])) as T;
  }
  return value;
}

// The hosts in a list of addresses, for the cutter: only names with a dot or
// a colon (a single word like "cube" would cut narration), never a public
// service or this machine's own loopback.
export function addressHosts(values: readonly string[]): string[] {
  const hosts = new Set<string>();
  for (const raw of values) {
    const value = raw.trim();
    if (!value) continue;
    let host = "";
    try {
      host = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `http://${value}`).hostname;
    } catch {
      continue;
    }
    host = host.replace(/^\[|\]$/g, "");
    if (host.length < 4 || !/[.:]/.test(host) || isPublicHost(host) || LOOPBACK.has(host.toLowerCase())) continue;
    hosts.add(host);
  }
  return [...hosts].sort((a, b) => b.length - a.length);
}

const LOOPBACK = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1"]);

// A whisper tool's arguments are the private line itself.
const WHISPER_TOOL = /whisper/i;

function toolCallFor(call: ReportToolCall, viewer: ReportViewer) {
  if (WHISPER_TOOL.test(call.name)) {
    return { name: call.name, withheld: "a whisper is private to its player" };
  }
  if (!viewer.storytellerSecrets) {
    return { name: call.name, withheld: "arguments are kept for whoever runs the table" };
  }
  let parsed: unknown = call.arguments;
  try {
    parsed = JSON.parse(call.arguments);
  } catch {
    parsed = cut(call.arguments);
  }
  return { name: call.name, arguments: parsed };
}

// The messages of the last `turns` DM passages: everything after the DM
// passage before them.
function lastTurnsOf(messages: readonly ReportMessageSource[], turns: number): ReportMessageSource[] {
  let seen = 0;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].authorType === "dm") {
      seen += 1;
      if (seen > turns) return messages.slice(index + 1);
    }
  }
  return [...messages];
}

function secondsBetween(from: string, to: string): number {
  const ms = Date.parse(to) - Date.parse(from);
  return Number.isFinite(ms) && ms >= 0 ? Math.round(ms / 100) / 10 : 0;
}

export function buildReportBundle(input: {
  sources: ReportSources;
  parts: ReadonlySet<ReportPartId>;
  viewer: ReportViewer;
  reporterUserId: string;
  secrets: readonly string[];
  // Host names this server knows (its own, its backends'), cut wherever
  // they appear (addressHosts).
  addresses?: readonly string[];
  now?: Date;
}): ReportBundle {
  const { sources, parts, viewer, reporterUserId } = input;
  // Asked for and allowed: chosenParts already checked, and this checks
  // again so a caller that skipped it still cannot widen the bundle.
  const may = (id: ReportPartId) => parts.has(id) && PARTS.some((part) => part.id === id && part.allowed(viewer));
  const secrets = [...input.secrets].filter((value) => value.length >= 8).sort((a, b) => b.length - a.length);
  const bundle: ReportBundle = {
    kind: "odm-report",
    format: REPORT_BUNDLE_FORMAT,
    createdAt: (input.now ?? new Date()).toISOString(),
    madeFrom: viewer.atTable ? "table" : "admin",
    included: [],
    readable: [],
  };

  if (may("setup")) {
    bundle.setup = sources.setup;
  }

  const turns = (sources.turns ?? []).slice(-REPORT_TURNS);
  if (may("turnTimings")) {
    bundle.turnTimings = turns.map((turn) => ({
      id: turn.id,
      status: turn.status,
      actor: turn.actor,
      startedAt: turn.createdAt,
      finishedAt: turn.updatedAt,
      seconds: secondsBetween(turn.createdAt, turn.updatedAt),
      modelCalls: turn.modelCalls,
      rolls: turn.rolls,
      calls: turn.calls.map((call) => ({
        task: call.task,
        ...(call.durationMs !== undefined ? { durationMs: call.durationMs } : {}),
        ...(call.firstTokenMs !== undefined ? { firstTokenMs: call.firstTokenMs } : {}),
        ...(call.finishReason ? { finishReason: call.finishReason } : {}),
        ...(call.error ? { error: cut(call.error, MAX_ERROR_TEXT) } : {}),
      })),
    }));
    if (sources.narratorQuality?.length) {
      bundle.narratorQuality = sources.narratorQuality;
    }
  }

  if (may("serverLog")) {
    bundle.serverLog = (sources.serverLog ?? [])
      .slice(-REPORT_LOG_LINES)
      .map((line) => `${new Date(line.at).toISOString()} ${line.level.toUpperCase().padEnd(5)} ${cut(line.text)}`);
  }

  if (may("transcript")) {
    bundle.transcript = lastTurnsOf(sources.messages ?? [], REPORT_TURNS).flatMap((message): NonNullable<ReportBundle["transcript"]> => {
      if (message.authorType === "dm") {
        return [{ seq: message.seq, at: message.createdAt, from: "dm", text: cut(message.content) }];
      }
      if (message.authorType === "player" && message.userId !== null && message.userId === reporterUserId) {
        return [{ seq: message.seq, at: message.createdAt, from: "you", text: cut(message.content) }];
      }
      return [];
    });
  }

  if (may("turnRecords")) {
    bundle.turnRecords = turns.map((turn) => ({
      id: turn.id,
      toolCalls: turn.toolCalls.map((call) => toolCallFor(call, viewer)),
      trace: turn.trace ?? null,
    }));
  }

  const cleaned = cleanDeep(bundle, secrets, input.addresses ?? []);
  return finishBundle(cleaned);
}

// ---- the browser's half ----

// One error as the page keeps it: cut to size, keys and tokens cut out, and
// the page's path without its query or fragment.
export function cleanPageError(raw: { kind?: unknown; message?: unknown; stack?: unknown; where?: unknown; at?: unknown }): PageError {
  // The path alone, and through the cutter too: inside the apps it can be a
  // file's path in the person's home folder.
  const where = typeof raw.where === "string" ? cleanText(raw.where.split(/[?#]/)[0].slice(0, 300), []) : "";
  const stack = typeof raw.stack === "string" && raw.stack.trim() ? cut(cleanText(raw.stack, []), MAX_ERROR_TEXT) : undefined;
  return {
    at: typeof raw.at === "string" && !Number.isNaN(Date.parse(raw.at)) ? raw.at : new Date().toISOString(),
    kind: raw.kind === "rejection" ? "rejection" : "error",
    message: cut(cleanText(typeof raw.message === "string" ? raw.message : String(raw.message ?? ""), []), MAX_ERROR_TEXT),
    where,
    ...(stack ? { stack } : {}),
  };
}

// The ring: the newest `limit` errors, oldest first.
export function keepPageError(list: readonly PageError[], entry: PageError, limit = PAGE_ERROR_LIMIT): PageError[] {
  return [...list, entry].slice(-limit);
}

// The server's bundle with this browser's errors added, when the part was
// ticked. Cleaned again here: the kept list lives in the browser's storage.
export function withPageErrors(bundle: ReportBundle, errors: readonly unknown[], include: boolean): ReportBundle {
  if (!include) return finishBundle({ ...bundle, pageErrors: undefined });
  const pageErrors = errors
    .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object")
    .map((entry) => cleanPageError(entry))
    .slice(-PAGE_ERROR_LIMIT);
  return finishBundle({ ...bundle, pageErrors });
}

const ORDER: readonly ReportPartId[] = PARTS.map((part) => part.id);

// The bundle with its parts listed and its readable summary written again:
// after the browser adds the page's errors or the app's facts too.
export function finishBundle<T extends ReportBundle>(bundle: T): T {
  const out: T = { ...bundle };
  if (out.pageErrors === undefined) delete out.pageErrors;
  out.included = ORDER.filter((id) => out[id] !== undefined);
  out.readable = readableLines(out);
  return out;
}

function readableLines(bundle: ReportBundle): string[] {
  const lines = [`Open Dungeon Master report, made ${bundle.createdAt} from ${bundle.madeFrom === "table" ? "a table" : "Admin"}.`];
  const setup = bundle.setup;
  if (setup) {
    lines.push(...setupLines(setup).map((line) => `${line}.`));
    const checks = setup.checkFirst ?? [];
    if (checks.length) lines.push("Check these first:", ...checks.map((line) => `  - ${line}`));
  }
  if (bundle.turnTimings) {
    lines.push(`Last ${bundle.turnTimings.length} turns:`);
    for (const turn of bundle.turnTimings) {
      lines.push(`  ${turn.id}: ${turn.status}, ${turn.seconds}s, ${turn.modelCalls} model calls, ${turn.rolls} rolls`);
    }
  }
  if (bundle.narratorQuality) {
    const corrected = bundle.narratorQuality.filter((turn) => turn.corrections.length).length;
    lines.push(`Narrator quality for ${bundle.narratorQuality.length} turns (${corrected} corrected), ids hashed.`);
  }
  if (bundle.pageErrors) lines.push(`${bundle.pageErrors.length} recent page errors.`);
  if (bundle.serverLog) lines.push(`${bundle.serverLog.length} server log lines.`);
  if (bundle.transcript) lines.push(`${bundle.transcript.length} transcript lines (the reporter's own and the DM's).`);
  if (bundle.turnRecords) lines.push(`Narrator records for ${bundle.turnRecords.length} turns.`);
  return lines;
}

export function reportFileName(now = new Date()): string {
  return `odm-report-${now.toISOString().slice(0, 19).replace(/[:T]/g, "-")}.json`;
}

export function reportFileText(bundle: ReportBundle): string {
  return `${JSON.stringify(bundle, null, 2)}\n`;
}
