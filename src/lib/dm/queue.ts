// Per-campaign job serializer: at most one DM narration runs per campaign at
// a time, and jobs run in arrival order. Lives on globalThis so dev-mode HMR
// cannot fork the queue. llama-server runs with --parallel 1, so global
// concurrency stays low naturally (jobs from different campaigns queue at the
// model server).

type Pause = { reason: string; promise: Promise<void>; resolve: () => void };

declare global {
  var __odmDmQueues: Map<string, Promise<void>> | undefined;
  var __odmDmPauses: Map<string, Pause> | undefined;
}

function queues() {
  return (globalThis.__odmDmQueues ??= new Map<string, Promise<void>>());
}

function pauses() {
  return (globalThis.__odmDmPauses ??= new Map<string, Pause>());
}

// A paused campaign (docs/vtt-parity-implementation-plan.md 9.1, the
// X-card) keeps its queue but runs nothing: every job waits at the gate
// until someone resumes it. Pausing twice keeps the first reason.
export function pauseDmQueue(campaignId: string, reason: string): void {
  if (pauses().has(campaignId)) {
    return;
  }
  let resolve: () => void = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  pauses().set(campaignId, { reason, promise, resolve });
}

export function resumeDmQueue(campaignId: string): boolean {
  const pause = pauses().get(campaignId);
  if (!pause) {
    return false;
  }
  pauses().delete(campaignId);
  pause.resolve();
  return true;
}

export function dmQueuePaused(campaignId: string): string | null {
  return pauses().get(campaignId)?.reason ?? null;
}

function gate(campaignId: string): Promise<void> {
  const pause = pauses().get(campaignId);
  return pause ? pause.promise.then(() => gate(campaignId)) : Promise.resolve();
}

export function enqueueDmJob(campaignId: string, job: () => Promise<void>) {
  const tail = queues().get(campaignId) ?? Promise.resolve();
  const next = tail
    .then(() => gate(campaignId))
    .then(job)
    .catch((error) => {
      console.error(`[dm] job failed for campaign ${campaignId}:`, error);
    });
  queues().set(campaignId, next);
  return next;
}
