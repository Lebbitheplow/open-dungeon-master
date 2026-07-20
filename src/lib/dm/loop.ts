// Compatibility entry point: the DM turn now lives in src/lib/dm/turn.ts as
// a persisted state machine (park/resume for physical dice). Callers keep
// using runDmTurn via the per-campaign queue.
import { enqueueDmJob } from "@/lib/dm/queue";
import { getDmStatus, setDmStatus } from "@/lib/dm/status";
import { startDmTurn } from "@/lib/dm/turn";
import { registerDmWaker } from "@/lib/dm/wake";

export { startDmTurn as runDmTurn } from "@/lib/dm/turn";

declare global {
  var __odmTurnRequested: Set<string> | undefined;
}

function requested() {
  return (globalThis.__odmTurnRequested ??= new Set<string>());
}

// Coalesces DM turns so rapid-fire player actions cannot pile up N full
// turns on the queue. A turn reads the whole message history when it starts,
// so one pending turn answers every action that arrived before it began;
// actions landing mid-turn re-request and get exactly one follow-up turn.
export function requestDmTurn(campaignId: string) {
  if (requested().has(campaignId)) {
    return;
  }
  requested().add(campaignId);
  // Show players the DM noticed immediately, even while an earlier turn is
  // still holding the queue (do not stomp that turn's live status).
  if (getDmStatus(campaignId) === "idle") {
    setDmStatus(campaignId, "thinking");
  }
  enqueueDmJob(campaignId, async () => {
    // Clear before the turn builds history: everything persisted up to this
    // point is covered by this turn; later arrivals re-request.
    requested().delete(campaignId);
    await startDmTurn(campaignId);
  });
}

// Modules inside the turn (initiative landing on an AI companion) wake the
// DM through the registry instead of importing this module (cycle).
registerDmWaker(requestDmTurn);
