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
  // Audit rows the job wrote before its turn row existed (a companion's
  // leaving, the initiative pointer settled ahead of the prompt), adopted by
  // the turn once bindJobTurn names it (issue #622).
  unboundAudit: string[];
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
    unboundAudit: [],
    stopReason: null,
    abandoned: false,
    settled: false,
    onChange,
  };
}

// A job is its own work, never a turn scope it was started from: a turn
// enqueued while a console call ran (a wake, a resume) answers for itself.
export function runInDmJob<T>(control: DmJobControl, fn: () => T): T {
  return storage().run(control, () => turnScopes().exit(fn));
}

// Work that must not count as the job's own: the queue halting a job it gave
// up on runs from a timer the job's context may still own.
export function runOutsideDmJob<T>(fn: () => T): T {
  return detachFromTurn(fn);
}

// ---- the turn the work belongs to ----
//
// Every sheet change a turn makes is written to the audit trail under that
// turn, so "Revert this turn" can take it back. The callers that knew the
// turn passed it; the ones deep in the engine (the clock's death saves, a
// disease's symptoms, the initiative pointer's saves) had no turn to pass
// and wrote none, so the revert missed them (issue #622). The turn now rides
// the async call chain: a queue job's own (bindJobTurn), or a scope opened
// by the paths that run a turn outside the queue (a console call, a parked
// roll answered at the table).

type TurnScope = { turnId: string; open: boolean };

declare global {
  var __odmTurnScopeStorage: AsyncLocalStorage<TurnScope> | undefined;
}

function turnScopes() {
  return (globalThis.__odmTurnScopeStorage ??= new AsyncLocalStorage<TurnScope>());
}

// Runs `fn` as part of this turn. The scope closes when `fn` returns (or its
// promise settles), so a timer it started that fires later is nobody's turn.
export function runInTurnScope<T>(turnId: string, fn: () => T): T {
  const scope: TurnScope = { turnId, open: true };
  let out: T;
  try {
    out = turnScopes().run(scope, fn);
  } catch (error) {
    scope.open = false;
    throw error;
  }
  if (out instanceof Promise) {
    return out.finally(() => {
      scope.open = false;
    }) as T;
  }
  scope.open = false;
  return out;
}

// The turn the work running now belongs to, or null. An explicit scope
// wins; a closed one means the work outlived its turn. Inside a queue job
// it is the job's turn while the job runs: a timer the job left behind
// fires after it settled and belongs to nobody. An abandoned job that wakes
// is still its own turn's work.
export function currentTurnId(): string | null {
  const scope = turnScopes().getStore();
  if (scope) {
    return scope.open ? scope.turnId : null;
  }
  const control = currentDmJob();
  return control && (!control.settled || control.abandoned) ? control.turnId : null;
}

// An audit row written with no turn by a job that has none yet: kept, so the
// turn that job goes on to open takes it in (bindJobTurn).
export function awaitTurnBinding(auditId: string): void {
  if (turnScopes().getStore()) {
    return;
  }
  const control = currentDmJob();
  if (control && !control.settled && !control.turnId) {
    control.unboundAudit.push(auditId);
  }
}

// Timers, intervals and fire-and-forget work started inside a turn that may
// run long after it: they must never write under a turn that is over (or
// still running, but not theirs).
export function detachFromTurn<T>(fn: () => T): T {
  return storage().exit(() => turnScopes().exit(fn));
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

// Names the turn the current job drives. Returns the audit rows the job wrote
// before it had one, for the caller to file under it (sheet-audit.ts
// adoptTurnAudit; this module stays free of the database).
export function bindJobTurn(turnId: string): string[] {
  const control = currentDmJob();
  if (!control) {
    return [];
  }
  control.turnId = turnId;
  return control.unboundAudit.splice(0);
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
