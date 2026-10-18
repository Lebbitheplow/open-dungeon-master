import type { Campaign } from "@/lib/db/campaigns";
import type { DmTurn } from "@/lib/db/dm-turns";
import { responseReserveTokens, type CallTrace } from "@/lib/dm/context-budget";
import type { DmCallOptions, DmCallResult } from "@/lib/dm/model";
import { storyContextTokens } from "@/lib/model-client";

// How each call of a DM turn is fitted and recorded
// (docs/agent-context-efficiency-audit-2026-10-17.md F04, F09). The prompt
// is sized once when the turn opens, then grows by the model's calls and
// their results, a resume's dice and map, a correction, the guard's rewrite.
// Every one of those calls is fitted again to the window before it is sent:
// the transcript gives way oldest first, the turn's own calls and results
// never do (only the long fields of results before the latest call shrink),
// and the reply keeps at least half the turn's reserve.

// The calls kept on a turn's trace; a turn makes four, plus a few rescues.
const CALLS_KEPT = 16;

export function turnCallFit(turn: Pick<DmTurn, "contextTrace">): NonNullable<DmCallOptions["fit"]> {
  const shape = turn.contextTrace?.shape;
  if (shape && shape.promptMessages > 0 && shape.historyEnd > shape.historyStart) {
    return { history: { start: shape.historyStart, end: shape.historyEnd }, protectFrom: shape.promptMessages };
  }
  // A turn from before the shape was kept: nothing is dropped, only the long
  // fields of older tool results shrink.
  return { protectFrom: 1 };
}

// The least room a turn's reply keeps: half its reserve, never under 1,024.
// A thinking model reasons inside this before its first tool call.
export function turnMinOutputTokens(campaign: Campaign): number {
  return Math.max(1_024, Math.floor(responseReserveTokens(storyContextTokens(campaign.settings)) / 2));
}

export function turnCallOptions(
  campaign: Campaign,
  turn: Pick<DmTurn, "id" | "callIndex" | "contextTrace">,
  task: string,
): Pick<DmCallOptions, "fit" | "minOutputTokens" | "meta"> {
  return {
    fit: turnCallFit(turn),
    minOutputTokens: turnMinOutputTokens(campaign),
    meta: { task, turnId: turn.id, callIndex: turn.callIndex },
  };
}

// The call as it was sized and as the backend reported it, on the turn's
// trace for the Context panel.
export function noteTurnCall(
  turn: Pick<DmTurn, "callIndex" | "contextTrace">,
  task: string,
  tools: readonly unknown[] | undefined,
  result: DmCallResult,
  error?: string,
): void {
  if (!turn.contextTrace) {
    return;
  }
  const sizing = result.sizing;
  const call: CallTrace = {
    index: turn.callIndex,
    task,
    windowTokens: sizing?.windowTokens ?? 0,
    promptTokens: sizing?.promptTokens ?? 0,
    toolTokens: sizing?.toolTokens ?? 0,
    toolCount: tools?.length ?? 0,
    outputTokens: sizing?.outputTokens ?? 0,
    dropped: sizing?.dropped ?? 0,
    clipped: sizing?.clipped ?? 0,
    ...(sizing?.windowAssumed ? { windowAssumed: true as const } : {}),
    ...(result.usage?.inputTokens !== undefined ? { reportedInputTokens: result.usage.inputTokens } : {}),
    ...(result.usage?.cachedInputTokens !== undefined ? { cachedInputTokens: result.usage.cachedInputTokens } : {}),
    ...(result.usage?.outputTokens !== undefined ? { outputTokensUsed: result.usage.outputTokens } : {}),
    ...(result.usage?.reasoningTokens !== undefined ? { reasoningTokens: result.usage.reasoningTokens } : {}),
    ...(result.durationMs !== undefined ? { durationMs: result.durationMs } : {}),
    ...(result.firstTokenMs !== undefined ? { firstTokenMs: result.firstTokenMs } : {}),
    ...(result.finishReason ? { finishReason: result.finishReason } : {}),
    ...(error ? { error: error.slice(0, 300) } : {}),
  };
  turn.contextTrace.calls = [...(turn.contextTrace.calls ?? []), call].slice(-CALLS_KEPT);
}
