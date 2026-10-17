import { getDatabase, nowIso } from "@/lib/db/core";
import { currentUsageScope } from "@/lib/usage/scope";

// One row per model attempt, the measurements the context audit asked for
// (docs/agent-context-efficiency-audit-2026-10-17.md F09): what the call was
// for, what was planned against what the backend reported, the cache and the
// reasoning, when the first visible word arrived, how it ended, and whether
// it fell back. A slow turn can then be read as prefill, reasoning, writing,
// a retry or a fallback rather than guessed at. No prompt or reply text is
// kept. A figure the backend did not report is stored as NULL (unknown),
// never as 0. The usage ledger (src/lib/usage/ledger.ts) stays the admin's
// account of who spent what; this is diagnostics, kept 30 days.

export type ModelCallOutcome = "ok" | "error" | "capacity" | "refused" | "stopped";

export type ModelCallRecord = {
  campaignId?: string | null;
  task: string;
  role: "story" | "utility";
  backend: string;
  model: string;
  turnId?: string | null;
  callIndex?: number | null;
  windowTokens?: number | null;
  plannedInputTokens?: number | null;
  inputTokens?: number | null;
  cachedInputTokens?: number | null;
  cacheWriteTokens?: number | null;
  outputTokens?: number | null;
  reasoningTokens?: number | null;
  maxOutputTokens?: number | null;
  toolCount: number;
  toolTokens: number;
  fitDropped?: number;
  fitClipped?: number;
  durationMs: number;
  firstTokenMs?: number | null;
  promptMs?: number | null;
  generateMs?: number | null;
  loadMs?: number | null;
  finishReason?: string | null;
  outcome: ModelCallOutcome;
  // Why the call ran somewhere other than where it was asked to.
  fallback?: string | null;
};

const whole = (value: number | null | undefined): number | null =>
  typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.round(value)) : null;

export function recordModelCall(call: ModelCallRecord): void {
  try {
    getDatabase()
      .prepare(
        `INSERT INTO model_calls
           (at, campaign_id, task, role, backend, model, turn_id, call_index, window_tokens, planned_input_tokens,
            input_tokens, cached_input_tokens, cache_write_tokens, output_tokens, reasoning_tokens, max_output_tokens,
            tool_count, tool_tokens, fit_dropped, fit_clipped, duration_ms, first_token_ms, prompt_ms, generate_ms,
            load_ms, finish_reason, outcome, fallback)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        nowIso(),
        call.campaignId ?? currentUsageScope().campaignId ?? null,
        call.task.slice(0, 40),
        call.role,
        call.backend.slice(0, 40),
        call.model.slice(0, 200),
        call.turnId ?? null,
        whole(call.callIndex),
        whole(call.windowTokens),
        whole(call.plannedInputTokens),
        whole(call.inputTokens),
        whole(call.cachedInputTokens),
        whole(call.cacheWriteTokens),
        whole(call.outputTokens),
        whole(call.reasoningTokens),
        whole(call.maxOutputTokens),
        Math.max(0, Math.round(call.toolCount)),
        Math.max(0, Math.round(call.toolTokens)),
        Math.max(0, Math.round(call.fitDropped ?? 0)),
        Math.max(0, Math.round(call.fitClipped ?? 0)),
        Math.max(0, Math.round(call.durationMs)),
        whole(call.firstTokenMs),
        whole(call.promptMs),
        whole(call.generateMs),
        whole(call.loadMs),
        call.finishReason ? call.finishReason.slice(0, 40) : null,
        call.outcome,
        call.fallback ? call.fallback.slice(0, 200) : null,
      );
  } catch (error) {
    // Bookkeeping must never cost a table its turn.
    console.error("[model-calls] could not record", error);
  }
}

export type ModelCallRow = {
  at: string;
  task: string;
  role: string;
  backend: string;
  model: string;
  callIndex: number | null;
  windowTokens: number | null;
  plannedInputTokens: number | null;
  inputTokens: number | null;
  cachedInputTokens: number | null;
  outputTokens: number | null;
  reasoningTokens: number | null;
  maxOutputTokens: number | null;
  toolCount: number;
  toolTokens: number;
  fitDropped: number;
  fitClipped: number;
  durationMs: number;
  firstTokenMs: number | null;
  promptMs: number | null;
  generateMs: number | null;
  finishReason: string | null;
  outcome: ModelCallOutcome;
  fallback: string | null;
};

const ROW_SELECT = `at, task, role, backend, model, call_index AS callIndex, window_tokens AS windowTokens,
  planned_input_tokens AS plannedInputTokens, input_tokens AS inputTokens, cached_input_tokens AS cachedInputTokens,
  output_tokens AS outputTokens, reasoning_tokens AS reasoningTokens, max_output_tokens AS maxOutputTokens,
  tool_count AS toolCount, tool_tokens AS toolTokens, fit_dropped AS fitDropped, fit_clipped AS fitClipped,
  duration_ms AS durationMs, first_token_ms AS firstTokenMs, prompt_ms AS promptMs, generate_ms AS generateMs,
  finish_reason AS finishReason, outcome, fallback`;

// Every call one DM turn made, in order: the Context panel's per-call rows.
export function listTurnModelCalls(turnId: string): ModelCallRow[] {
  return getDatabase()
    .prepare(`SELECT ${ROW_SELECT} FROM model_calls WHERE turn_id = ? ORDER BY id`)
    .all(turnId) as ModelCallRow[];
}

export type ModelCallSummary = {
  task: string;
  calls: number;
  errors: number;
  fallbacks: number;
  // Medians and the 95th percentile, in milliseconds; null with no figure.
  p50Ms: number | null;
  p95Ms: number | null;
  p50FirstTokenMs: number | null;
  avgInputTokens: number | null;
  // Of the input the backends reported a cache figure for, the share served
  // from cache; null when none reported one.
  cachedShare: number | null;
  avgOutputTokens: number | null;
  avgReasoningTokens: number | null;
};

export function percentile(values: readonly number[], share: number): number | null {
  if (!values.length) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(share * sorted.length) - 1));
  return sorted[index];
}

const mean = (values: readonly number[]): number | null =>
  values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : null;

// The admin's read of the last days of calls, by what they were for.
export function summarizeModelCalls(sinceIso: string): ModelCallSummary[] {
  const rows = getDatabase()
    .prepare(`SELECT ${ROW_SELECT} FROM model_calls WHERE at >= ? ORDER BY id`)
    .all(sinceIso) as ModelCallRow[];
  const byTask = new Map<string, ModelCallRow[]>();
  for (const row of rows) {
    const list = byTask.get(row.task) ?? [];
    list.push(row);
    byTask.set(row.task, list);
  }
  return [...byTask.entries()]
    .map(([task, list]) => {
      const answered = list.filter((row) => row.outcome === "ok");
      const numbers = (pick: (row: ModelCallRow) => number | null) =>
        answered.map(pick).filter((value): value is number => typeof value === "number");
      const cached = answered.filter((row) => row.cachedInputTokens !== null && row.inputTokens);
      const cachedInput = cached.reduce((sum, row) => sum + (row.cachedInputTokens ?? 0), 0);
      const cachedTotal = cached.reduce((sum, row) => sum + (row.inputTokens ?? 0), 0);
      return {
        task,
        calls: list.length,
        errors: list.length - answered.length,
        fallbacks: list.filter((row) => row.fallback).length,
        p50Ms: percentile(numbers((row) => row.durationMs), 0.5),
        p95Ms: percentile(numbers((row) => row.durationMs), 0.95),
        p50FirstTokenMs: percentile(numbers((row) => row.firstTokenMs), 0.5),
        avgInputTokens: mean(numbers((row) => row.inputTokens ?? row.plannedInputTokens)),
        cachedShare: cachedTotal ? Math.round((cachedInput / cachedTotal) * 100) / 100 : null,
        avgOutputTokens: mean(numbers((row) => row.outputTokens)),
        avgReasoningTokens: mean(numbers((row) => row.reasoningTokens)),
      };
    })
    .sort((a, b) => b.calls - a.calls);
}
