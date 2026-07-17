// Per-campaign job serializer: at most one DM narration runs per campaign at
// a time, and jobs run in arrival order. Lives on globalThis so dev-mode HMR
// cannot fork the queue. llama-server runs with --parallel 1, so global
// concurrency stays low naturally (jobs from different campaigns queue at the
// model server).

declare global {
  var __odmDmQueues: Map<string, Promise<void>> | undefined;
}

function queues() {
  return (globalThis.__odmDmQueues ??= new Map<string, Promise<void>>());
}

export function enqueueDmJob(campaignId: string, job: () => Promise<void>) {
  const tail = queues().get(campaignId) ?? Promise.resolve();
  const next = tail.then(job).catch((error) => {
    console.error(`[dm] job failed for campaign ${campaignId}:`, error);
  });
  queues().set(campaignId, next);
  return next;
}
