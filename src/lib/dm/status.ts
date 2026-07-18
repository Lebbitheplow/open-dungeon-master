import { publishEphemeral } from "@/lib/events";

// Last-published DM status per campaign, kept in memory so the campaign
// snapshot can report a turn already in flight (dm_status events are
// ephemeral and a client that reloads mid-turn would otherwise see idle).
// Lives on globalThis so dev-mode HMR cannot fork the map.

export type DmStatusState =
  | "idle"
  | "thinking"
  | "rolling"
  | "narrating"
  | "awaiting_rolls"
  | "writing_chapter"
  | "plotting_arc";

declare global {
  var __odmDmStatus: Map<string, DmStatusState> | undefined;
}

function statuses() {
  return (globalThis.__odmDmStatus ??= new Map<string, DmStatusState>());
}

export function setDmStatus(campaignId: string, state: DmStatusState) {
  statuses().set(campaignId, state);
  publishEphemeral(campaignId, "dm_status", { state });
}

export function getDmStatus(campaignId: string): DmStatusState {
  return statuses().get(campaignId) ?? "idle";
}
