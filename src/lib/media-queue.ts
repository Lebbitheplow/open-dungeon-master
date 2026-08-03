// Serial queues for background media jobs, one job at a time PER LANE.
//
// "gpu" (the default) covers ComfyUI work — scene images, location maps,
// character portraits — across ALL campaigns: the gfx1151 iGPU shares memory
// with the DM model, so overlapping renders cause OOM/hangs.
//
// "tts" is separate on purpose. Kokoro runs on CPU here and does not contend
// for the iGPU, so narration must not wait behind a 25-step render; keeping it
// in its own lane is what lets audio start while the scene image is still
// generating. Lanes live on globalThis so dev-mode HMR cannot fork them (same
// pattern as src/lib/dm/queue.ts).

export type MediaLane = "gpu" | "tts";

declare global {
  var __odmMediaQueues: Partial<Record<MediaLane, Promise<void>>> | undefined;
}

export function enqueueMediaJob(
  label: string,
  job: () => Promise<void>,
  lane: MediaLane = "gpu",
) {
  const lanes = (globalThis.__odmMediaQueues ??= {});
  const tail = lanes[lane] ?? Promise.resolve();
  const next = tail.then(job).catch((error) => {
    console.error(`[media:${lane}] job "${label}" failed:`, error);
  });
  lanes[lane] = next;
  return next;
}
