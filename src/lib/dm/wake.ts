// Break the import cycle between the turn machinery and the loop: modules
// deep in the turn (encounter-tools advancing onto an AI companion) need to
// request a follow-up DM turn, but requestDmTurn lives in loop.ts, which
// imports turn.ts. loop.ts registers itself here at load; everything the
// loop reaches can wake the DM without importing the loop.

type Waker = (campaignId: string) => void;

declare global {
  var __odmDmWaker: Waker | undefined;
}

export function registerDmWaker(waker: Waker) {
  globalThis.__odmDmWaker = waker;
}

export function wakeDm(campaignId: string) {
  globalThis.__odmDmWaker?.(campaignId);
}
