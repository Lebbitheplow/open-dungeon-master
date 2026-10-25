import { capsFor, isLead, type MemberContext } from "@/lib/campaign-api";
import { getGlobalConfig } from "@/lib/db/app-settings";
import { getDatabase } from "@/lib/db/core";
import { listRecentDmTurns, type DmTurn } from "@/lib/db/dm-turns";
import { listRecentMessages } from "@/lib/db/messages";
import { traceForViewer } from "@/lib/dm/context-budget";
import { bundleNarratorQuality } from "@/lib/narrator-quality-server";
import {
  addressHosts,
  buildReportBundle,
  REPORT_TURNS,
  type ReportCall,
  type ReportPartId,
  type ReportSetup,
  type ReportSources,
  type ReportToolCall,
  type ReportTurnSource,
  type ReportViewer,
} from "@/lib/report-bundle";
import { gatherSetup } from "@/lib/report-setup-server";
import { configuredDefaultStorySettings } from "@/lib/runtime-defaults";
import { knownSecretValues, readServerLog, secretValuesIn } from "@/lib/server-log";

// The server's half of the report bundle (src/lib/report-bundle.ts): who the
// viewer is, read from their seat and never from the request, and the
// sources for the parts they chose. A part that was not chosen is not even
// read.

export function tableReportViewer(context: MemberContext): ReportViewer {
  const caps = capsFor(context);
  return {
    isAdmin: Boolean(context.user.isAdmin),
    atTable: true,
    leadOrDm: isLead(context) || caps.role === "dm",
    steersStory: caps.steersStory,
    storytellerSecrets: caps.storytellerSecrets,
  };
}

export const ADMIN_REPORT_VIEWER: ReportViewer = {
  isAdmin: true,
  atTable: false,
  leadOrDm: false,
  steersStory: false,
  storytellerSecrets: false,
};

function serverLogLines() {
  return readServerLog({ secrets: secretValuesIn(getGlobalConfig()) }).entries;
}

type TraceShape = { shape?: { promptMessages?: number }; calls?: Array<Record<string, unknown>> };

function callsOf(turn: DmTurn): ReportCall[] {
  const calls = (turn.contextTrace as TraceShape | null)?.calls ?? [];
  return calls.map((call) => ({
    task: typeof call.task === "string" ? call.task : "",
    ...(typeof call.durationMs === "number" ? { durationMs: call.durationMs } : {}),
    ...(typeof call.firstTokenMs === "number" ? { firstTokenMs: call.firstTokenMs } : {}),
    ...(typeof call.finishReason === "string" ? { finishReason: call.finishReason } : {}),
    ...(typeof call.error === "string" ? { error: call.error } : {}),
  }));
}

// The tool calls the turn's own model calls made: the assistant messages
// after the prompt, never the prompt itself.
function toolCallsOf(turn: DmTurn): ReportToolCall[] {
  // Where the prompt ends is known only from the trace. Without it nothing is
  // read, rather than reading from the start and taking the prompt's own
  // history for the turn's calls.
  const start = (turn.contextTrace as TraceShape | null)?.shape?.promptMessages;
  if (typeof start !== "number") return [];
  const out: ReportToolCall[] = [];
  for (const message of turn.conversation.slice(start)) {
    if (message.role !== "assistant" || !Array.isArray(message.tool_calls)) continue;
    for (const call of message.tool_calls as Array<{ function?: { name?: unknown; arguments?: unknown } }>) {
      const name = typeof call?.function?.name === "string" ? call.function.name : "";
      if (!name) continue;
      const args = call.function?.arguments;
      out.push({ name, arguments: typeof args === "string" ? args : JSON.stringify(args ?? {}) });
    }
  }
  return out;
}

function turnSourceOf(turn: DmTurn, parts: ReadonlySet<ReportPartId>, viewer: ReportViewer): ReportTurnSource {
  const records = parts.has("turnRecords");
  return {
    id: turn.id,
    status: turn.status,
    actor: turn.actor,
    createdAt: turn.createdAt,
    updatedAt: turn.updatedAt,
    modelCalls: turn.callIndex,
    rolls: turn.rollIds.length,
    calls: callsOf(turn),
    toolCalls: records ? toolCallsOf(turn) : [],
    trace: records && turn.contextTrace ? traceForViewer(turn.contextTrace, viewer) : null,
  };
}

// The table's setup: its own narrator and pictures, the server's agent
// program, voice and dictation, and the seat the report was made from.
export function tableReportSetup(context: MemberContext) {
  const { campaign } = context;
  const caps = capsFor(context);
  return gatherSetup(campaign.settings, {
    dmMode: campaign.gameSettings.dmMode,
    role: isLead(context) && caps.role === "player" ? "lead" : caps.role,
    game: campaign.gameSettings,
  });
}

// Admin's setup: the server's defaults for a new table.
export function adminReportSetup() {
  return gatherSetup(configuredDefaultStorySettings());
}

// What the dialog shows before anything is saved: the setup's checks, cut
// for keys and addresses exactly as the file's are.
export function reportCheckFirst(
  setup: ReportSetup,
  input: { viewer: ReportViewer; reporterUserId: string; secrets: readonly string[]; addresses: readonly string[] },
): string[] {
  const bundle = buildReportBundle({ sources: { setup }, parts: new Set(["setup"]), ...input });
  return bundle.setup?.checkFirst ?? [];
}

export async function tableReportSources(context: MemberContext, parts: ReadonlySet<ReportPartId>, viewer: ReportViewer): Promise<ReportSources> {
  const { campaign } = context;
  const sources: ReportSources = { setup: await tableReportSetup(context) };
  if (parts.has("serverLog")) {
    sources.serverLog = serverLogLines();
  }
  if (parts.has("turnTimings") || parts.has("turnRecords")) {
    sources.turns = listRecentDmTurns(campaign.id, REPORT_TURNS).map((turn) => turnSourceOf(turn, parts, viewer));
  }
  if (parts.has("transcript")) {
    // Enough to hold the last few turns of a busy table; the bundle keeps
    // only the reporter's own lines and the DM's of those.
    sources.messages = listRecentMessages(campaign.id, 100).map((message) => ({
      seq: message.seq,
      authorType: message.authorType,
      userId: message.userId,
      content: message.content,
      createdAt: message.createdAt,
    }));
  }
  // Issue #460: the correction ledger's narrator quality rows for this
  // table, hashed and nameless, under the turn timings' rule (the bundle
  // drops them for anyone but the lead or a DM, src/lib/report-bundle.ts).
  if (parts.has("turnTimings")) {
    sources.narratorQuality = bundleNarratorQuality(campaign.id);
  }
  return sources;
}

export async function adminReportSources(parts: ReadonlySet<ReportPartId>): Promise<ReportSources> {
  const sources: ReportSources = { setup: await adminReportSetup() };
  if (parts.has("serverLog")) {
    sources.serverLog = serverLogLines();
  }
  return sources;
}

// Every table's saved settings, for a part (the server log) that can print
// any table's key or backend address, not only this one's.
function everyTableSettings(): unknown[] {
  const rows = getDatabase().prepare(`SELECT settings_json FROM campaigns`).all() as Array<{ settings_json: string }>;
  return rows.map((row) => {
    try {
      return JSON.parse(row.settings_json) as unknown;
    } catch {
      return null;
    }
  });
}

// The request's own cookie values: the reporter's session among them.
function cookieValues(headers?: Headers): string[] {
  return (headers?.get("cookie") ?? "")
    .split(";")
    .map((pair) => pair.slice(pair.indexOf("=") + 1).trim())
    .filter((value) => value.length >= 8);
}

type SecretScope = { headers?: Headers; everyTable?: boolean };

// Every key value this server knows: the environment's, the panel's, the
// table's own saved keys, every table's when the server log goes in, and
// the cookies the request came with.
export function reportSecrets(context?: MemberContext, scope: SecretScope = {}): string[] {
  const values = new Set(knownSecretValues(getGlobalConfig()));
  const settings = [context?.campaign.settings, ...(scope.everyTable ? everyTableSettings() : [])];
  for (const value of settings.flatMap((item) => secretValuesIn(item))) values.add(value);
  for (const value of cookieValues(scope.headers)) values.add(value);
  return [...values];
}

// A setting's or variable's name that holds an address.
const ADDRESS_NAME = /url|host|origin|endpoint|address/i;

function addressValuesIn(value: unknown, name = ""): string[] {
  if (typeof value === "string") return ADDRESS_NAME.test(name) ? [value] : [];
  if (Array.isArray(value)) return value.flatMap((item) => addressValuesIn(item, name));
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).flatMap(([key, item]) => addressValuesIn(item, key));
  }
  return [];
}

// Every host name the server knows of: the address the reporter reached it
// by, its public address and its backends' from the environment, the panel
// and the table (every table's with the server log). The bundle cuts each
// wherever it appears, as well as any address by its shape.
export function reportAddresses(context?: MemberContext, scope: SecretScope = {}): string[] {
  const env = Object.entries(process.env)
    .filter(([name, value]) => ADDRESS_NAME.test(name) && typeof value === "string")
    .map(([, value]) => String(value));
  const headers = ["host", "x-forwarded-host", "origin", "referer"].map((name) => scope.headers?.get(name) ?? "");
  const settings = [getGlobalConfig(), context?.campaign.settings, ...(scope.everyTable ? everyTableSettings() : [])];
  return addressHosts([...env, ...headers, ...settings.flatMap((item) => addressValuesIn(item))]);
}
