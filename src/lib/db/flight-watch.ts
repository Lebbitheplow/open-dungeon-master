// A flyer knocked prone or held to a speed of 0 falls when the condition
// lands (SRD 5.1, Flying Movement), whichever route lays it: a spell and
// its save, an area, an attack's rider, a shove, set_condition, a drop to 0
// hit points. Each route wrote the rows and only some asked the board
// afterwards, so a flyer held by a spell or tripped by a rider stayed up
// until its next turn began. The rows are written here, below the board's
// rules, so the rule registers itself (src/lib/dm/token-state.ts) and runs
// once the write's own handler has finished, as side-watch.ts does for a
// Dominate.

import { newlyGrounded, type Aloft } from "@/lib/dm/flight-logic";

let land: ((campaignId: string) => void) | null = null;
// One landing per campaign per handler, however many rows it wrote.
const due = new Set<string>();

export function onGrounding(listener: (campaignId: string) => void) {
  land = listener;
}

export function noteGrounding(campaignId: string, before: Aloft | null, after: Aloft | null) {
  const listener = land;
  if (!campaignId || !listener || due.has(campaignId) || !newlyGrounded(before, after)) {
    return;
  }
  due.add(campaignId);
  queueMicrotask(() => {
    due.delete(campaignId);
    // A script that closed its database the moment it finished must not
    // take the process down: the flyer's next turn start lands it.
    try {
      listener(campaignId);
    } catch {
      // Nothing to undo: the rows are written.
    }
  });
}
