import { bindUsageScope } from "@/lib/usage/scope";
// Serial queues for background media jobs, one job at a time PER LANE.
//
// "gpu" (the default) covers ComfyUI work — scene images, location maps,
// character portraits — across ALL campaigns: the gfx1151 iGPU shares memory
// with the DM model, so overlapping renders cause OOM/hangs.
//
// "tts" is separate on purpose. Kokoro runs on CPU here and does not contend
// for the iGPU, so narration must not wait behind a 25-step render; keeping it
// in its own lane is what lets audio start while the scene image is still
// generating. Narration takes a lane per campaign ("tts:<campaign id>"): a
// table's passages are read in the order they were written, and one table's
// long passage never holds up another table's (how many speech requests run
// at once across all of them is src/lib/tts.ts's to cap). Lanes live on
// globalThis so dev-mode HMR cannot fork them (same pattern as
// src/lib/dm/queue.ts).

export type MediaLane = "gpu" | "tts" | `tts:${string}`;

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
  // Whoever queued the picture or the passage is who it is counted for
  // once it runs (src/lib/usage/scope.ts).
  const next = tail.then(bindUsageScope(job)).catch((error) => {
    console.error(`[media:${lane}] job "${label}" failed:`, error);
  });
  lanes[lane] = next;
  // A campaign's lane is forgotten once it runs dry, so the map does not
  // keep a settled promise for every table that ever narrated.
  if (lane.startsWith("tts:")) {
    void next.then(() => {
      if (lanes[lane] === next) {
        delete lanes[lane];
      }
    });
  }
  return next;
}
