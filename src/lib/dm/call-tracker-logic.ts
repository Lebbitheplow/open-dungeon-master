// What the engine is doing between turns, so a long wait stops being opaque.
//
// ODM already publishes dm_status, but that is one slot with one value for
// the whole campaign: it describes the turn. The utility model does its own
// work outside a turn (compacting history, sealing a chapter, ticking the
// world arcs, answering an Ask), several jobs can be queued at once, and none
// of it shows anywhere. On a local 35B that is a minute of apparent nothing.
//
// The labelled-chip idea comes from NarrativeEngine-P's call inspector (MIT,
// Copyright (c) 2026 Sagesheep), which surfaces each background call with its
// purpose and elapsed time rather than one global spinner.
//
// Dependency-free so scripts/test-call-tracker.mjs can import it directly.

// Story-arc generation is deliberately absent. It runs on the STORY model and
// already reports itself through dm_status ("plotting_arc"), so a chip for it
// would say the same thing twice in two places.
export type UtilityCallKind =
  | "compaction"
  | "chapter"
  | "world"
  | "lore"
  | "ask";

// Phrased for a player at the table, not an operator reading a log. Each says
// what the engine is doing, not which function is running.
export const UTILITY_CALL_LABELS: Record<UtilityCallKind, string> = {
  compaction: "Condensing the story so far",
  chapter: "Writing up the chapter",
  world: "Turning the world",
  lore: "Checking the lore",
  ask: "Answering a question",
};

export type UtilityCall = {
  // Unique per call, not per kind: two chapter seals can overlap after a
  // rewind, and keying by kind would let the first to finish clear both.
  id: string;
  kind: UtilityCallKind;
  // Epoch millis, so the client can tick elapsed time without another event.
  startedAt: number;
};

export function addCall(calls: UtilityCall[], call: UtilityCall): UtilityCall[] {
  return [...calls.filter((existing) => existing.id !== call.id), call];
}

export function removeCall(calls: UtilityCall[], id: string): UtilityCall[] {
  return calls.filter((call) => call.id !== id);
}

export function describeCall(kind: UtilityCallKind): string {
  return UTILITY_CALL_LABELS[kind] ?? "Working";
}

// Elapsed time is only shown once a call has been running long enough to be
// worth apologising for. Under that, the chip is just the label: a number
// that flickers 0s, 1s, 0s on fast calls reads as instability.
export const ELAPSED_VISIBLE_MS = 3_000;

export function formatElapsed(startedAt: number, now: number): string {
  const ms = now - startedAt;
  if (!Number.isFinite(ms) || ms < ELAPSED_VISIBLE_MS) {
    return "";
  }
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
}

// Oldest first, so a chip does not jump position when a newer call finishes.
export function sortCalls(calls: UtilityCall[]): UtilityCall[] {
  return [...calls].sort((a, b) => a.startedAt - b.startedAt || a.id.localeCompare(b.id));
}
