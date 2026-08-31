// Compatibility entry point: the DM turn now lives in src/lib/dm/turn.ts as
// a persisted state machine (park/resume for physical dice). Callers keep
// using runDmTurn via the per-campaign queue.
import { campaignSeats, getCampaignById } from "@/lib/db/campaigns";
import { consumeDmCoverTurn } from "@/lib/db/dm-cover";
import { coverInEffect } from "@/lib/dm/delegation";
import { enqueueDmJob } from "@/lib/dm/queue";
import { getDmStatus, setDmStatus } from "@/lib/dm/status";
import { startDmTurn } from "@/lib/dm/turn";
import { hasHumanDm } from "@/lib/dm/viewer";
import { registerDmWaker } from "@/lib/dm/wake";
import { publishPersisted } from "@/lib/events";
import { runsAiTurns } from "@/lib/workshop/kind";

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
//
// Returns true when this call is the one that enqueued a turn, and false when
// it folded into a turn already pending. Assisted mode's cover counts DM
// answers, not player actions, so one handed-over answer is spent here per
// enqueued turn and nothing on a coalesced one.
export function requestDmTurn(campaignId: string): boolean {
  if (requested().has(campaignId)) {
    return false;
  }
  // A workshop is a campaigns row that never plays (docs/workshop-plan.md).
  // Every route that reaches this function is a play route a workshop does
  // not render, so this is belt and braces; it lives here rather than at
  // each of those nine call sites because one guard on the way IN to the
  // model is the version that cannot be forgotten when a tenth appears.
  const campaign = getCampaignById(campaignId);
  if (campaign && !runsAiTurns(campaign)) {
    return false;
  }
  // Same guard, human-DM edition: with a person in the DM seat there is no
  // turn to wake, whatever route asked (an end-turn press, a whisper, a
  // companion edit). The activity sits in the transcript for the DM. The one
  // exception is a running cover stretch, where the AI answers on the DM's
  // behalf and each enqueued turn spends one of the handed-over answers.
  const covering = campaign
    ? coverInEffect(campaign.gameSettings.dmMode, campaign.gameSettings.dmAssist, campaign.dmCover)
    : false;
  if (campaign && hasHumanDm(campaignSeats(campaign)) && !covering) {
    return false;
  }
  requested().add(campaignId);
  // Show players the DM noticed immediately, even while an earlier turn is
  // still holding the queue (do not stomp that turn's live status).
  if (getDmStatus(campaignId) === "idle") {
    setDmStatus(campaignId, "thinking");
  }
  if (covering) {
    const remaining = consumeDmCoverTurn(campaignId);
    publishPersisted(campaignId, "dm_cover_changed", { cover: remaining });
  }
  enqueueDmJob(campaignId, async () => {
    // Clear before the turn builds history: everything persisted up to this
    // point is covered by this turn; later arrivals re-request.
    requested().delete(campaignId);
    await startDmTurn(campaignId);
  });
  return true;
}

// Modules inside the turn (initiative landing on an AI companion) wake the
// DM through the registry instead of importing this module (cycle).
registerDmWaker(requestDmTurn);
