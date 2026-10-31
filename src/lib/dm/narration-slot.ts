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
// So once a turn is running, the first message a person posts makes the
// narration claim the seq before theirs; finalize writes the narration into
// that slot. With nobody interjecting nothing changes: the narration takes
// its seq at the end, as it always has. The slot opens when the turn starts,
// not when its first words stream: a move posted while the model was still
// thinking otherwise sat above the narration that never read it, and the
// coalesced follow-up turn, finding the DM's message last, skipped it and
// left the move unanswered.
//
// The server's own table notes posted while the turn runs (a companion
// walking out over a killing blow, a death, an ultimatum, a condition
// ending) claim the slot too (tableNoteSeq). They were posted the moment
// the tool ran, while the roll cards that caused them ride on the
// narration written at the end, so "Sir Hollis walked out on the party"
// sat above the attack that made him leave (issue 668). Lives on
// globalThis like the
// DM queue (src/lib/dm/queue.ts), so dev-mode HMR cannot fork it. A turn
// resumed after a restart has lost its claim and takes a fresh seq.

// `person` is whether a person's message made the claim. A claim made by a
// table note alone keeps the narration above the note, but nobody posted
// while the turn ran (PR #625 reads this through takeNarrationSlot).
type Slot = { turnId: string; seq: number | null; person: boolean };

declare global {
  var __odmNarrationSlots: Map<string, Slot> | undefined;
}

function slots() {
  return (globalThis.__odmNarrationSlots ??= new Map<string, Slot>());
}

// The turn has started, or has put narration in front of the table.
export function narrationShown(campaignId: string, turnId: string): void {
  const slot = slots().get(campaignId);
  if (slot?.turnId !== turnId) {
    slots().set(campaignId, { turnId, seq: null, person: false });
  }
}

// Called before a person's message takes its seq. Returns the seq the
// narration now holds (and tells the table, so the draft bubble moves above
// the message about to land), or null when no narration is showing. A turn
// parked for dice still counts (its narration finishes on resume); one that
// ended without writing (a crash, the table handed to a person) does not.
export function claimNarrationSeq(campaignId: string, by: "person" | "line" = "person"): number | null {
  const slot = slots().get(campaignId);
  if (!slot) {
    return null;
  }
  const status = getDmTurn(slot.turnId)?.status;
  if (status !== "running" && status !== "awaiting_rolls") {
    slots().delete(campaignId);
    return null;
  }
  if (by === "person") {
    slot.person = true;
  }
  if (slot.seq === null) {
    slot.seq = allocateSeq(campaignId);
    publishEphemeral(campaignId, "dm_draft_seq", { seq: slot.seq });
  }
  return slot.seq;
}

// The seq for a server note posted to the table. While a turn's narration
// is on screen the note goes below it, and so below the rolls that caused
// it, the way a person's message does (issue 668); it shows live under the
// streaming draft. With no turn running (or once finalize has taken the
// slot) it is simply the next seq, as before.
export function tableNoteSeq(campaignId: string): number {
  claimNarrationSeq(campaignId, "line");
  return allocateSeq(campaignId);
}

// The turn is ending: the seq it claimed, if anything made it claim one,
// whether a person's message did, and the slot is cleared either way.
export function takeNarrationSlot(campaignId: string, turnId: string): { seq: number | null; person: boolean } {
  const slot = slots().get(campaignId);
  if (slot?.turnId !== turnId) {
    return { seq: null, person: false };
  }
  slots().delete(campaignId);
  return { seq: slot.seq, person: slot.person };
}

export function takeNarrationSeq(campaignId: string, turnId: string): number | null {
  return takeNarrationSlot(campaignId, turnId).seq;
}
