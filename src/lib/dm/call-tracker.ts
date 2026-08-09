import { publishEphemeral } from "@/lib/events";
import {
  addCall,
  removeCall,
  sortCalls,
  type UtilityCall,
  type UtilityCallKind,
} from "@/lib/dm/call-tracker-logic";

// In-flight utility calls per campaign, held in memory and republished on
// every change. Kept on globalThis for the same reason dm/status.ts is: dev
// HMR must not fork the map, and the campaign snapshot has to be able to
// report work already running so a client that reloads mid-call does not see
// an empty strip.

declare global {
  var __odmUtilityCalls: Map<string, UtilityCall[]> | undefined;
}

function registry() {
  return (globalThis.__odmUtilityCalls ??= new Map<string, UtilityCall[]>());
}

export function listUtilityCalls(campaignId: string): UtilityCall[] {
  return sortCalls(registry().get(campaignId) ?? []);
}

function publish(campaignId: string) {
  publishEphemeral(campaignId, "utility_calls", { calls: listUtilityCalls(campaignId) });
}

// Wraps any background job so it shows up while it runs. Deliberately at the
// call site rather than inside requestUtilityMessage: only the caller knows
// whether it is sealing a chapter or answering a question, and a label of
// "utility call" would tell a player nothing.
//
// The finally is load-bearing. A throw, a timeout, or a model error must
// still clear the chip, or the strip pins a job that is no longer running.
export async function trackUtilityCall<T>(
  campaignId: string,
  kind: UtilityCallKind,
  job: () => Promise<T>,
): Promise<T> {
  const call: UtilityCall = {
    id: crypto.randomUUID(),
    kind,
    startedAt: Date.now(),
  };
  registry().set(campaignId, addCall(registry().get(campaignId) ?? [], call));
  publish(campaignId);
  try {
    return await job();
  } finally {
    registry().set(campaignId, removeCall(registry().get(campaignId) ?? [], call.id));
    publish(campaignId);
  }
}
