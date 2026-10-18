import { AsyncLocalStorage } from "node:async_hooks";
import {
  DM_JOB_STAGE_DEADLINES_MS,
  type DmJobKind,
  type DmJobStage,
  type DmJobView,
} from "@/lib/dm/job-stage-logic";

// The DM job running right now, carried down its async call chain the way
// the usage scope is (src/lib/usage/scope.ts), so the model client, the
// embedder and the turn can each report a stage, note progress and hear a
// stop without a control object threaded through every signature.
//
// The queue (src/lib/dm/queue.ts) opens one control per job it runs, watches
// it, and stops it; nothing here imports the queue, so the model client can
// import this without a cycle.

export class DmJobStopped extends Error {
  readonly reason: string;

  constructor(reason: string) {
    super(reason);
    this.name = "DmJobStopped";
    this.reason = reason;
  }
}

type Overlay = { stage: DmJobStage; deadlineMs: number };

export type DmJobControl = {
  id: string;
  campaignId: string;
  kind: DmJobKind;
  startedAt: number;
  controller: AbortController;
  // The step the job's own code is on (setJobStage), and the calls nested
  // inside it (withJobStage), which win while they run.
  baseStage: DmJobStage;
  overlays: Overlay[];
  stageSince: number;
  lastProgressAt: number;
  // The dm_turns row a turn job is driving, once it has one.
  turnId: string | null;
  stopReason: string | null;
  // Given up on: the job did not unwind after its stop, the queue moved on,
  // and anything it does if it ever wakes is fenced off.
  abandoned: boolean;
  settled: boolean;
  onChange: (control: DmJobControl) => void;
};

declare global {
  var __odmDmJobStorage: AsyncLocalStorage<DmJobControl> | undefined;
}

function storage() {
  return (globalThis.__odmDmJobStorage ??= new AsyncLocalStorage<DmJobControl>());
}

export function createDmJobControl(
  campaignId: string,
  kind: DmJobKind,
  onChange: (control: DmJobControl) => void,
): DmJobControl {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    campaignId,
    kind,
    startedAt: now,
    controller: new AbortController(),
    baseStage: "starting",
    overlays: [],
    stageSince: now,
    lastProgressAt: now,
    turnId: null,
    stopReason: null,
    abandoned: false,
    settled: false,
    onChange,
  };
}

export function runInDmJob<T>(control: DmJobControl, fn: () => T): T {
  return storage().run(control, fn);
}

// Work that must not count as the job's own: the queue halting a job it gave
// up on runs from a timer the job's context may still own.
export function runOutsideDmJob<T>(fn: () => T): T {
  return storage().exit(fn);
}

export function currentDmJob(): DmJobControl | undefined {
  return storage().getStore();
}

export function currentJobSignal(): AbortSignal | undefined {
  return currentDmJob()?.controller.signal;
}

export function jobStage(control: DmJobControl): DmJobStage {
  return control.overlays.at(-1)?.stage ?? control.baseStage;
}

export function jobDeadlineMs(control: DmJobControl, scale = 1): number {
  const overlay = control.overlays.at(-1);
  if (overlay) {
    return overlay.deadlineMs * scale;
  }
  const stage = control.baseStage;
  return (stage === "waiting_model" ? DM_JOB_STAGE_DEADLINES_MS.starting : DM_JOB_STAGE_DEADLINES_MS[stage]) * scale;
}

export function viewOf(control: DmJobControl): DmJobView {
  return {
    id: control.id,
    kind: control.kind,
    stage: jobStage(control),
    since: control.stageSince,
    startedAt: control.startedAt,
    stopping: Boolean(control.stopReason),
  };
}

function moved(control: DmJobControl, before: DmJobStage) {
  const now = Date.now();
  control.lastProgressAt = now;
  if (jobStage(control) !== before) {
    control.stageSince = now;
    control.onChange(control);
  }
}

// The step the job is on. Outside a job (a route answering directly, a test
// calling the turn) it does nothing.
export function setJobStage(stage: DmJobStage): void {
  const control = currentDmJob();
  if (!control || control.abandoned) {
    return;
  }
  const before = jobStage(control);
  control.baseStage = stage;
  moved(control, before);
}

// A call nested in the step, with its own deadline: a model request carries
// its timeout plus a grace, so the watchdog never undercuts it.
export async function withJobStage<T>(stage: DmJobStage, deadlineMs: number, fn: () => Promise<T>): Promise<T> {
  const control = currentDmJob();
  if (!control || control.abandoned) {
    return fn();
  }
  const overlay: Overlay = { stage, deadlineMs };
  const before = jobStage(control);
  control.overlays.push(overlay);
  moved(control, before);
  try {
    return await fn();
  } finally {
    const at = control.overlays.lastIndexOf(overlay);
    if (at >= 0) {
      const was = jobStage(control);
      control.overlays.splice(at, 1);
      moved(control, was);
    }
  }
}

// Something arrived (a streamed line, a finished embed): the job is alive.
export function noteJobProgress(): void {
  const control = currentDmJob();
  if (control) {
    control.lastProgressAt = Date.now();
  }
}

export function bindJobTurn(turnId: string): void {
  const control = currentDmJob();
  if (control) {
    control.turnId = turnId;
  }
}

// Why the current job was stopped, or null while it runs on.
export function jobStopReason(): string | null {
  const control = currentDmJob();
  return control?.stopReason ?? null;
}

export function jobAbandoned(): boolean {
  return currentDmJob()?.abandoned === true;
}

// Called where a stopped job must not go on: before another model call,
// before the narration is written.
export function assertJobLive(): void {
  const control = currentDmJob();
  if (control && (control.abandoned || control.stopReason)) {
    throw new DmJobStopped(control.stopReason ?? "the turn was stopped.");
  }
}

// A wait that cannot be cancelled itself (an agent program's reply) ends
// with the job's stop instead.
export function raceJobStop<T>(work: Promise<T>, onStop: (reason: string) => T): Promise<T> {
  const control = currentDmJob();
  if (!control) {
    return work;
  }
  const signal = control.controller.signal;
  if (signal.aborted) {
    return Promise.resolve(onStop(control.stopReason ?? "the turn was stopped."));
  }
  return new Promise<T>((resolve, reject) => {
    const stop = () => resolve(onStop(control.stopReason ?? "the turn was stopped."));
    signal.addEventListener("abort", stop, { once: true });
    work.then(
      (value) => {
        signal.removeEventListener("abort", stop);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", stop);
        reject(error);
      },
    );
  });
}
