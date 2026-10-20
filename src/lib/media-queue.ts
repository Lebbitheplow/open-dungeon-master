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
// table's passages are read in the order they were written (unless narration
// has fallen well behind, when src/lib/tts.ts skips to the newest), and one table's
// long passage never holds up another table's (how many speech requests run
// at once across all of them is src/lib/tts.ts's to cap). Lanes live on
// globalThis so dev-mode HMR cannot fork them (same pattern as
// src/lib/dm/queue.ts).
//
// A picture asked for again while the first request is still waiting (a
// portrait regenerated twice, a map redrawn before the GPU got to it) is one
// picture, not two: on the gpu lane every job names what it paints, and a
// newer job for the same name takes the older one's place. The older
// caller's promise then settles when the newer job has run, so whoever was
// waiting on it still waits for a finished picture.

export type MediaLane = "gpu" | "tts" | `tts:${string}`;

type Waiting = { superseded: boolean; followers: Array<() => void> };

// `running` is 1 while the lane has a job under way: with `waiting`, what a
// picture still in the queue is behind (WorldForge's Paint says so).
export type LaneStats = { waiting: number; running: number; lastWaitMs: number; lastRunMs: number; superseded: number };

declare global {
  var __odmMediaQueues: Partial<Record<MediaLane, Promise<void>>> | undefined;
  var __odmMediaWaiting: Map<string, Waiting> | undefined;
  var __odmMediaStats: Map<string, LaneStats> | undefined;
}

function laneStats(lane: string): LaneStats {
  const stats = (globalThis.__odmMediaStats ??= new Map());
  let entry = stats.get(lane);
  if (!entry) {
    entry = { waiting: 0, running: 0, lastWaitMs: 0, lastRunMs: 0, superseded: 0 };
    stats.set(lane, entry);
  }
  return entry;
}

// How deep each lane is and how long its last job waited and ran: queue wait
// is the part a player feels that the model server never sees.
export function mediaQueueStats(): Record<string, LaneStats> {
  return Object.fromEntries(globalThis.__odmMediaStats ?? new Map());
}

export function enqueueMediaJob(
  label: string,
  job: () => Promise<void>,
  lane: MediaLane = "gpu",
): Promise<void> {
  const lanes = (globalThis.__odmMediaQueues ??= {});
  const waiting = (globalThis.__odmMediaWaiting ??= new Map());
  const stats = laneStats(lane);
  const tail = lanes[lane] ?? Promise.resolve();

  const key = `${lane}\u0000${label}`;
  const entry: Waiting = { superseded: false, followers: [] };
  if (lane === "gpu") {
    const earlier = waiting.get(key);
    if (earlier) {
      earlier.superseded = true;
      entry.followers.push(...earlier.followers);
      earlier.followers = [];
      stats.superseded += 1;
    }
    waiting.set(key, entry);
  }

  let settle: () => void = () => {};
  const settled = new Promise<void>((resolve) => {
    settle = resolve;
  });
  entry.followers.push(settle);

  const queuedAt = Date.now();
  stats.waiting += 1;
  // Whoever queued the picture or the passage is who it is counted for
  // once it runs (src/lib/usage/scope.ts).
  const scoped = bindUsageScope(job);
  const next = tail
    .then(async () => {
      stats.waiting -= 1;
      if (waiting.get(key) === entry) {
        waiting.delete(key);
      }
      if (entry.superseded) {
        return;
      }
      stats.lastWaitMs = Date.now() - queuedAt;
      const started = Date.now();
      stats.running = 1;
      try {
        await scoped();
      } finally {
        stats.running = 0;
        stats.lastRunMs = Date.now() - started;
      }
    })
    .catch((error) => {
      console.error(`[media:${lane}] job "${label}" failed:`, error);
    })
    .finally(() => {
      if (!entry.superseded) {
        for (const follower of entry.followers) {
          follower();
        }
        entry.followers = [];
      }
    });
  lanes[lane] = next;
  // A campaign's lane is forgotten once it runs dry, so the map does not
  // keep a settled promise for every table that ever narrated.
  if (lane.startsWith("tts:")) {
    void next.then(() => {
      if (lanes[lane] === next) {
        delete lanes[lane];
        globalThis.__odmMediaStats?.delete(lane);
      }
    });
  }
  return settled;
}
