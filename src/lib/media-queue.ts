// Global serial queue for GPU-heavy media jobs (ComfyUI images, TTS). One job
// at a time across ALL campaigns: the gfx1151 iGPU shares memory with the DM
// model, so overlapping renders cause OOM/hangs. Lives on globalThis so
// dev-mode HMR cannot fork the queue (same pattern as src/lib/dm/queue.ts).

declare global {
  var __odmMediaQueue: Promise<void> | undefined;
}

export function enqueueMediaJob(label: string, job: () => Promise<void>) {
  const tail = globalThis.__odmMediaQueue ?? Promise.resolve();
  const next = tail.then(job).catch((error) => {
    console.error(`[media] job "${label}" failed:`, error);
  });
  globalThis.__odmMediaQueue = next;
  return next;
}
