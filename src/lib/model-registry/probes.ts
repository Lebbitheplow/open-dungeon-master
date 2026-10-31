import { getAppSetting, setAppSetting } from "@/lib/db/app-settings";
import { normalizeBaseUrl } from "@/lib/setup/discovery-logic";

// What the admin's "Test backend" found of each model on each host: the
// three stages the DM loop needs (streaming, a structured tool call, a
// continuation after the tool result) and the route its tools ran on. Kept
// in app_settings under its own key so the model pickers can say "tested
// here, runs the storyteller loop" beside a model. No key or address is
// stored, only the host name.

export type ProbeRecord = {
  host: string;
  model: string;
  ok: boolean;
  // ISO date-time of the test.
  at: string;
  route: string;
  // `turn` is the campaign-shaped test turn that follows the three checks
  // (src/lib/backend-trial.ts); absent on records from before it, and when
  // the checks failed and it never ran.
  stages: { streaming: boolean; toolCall: boolean; toolContinuation: boolean; turn?: boolean };
};

const KEY = "model_probes";
export const MAX_PROBE_RECORDS = 60;

export function probeHost(baseUrl: string): string {
  try {
    return new URL(normalizeBaseUrl(baseUrl)).host.toLowerCase();
  } catch {
    return "";
  }
}

type ProbeResultLike = {
  ok?: boolean;
  route?: string;
  stages?: Record<string, { ok?: boolean } | undefined>;
  trial?: { ok?: boolean };
};

export function probeRecord(baseUrl: string, model: string, result: ProbeResultLike, at = new Date().toISOString()): ProbeRecord | null {
  const host = probeHost(baseUrl);
  const name = model.trim().slice(0, 200);
  if (!host || !name) return null;
  return {
    host,
    model: name,
    ok: result.ok === true,
    at,
    route: typeof result.route === "string" ? result.route : "",
    stages: {
      streaming: result.stages?.streaming?.ok === true,
      toolCall: result.stages?.toolCall?.ok === true,
      toolContinuation: result.stages?.toolContinuation?.ok === true,
      ...(result.trial ? { turn: result.trial.ok === true } : {}),
    },
  };
}

// The newest record per host and model wins; the oldest are let go past the cap.
export function mergeProbeRecords(existing: readonly ProbeRecord[], record: ProbeRecord, max = MAX_PROBE_RECORDS): ProbeRecord[] {
  const kept = existing.filter((row) => !(row.host === record.host && row.model === record.model));
  kept.push(record);
  return kept.slice(-max);
}

function readRecords(value: unknown): ProbeRecord[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (row): row is ProbeRecord =>
      Boolean(row) &&
      typeof row === "object" &&
      typeof (row as ProbeRecord).host === "string" &&
      typeof (row as ProbeRecord).model === "string" &&
      typeof (row as ProbeRecord).ok === "boolean" &&
      typeof (row as ProbeRecord).at === "string" &&
      Boolean((row as ProbeRecord).stages),
  );
}

export function modelProbes(): ProbeRecord[] {
  return readRecords(getAppSetting<unknown>(KEY, []));
}

export function recordModelProbe(baseUrl: string, model: string, result: ProbeResultLike): ProbeRecord | null {
  const record = probeRecord(baseUrl, model, result);
  if (!record) return null;
  setAppSetting(KEY, mergeProbeRecords(modelProbes(), record));
  return record;
}

export function probeRecordFor(baseUrl: string, model: string): ProbeRecord | null {
  const host = probeHost(baseUrl);
  const name = model.trim();
  if (!host || !name) return null;
  return modelProbes().find((row) => row.host === host && row.model === name) ?? null;
}
