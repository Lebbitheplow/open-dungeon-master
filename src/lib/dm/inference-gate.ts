// Interactive work first on a shared backend
// (docs/agent-context-efficiency-audit-2026-10-17.md F10). The DM queue
// serializes by campaign, so a table's background upkeep (rolling
// compaction, fact extraction, world ticks) could start on the same local
// server while another table's turn was mid-call, and a single-slot local
// server answers one request at a time: the player waited on the upkeep.
//
// Background calls now wait while any interactive call is in flight on the
// same backend, for a bounded time, then go anyway: upkeep is delayed, never
// starved. Interactive calls never wait here.

const MAX_BACKGROUND_WAIT_MS = 90_000;
const POLL_MS = 250;

type GateState = { interactive: Map<string, number> };

declare global {
  var __odmInferenceGate: GateState | undefined;
}

function gate(): GateState {
  return (globalThis.__odmInferenceGate ??= { interactive: new Map() });
}

export function interactiveInFlight(key: string): number {
  return gate().interactive.get(key) ?? 0;
}

export async function asInteractive<T>(key: string, run: () => Promise<T>): Promise<T> {
  const map = gate().interactive;
  map.set(key, (map.get(key) ?? 0) + 1);
  try {
    return await run();
  } finally {
    const left = (map.get(key) ?? 1) - 1;
    if (left > 0) map.set(key, left);
    else map.delete(key);
  }
}

// Resolves with how long the call waited.
export async function waitForInteractive(key: string, maxWaitMs = MAX_BACKGROUND_WAIT_MS): Promise<number> {
  const started = Date.now();
  while (interactiveInFlight(key) > 0 && Date.now() - started < maxWaitMs) {
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  return Date.now() - started;
}
