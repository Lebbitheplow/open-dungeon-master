import { randomUUID } from "node:crypto";
import { getDatabase, nowIso } from "@/lib/db/core";
import { updateWorldEntity, worldView } from "@/lib/db/world-forge";
import { isUploadedImagePath } from "@/lib/uploads";

// WorldForge's Paint as jobs that outlive the request (audit WF-16). Paint
// used to answer `{ queued: true }`, write the finished picture straight
// over the entry's, and log a failure only on the server; the panel polled
// for three minutes and then went quiet, and a reload lost even that. Now
// each picture asked for is a row:
//
//   queued -> working -> ready -> accepted | rejected
//         \-> cancelled \-> failed (with the reason)
//
// A request the server refuses before queueing (no image backend, the
// upload budget) is a failed row too, so the reason is still there after a
// reload. The render itself runs on the shared media queue
// (src/lib/media-queue.ts); this file only keeps its state.
//
// A finished picture never replaces the entry's own. It waits as `ready`
// until the DM accepts or rejects it, and the job remembers the picture the
// entry had when it was asked for (`previous`). If the entry's picture has
// changed since (an upload, a newer picture accepted, an earlier one put
// back), the job is `stale` and accepting it needs the DM to say so: a late
// result cannot replace a newer choice unnoticed. The pictures an entry had
// and the ones accepted stay named here, so they can be put back.

export type PaintJobState = "queued" | "working" | "ready" | "failed" | "cancelled" | "accepted" | "rejected";

export type PaintJob = {
  id: string;
  ref: string;
  state: PaintJobState;
  // Why it failed, in words for the DM.
  reason: string;
  // The finished picture, while it waits or once accepted. A rejected
  // picture's path is let go (the stored-file sweep, src/lib/ops/retention.ts,
  // removes a file no row names).
  result: string;
  // The entry's picture when this one was asked for ("" for none).
  previous: string;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  decidedAt: string | null;
  // The entry's picture is no longer the one this job was asked over.
  stale: boolean;
  // Still waiting for the queue after LONG_QUEUE_MS.
  longQueued: boolean;
};

export type PaintStatus = {
  ref: string;
  jobs: PaintJob[];
  // Pictures this entry had or was given through Paint that are not its
  // picture now, newest first: what "Use again" offers.
  earlier: string[];
};

type Row = {
  id: string;
  campaign_id: string;
  ref: string;
  state: PaintJobState;
  reason: string;
  result_path: string;
  previous_path: string;
  boot: string;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  decided_at: string | null;
};

export const LONG_QUEUE_MS = 2 * 60_000;
// The rows kept per entry: every job still open or waiting for a decision,
// and this many of the rest.
const KEPT = 12;

export const PAINT_RESTARTED = "The server restarted before this picture was painted. Nothing was changed; Retry paints it again.";

declare global {
  var __odmPaintBoot: string | undefined;
}

// This process. A job queued by another one is not on this process's media
// queue and never will be.
function boot(): string {
  globalThis.__odmPaintBoot ??= randomUUID();
  return globalThis.__odmPaintBoot;
}

function select(where: string): string {
  return `SELECT * FROM world_paint_jobs WHERE ${where}`;
}

function toJob(row: Row, portrait: string, now: number): PaintJob {
  const open = row.state === "queued" || row.state === "working" || row.state === "ready";
  return {
    id: row.id,
    ref: row.ref,
    state: row.state,
    reason: row.reason,
    result: row.result_path,
    previous: row.previous_path,
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    decidedAt: row.decided_at,
    stale: open && row.previous_path !== portrait,
    longQueued: row.state === "queued" && now - Date.parse(row.created_at) > LONG_QUEUE_MS,
  };
}

function rowById(campaignId: string, id: string): Row | undefined {
  return getDatabase().prepare(select(`id = ? AND campaign_id = ?`)).get(id, campaignId) as Row | undefined;
}

// Jobs a restart dropped: queued or working under another process. They
// fail with the reason, so the entry stops saying "Painting" and offers
// Retry, and a new Paint is not refused as already running.
export function failLostPaintJobs(campaignId: string): number {
  return getDatabase()
    .prepare(`UPDATE world_paint_jobs SET state = 'failed', reason = ?, finished_at = ? WHERE campaign_id = ? AND state IN ('queued', 'working') AND boot != ?`)
    .run(PAINT_RESTARTED, nowIso(), campaignId, boot()).changes;
}

function portraitOf(campaignId: string, ref: string): string | null {
  const entity = worldView(campaignId).entities.find((entry) => entry.ref === ref);
  return entity ? entity.portrait : null;
}

// The entry's jobs, newest first, with what can be put back.
export function paintStatus(campaignId: string, ref: string, portrait = portraitOf(campaignId, ref) ?? ""): PaintStatus {
  failLostPaintJobs(campaignId);
  const rows = getDatabase()
    .prepare(`${select(`campaign_id = ? AND ref = ?`)} ORDER BY created_at DESC, rowid DESC`)
    .all(campaignId, ref) as Row[];
  const now = Date.now();
  const earlier: string[] = [];
  for (const row of rows) {
    // An accepted picture first (newer), then the one it replaced.
    for (const path of row.state === "accepted" ? [row.result_path, row.previous_path] : [row.previous_path]) {
      if (path && path !== portrait && isUploadedImagePath(path) && !earlier.includes(path)) earlier.push(path);
    }
  }
  return { ref, jobs: rows.slice(0, KEPT).map((row) => toJob(row, portrait, now)), earlier };
}

export type Opened = { job: PaintJob; already: boolean };

// A new queued job, unless one for this entry is already queued or working:
// then that one, so two presses (or two tabs) paint one picture. In one
// transaction, so two requests racing cannot both open one.
export function openPaintJob(campaignId: string, ref: string, userId: string | null, previous: string): Opened {
  const db = getDatabase();
  return db.transaction((): Opened => {
    failLostPaintJobs(campaignId);
    const running = db
      .prepare(`${select(`campaign_id = ? AND ref = ? AND state IN ('queued', 'working')`)} ORDER BY created_at DESC LIMIT 1`)
      .get(campaignId, ref) as Row | undefined;
    if (running) return { job: toJob(running, previous, Date.now()), already: true };
    const id = randomUUID();
    db.prepare(
      `INSERT INTO world_paint_jobs (id, campaign_id, ref, user_id, state, previous_path, boot, created_at) VALUES (?, ?, ?, ?, 'queued', ?, ?, ?)`,
    ).run(id, campaignId, ref, userId, previous, boot(), nowIso());
    prune(campaignId, ref);
    return { job: toJob(rowById(campaignId, id)!, previous, Date.now()), already: false };
  })();
}

// A request refused before it reached the queue, kept with its reason.
export function refusedPaintJob(campaignId: string, ref: string, userId: string | null, previous: string, reason: string): PaintJob {
  const id = randomUUID();
  const at = nowIso();
  getDatabase()
    .prepare(
      `INSERT INTO world_paint_jobs (id, campaign_id, ref, user_id, state, reason, previous_path, boot, created_at, finished_at) VALUES (?, ?, ?, ?, 'failed', ?, ?, ?, ?, ?)`,
    )
    .run(id, campaignId, ref, userId, reason, previous, boot(), at, at);
  prune(campaignId, ref);
  return toJob(rowById(campaignId, id)!, previous, Date.now());
}

// The queue reached the job. False when it was cancelled while it waited
// (or a restart sweep failed it): then nothing is painted.
export function startPaintJob(id: string): boolean {
  return getDatabase().prepare(`UPDATE world_paint_jobs SET state = 'working', started_at = ? WHERE id = ? AND state = 'queued'`).run(nowIso(), id).changes === 1;
}

export function finishPaintJob(id: string, result: string): boolean {
  return getDatabase()
    .prepare(`UPDATE world_paint_jobs SET state = 'ready', result_path = ?, finished_at = ? WHERE id = ? AND state = 'working'`)
    .run(result, nowIso(), id).changes === 1;
}

export function failPaintJob(id: string, reason: string): void {
  getDatabase()
    .prepare(`UPDATE world_paint_jobs SET state = 'failed', reason = ?, finished_at = ? WHERE id = ? AND state IN ('queued', 'working')`)
    .run(reason, nowIso(), id);
}

export type Decided = { job: PaintJob; status: PaintStatus } | { error: string; status: number; stale?: boolean; job?: PaintJob };

function decided(campaignId: string, ref: string, id: string): Decided {
  const status = paintStatus(campaignId, ref);
  const job = status.jobs.find((entry) => entry.id === id) ?? toJob(rowById(campaignId, id)!, portraitOf(campaignId, ref) ?? "", Date.now());
  return { job, status };
}

function openJob(campaignId: string, id: string, states: PaintJobState[]): Row | { error: string; status: number } {
  failLostPaintJobs(campaignId);
  const row = rowById(campaignId, id);
  if (!row) return { error: "No such picture for this entry.", status: 404 };
  if (!states.includes(row.state)) {
    const now: Record<PaintJobState, string> = {
      queued: "is still waiting for the queue",
      working: "is being painted and cannot be stopped now",
      ready: "is waiting for you to accept or reject it",
      failed: "failed",
      cancelled: "was cancelled",
      accepted: "was already accepted",
      rejected: "was already rejected",
    };
    return { error: `That picture ${now[row.state]}.`, status: 409 };
  }
  return row;
}

// Only while it waits: a render the backend has started cannot be called
// back.
export function cancelPaintJob(campaignId: string, id: string): Decided {
  const row = openJob(campaignId, id, ["queued"]);
  if ("error" in row) return row;
  getDatabase().prepare(`UPDATE world_paint_jobs SET state = 'cancelled', decided_at = ? WHERE id = ? AND state = 'queued'`).run(nowIso(), id);
  return decided(campaignId, row.ref, id);
}

// The finished picture becomes the entry's. Refused, with the job, when the
// entry's picture changed after this one was asked for, unless `replace`
// says the DM has seen that and wants this one anyway.
export function acceptPaintJob(campaignId: string, id: string, replace: boolean): Decided {
  const row = openJob(campaignId, id, ["ready"]);
  if ("error" in row) return row;
  const portrait = portraitOf(campaignId, row.ref);
  if (portrait === null) return { error: "That entry is gone.", status: 404 };
  if (portrait !== row.previous_path && !replace) {
    return {
      error: "This entry's picture was changed after this one was asked for. Accept it anyway to replace the newer picture.",
      status: 409,
      stale: true,
      job: toJob(row, portrait, Date.now()),
    };
  }
  const written = updateWorldEntity(campaignId, row.ref, { portrait: row.result_path });
  if ("error" in written) return { error: written.error, status: written.status ?? 400 };
  getDatabase().prepare(`UPDATE world_paint_jobs SET state = 'accepted', decided_at = ? WHERE id = ?`).run(nowIso(), id);
  return decided(campaignId, row.ref, id);
}

// The entry keeps its picture, and the finished one is let go.
export function rejectPaintJob(campaignId: string, id: string): Decided {
  const row = openJob(campaignId, id, ["ready"]);
  if ("error" in row) return row;
  getDatabase().prepare(`UPDATE world_paint_jobs SET state = 'rejected', result_path = '', decided_at = ? WHERE id = ?`).run(nowIso(), id);
  return decided(campaignId, row.ref, id);
}

// "Use again": a picture this entry had, or was given through Paint, back
// on the entry. Only one of those, never any path a client names.
export function reusePaintedPicture(campaignId: string, ref: string, path: string): { status: PaintStatus } | { error: string; status: number } {
  if (portraitOf(campaignId, ref) === null) return { error: "That entry is gone.", status: 404 };
  if (!paintStatus(campaignId, ref).earlier.includes(path)) return { error: "That picture is not one this entry had.", status: 404 };
  const written = updateWorldEntity(campaignId, ref, { portrait: path });
  if ("error" in written) return { error: written.error, status: written.status ?? 400 };
  return { status: paintStatus(campaignId, ref) };
}

// Keeps every open job and the newest KEPT rows of the rest.
function prune(campaignId: string, ref: string): void {
  getDatabase()
    .prepare(
      `DELETE FROM world_paint_jobs WHERE campaign_id = ? AND ref = ? AND state NOT IN ('queued', 'working', 'ready') AND id NOT IN (
         SELECT id FROM world_paint_jobs WHERE campaign_id = ? AND ref = ? ORDER BY created_at DESC, rowid DESC LIMIT ${KEPT}
       )`,
    )
    .run(campaignId, ref, campaignId, ref);
}

export function forgetPaintJobs(campaignId: string, ref: string): void {
  getDatabase().prepare(`DELETE FROM world_paint_jobs WHERE campaign_id = ? AND ref = ?`).run(campaignId, ref);
}

