// Per-campaign job serializer: at most one DM narration runs per campaign at
// a time, and jobs run in arrival order. Lives on globalThis so dev-mode HMR
// cannot fork the queue. llama-server runs with --parallel 1, so global
// concurrency stays low naturally (jobs from different campaigns queue at the
// model server).
//
// Every job ends (issue #383). A job that threw before its turn existed, or
// waited on something that never answered (an embedding model, a hung
// call), used to hold its campaign's queue for good: the table watched "DM
// at work" forever and Ask, Rewind and every later turn waited behind it.
// Now each job runs under a control (src/lib/dm/job-control.ts) that names
// its stage, and a watchdog stops a stage that goes quiet past its deadline
// (src/lib/dm/job-stage-logic.ts). A stopped job unwinds through its own
// error handling; one that does not unwind is abandoned after a grace, its
// turn halted with a Retry, and the queue moves on. And whatever a job left
// on the status line, the last job out of a campaign's queue sets it right.

import { bindUsageScope } from "@/lib/usage/scope";
import { publishEphemeral } from "@/lib/events";
import { knownDmStatus, setDmStatus } from "@/lib/dm/status";
import { latestTurnParkedByAi } from "@/lib/db/dm-turns";
import { createDmJobControl, jobDeadlineMs, jobStage, runInDmJob, viewOf, type DmJobControl } from "@/lib/dm/job-control";
import { describeStage, stalledReason, type DmJobKind, type DmJobView } from "@/lib/dm/job-stage-logic";
import { haltAbandonedJob } from "@/lib/dm/turn-halt";

type Pause = { reasons: string[]; promise: Promise<void>; resolve: () => void };

declare global {
  var __odmDmQueues: Map<string, Promise<void>> | undefined;
  var __odmDmPauses: Map<string, Pause> | undefined;
  var __odmDmDropped: Set<string> | undefined;
  var __odmDmDepths: Map<string, number> | undefined;
  var __odmDmRunning: Map<string, DmJobControl> | undefined;
  var __odmDmWatchdog: { timer: ReturnType<typeof setInterval> | null; checkMs: number; graceMs: number; scale: number } | undefined;
}

function queues() {
  return (globalThis.__odmDmQueues ??= new Map<string, Promise<void>>());
}

function pauses() {
  return (globalThis.__odmDmPauses ??= new Map<string, Pause>());
}

function running() {
  return (globalThis.__odmDmRunning ??= new Map<string, DmJobControl>());
}

function watchdog() {
  return (globalThis.__odmDmWatchdog ??= { timer: null, checkMs: 5_000, graceMs: 15_000, scale: 1 });
}

// A paused campaign (docs/vtt-parity-implementation-plan.md 9.1, the
// X-card) keeps its queue but runs nothing: every job waits at the gate
// until someone resumes it. A campaign can be paused for more than one
// reason at once (the X-card raised during a table break): each reason is
// lifted on its own, and the gate opens only once none is left. Pausing
// again for a reason already held changes nothing, and the first reason
// stays the one dmQueuePaused names.
export function pauseDmQueue(campaignId: string, reason: string): void {
  const held = pauses().get(campaignId);
  if (held) {
    if (!held.reasons.includes(reason)) {
      held.reasons.push(reason);
    }
    return;
  }
  let resolve: () => void = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  pauses().set(campaignId, { reasons: [reason], promise, resolve });
}

// Lifts one reason, or with none named every reason at once (a deleted
// campaign). True when something was lifted; the queue runs again only when
// no reason is left.
export function resumeDmQueue(campaignId: string, reason?: string): boolean {
  const pause = pauses().get(campaignId);
  if (!pause) {
    return false;
  }
  if (reason !== undefined) {
    const at = pause.reasons.indexOf(reason);
    if (at < 0) {
      return false;
    }
    pause.reasons.splice(at, 1);
    if (pause.reasons.length) {
      return true;
    }
  }
  pauses().delete(campaignId);
  pause.resolve();
  return true;
}

export function dmQueuePaused(campaignId: string): string | null {
  return pauses().get(campaignId)?.reasons[0] ?? null;
}

// Whether the campaign is paused for this reason, whatever else holds it.
export function dmQueuePausedFor(campaignId: string, reason: string): boolean {
  return pauses().get(campaignId)?.reasons.includes(reason) ?? false;
}

function gate(campaignId: string): Promise<void> {
  const pause = pauses().get(campaignId);
  return pause ? pause.promise.then(() => gate(campaignId)) : Promise.resolve();
}

// Campaigns deleted while jobs were still waiting: those jobs are skipped
// rather than run against rows that are gone.
function dropped() {
  return (globalThis.__odmDmDropped ??= new Set<string>());
}

function depths() {
  return (globalThis.__odmDmDepths ??= new Map<string, number>());
}

// How many jobs a campaign has queued or running.
export function dmQueueDepth(campaignId: string): number {
  return depths().get(campaignId) ?? 0;
}

// Across every campaign: how many have work queued and how many jobs that is.
export function dmQueueTotals(): { campaigns: number; jobs: number } {
  let jobs = 0;
  for (const depth of depths().values()) jobs += depth;
  return { campaigns: depths().size, jobs };
}

// The job a campaign is running now, as the table sees it.
export function runningDmJob(campaignId: string): DmJobView | null {
  const control = running().get(campaignId);
  return control ? viewOf(control) : null;
}

function publishJob(campaignId: string) {
  publishEphemeral(campaignId, "dm_job", { job: runningDmJob(campaignId) });
}

export type DmJobOptions = {
  // A "turn" is answered at the table when it is stopped: a halted notice
  // with Retry. Anything else only lets go of the status line.
  kind?: DmJobKind;
};

export function enqueueDmJob(campaignId: string, job: () => Promise<void>, options: DmJobOptions = {}) {
  const tail = queues().get(campaignId) ?? Promise.resolve();
  // The job runs later, off the request that queued it; it still answers
  // to this campaign in the usage ledger (src/lib/usage/scope.ts).
  const scoped = bindUsageScope(job, { campaignId });
  depths().set(campaignId, dmQueueDepth(campaignId) + 1);
  const next = tail
    .then(() => gate(campaignId))
    .then(() => (dropped().has(campaignId) ? undefined : runJob(campaignId, scoped, options.kind ?? "work")))
    .catch((error) => {
      console.error(`[dm] job failed for campaign ${campaignId}:`, error);
    })
    .finally(() => {
      const left = dmQueueDepth(campaignId) - 1;
      if (left > 0) {
        depths().set(campaignId, left);
      } else {
        depths().delete(campaignId);
        settleStatus(campaignId);
      }
      // The last job out takes the campaign's entry with it, so the map does
      // not keep a settled promise for every table that ever had a turn.
      if (queues().get(campaignId) === next) {
        queues().delete(campaignId);
        dropped().delete(campaignId);
      }
    });
  queues().set(campaignId, next);
  return next;
}

// Runs one job under its control. The race is what lets the queue move past
// a job that was stopped and never unwound.
async function runJob(campaignId: string, job: () => Promise<void>, kind: DmJobKind) {
  const control = createDmJobControl(campaignId, kind, () => publishJob(campaignId));
  let release: () => void = () => {};
  const abandoned = new Promise<void>((resolve) => {
    release = resolve;
  });
  releases.set(control, release);
  running().set(campaignId, control);
  publishJob(campaignId);
  ensureWatchdog();
  try {
    await Promise.race([runInDmJob(control, job), abandoned]);
  } finally {
    control.settled = true;
    releases.delete(control);
    if (running().get(campaignId) === control) {
      running().delete(campaignId);
      publishJob(campaignId);
    }
  }
}

const releases = new WeakMap<DmJobControl, () => void>();

// Nothing is running and nothing is queued, yet the status line says the DM
// is at work: a job returned early (a table back in the lobby) or was
// abandoned. Only a turn parked on physical dice may keep a status with
// the queue empty. Only a status this process set is read: one it never set
// is idle already, or a parked turn's, read from the database when asked.
function settleStatus(campaignId: string) {
  const state = knownDmStatus(campaignId);
  if (!state || state === "idle" || state === "awaiting_rolls") {
    return;
  }
  try {
    if (latestTurnParkedByAi(campaignId)) {
      setDmStatus(campaignId, "awaiting_rolls");
      return;
    }
    console.warn(`[dm] campaign ${campaignId}: the queue ran dry with the status still "${state}"; the table is set back to idle.`);
    setDmStatus(campaignId, "idle");
  } catch (error) {
    console.error(`[dm] campaign ${campaignId}: could not settle the status after the queue ran dry`, error);
  }
}

// Stops the job a campaign is running: the lead's Stop, a rewind, or the
// watchdog. The job hears it through its signal (a model request aborts, a
// stopped turn writes its halted notice on the way out); one that has not
// unwound after the grace is abandoned. False when nothing was running or a
// stop is already under way.
export function stopDmJob(campaignId: string, reason: string, options: { graceMs?: number } = {}): boolean {
  const control = running().get(campaignId);
  if (!control || control.stopReason || control.settled) {
    return false;
  }
  control.stopReason = reason;
  console.warn(
    `[dm] campaign ${campaignId}: stopping the ${control.kind} job while ${describeStage(jobStage(control)).toLowerCase()} (${Math.round((Date.now() - control.startedAt) / 1000)}s in): ${reason}`,
  );
  control.controller.abort();
  publishJob(campaignId);
  const timer = setTimeout(() => abandonIfStuck(control), options.graceMs ?? watchdog().graceMs);
  timer.unref?.();
  return true;
}

function abandonIfStuck(control: DmJobControl) {
  if (control.settled) {
    return;
  }
  control.abandoned = true;
  console.error(
    `[dm] campaign ${control.campaignId}: the ${control.kind} job did not stop while ${describeStage(jobStage(control)).toLowerCase()}; it was abandoned and the queue moves on.`,
  );
  try {
    haltAbandonedJob(control);
  } catch (error) {
    console.error(`[dm] campaign ${control.campaignId}: could not halt the abandoned job`, error);
  }
  releases.get(control)?.();
}

function ensureWatchdog() {
  const dog = watchdog();
  if (dog.timer) {
    return;
  }
  dog.timer = setInterval(checkJobs, dog.checkMs);
  dog.timer.unref?.();
}

function checkJobs() {
  const now = Date.now();
  const { scale } = watchdog();
  for (const control of running().values()) {
    if (control.stopReason || control.settled) {
      continue;
    }
    const quiet = now - control.lastProgressAt;
    if (quiet > jobDeadlineMs(control, scale)) {
      stopDmJob(control.campaignId, stalledReason(jobStage(control), quiet));
    }
  }
}

// Tests run the watchdog fast: a check every few milliseconds, a short
// grace, every deadline scaled down.
export function configureDmWatchdog(settings: { checkMs?: number; graceMs?: number; scale?: number }): void {
  const dog = watchdog();
  Object.assign(dog, Object.fromEntries(Object.entries(settings).filter(([, value]) => value !== undefined)));
  if (dog.timer) {
    clearInterval(dog.timer);
    dog.timer = null;
  }
  if (running().size) {
    ensureWatchdog();
  }
}

// A deleted campaign: whatever is still waiting is skipped, a pause (which
// would hold those jobs forever) is lifted, and the entries go once the
// queue runs dry.
export function dropDmQueue(campaignId: string): void {
  if (queues().has(campaignId)) {
    dropped().add(campaignId);
  }
  resumeDmQueue(campaignId);
}
