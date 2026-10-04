import { allocateSeq } from "@/lib/db/campaigns";
import { getDmTurn } from "@/lib/db/dm-turns";
import { publishEphemeral } from "@/lib/events";

// Where a DM narration sits in the transcript (issue 68). A turn streams its
// narration to the table call by call, but writes it as one message when the
// whole turn ends, and a message takes its seq when it is written. The tail
// of a turn can be long (the end of a fight: experience, loot, the floor
// opening), and a player who answered the narration they had already read
// landed above it, out of order for the table, for a reload and for the
// DM's next turn alike.
//
// So once narration is on screen, the first message a person posts makes
// the narration claim the seq before theirs; finalize writes the narration
// into that slot. With nobody interjecting nothing changes: the narration
// takes its seq at the end, as it always has. Lives on globalThis like the
// DM queue (src/lib/dm/queue.ts), so dev-mode HMR cannot fork it. A turn
// resumed after a restart has lost its claim and takes a fresh seq.

type Slot = { turnId: string; seq: number | null };

declare global {
  var __odmNarrationSlots: Map<string, Slot> | undefined;
}

function slots() {
  return (globalThis.__odmNarrationSlots ??= new Map<string, Slot>());
}

// The turn has put narration in front of the table.
export function narrationShown(campaignId: string, turnId: string): void {
  const slot = slots().get(campaignId);
  if (slot?.turnId !== turnId) {
    slots().set(campaignId, { turnId, seq: null });
  }
}

// Called before a person's message takes its seq. Returns the seq the
// narration now holds (and tells the table, so the draft bubble moves above
// the message about to land), or null when no narration is showing. A turn
// parked for dice still counts (its narration finishes on resume); one that
// ended without writing (a crash, the table handed to a person) does not.
export function claimNarrationSeq(campaignId: string): number | null {
  const slot = slots().get(campaignId);
  if (!slot) {
    return null;
  }
  const status = getDmTurn(slot.turnId)?.status;
  if (status !== "running" && status !== "awaiting_rolls") {
    slots().delete(campaignId);
    return null;
  }
  if (slot.seq === null) {
    slot.seq = allocateSeq(campaignId);
    publishEphemeral(campaignId, "dm_draft_seq", { seq: slot.seq });
  }
  return slot.seq;
}

// The turn is ending: the seq it claimed, if anyone made it claim one, and
// the slot is cleared either way.
export function takeNarrationSeq(campaignId: string, turnId: string): number | null {
  const slot = slots().get(campaignId);
  if (slot?.turnId !== turnId) {
    return null;
  }
  slots().delete(campaignId);
  return slot.seq;
}
