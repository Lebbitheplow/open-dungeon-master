// What a DM job is doing, in words a table reads, and how long each stage may
// go without progress before the queue's watchdog stops it (issue #383).
//
// A turn used to show one spinner from the moment a player acted until the
// narration landed. When something before the model call threw or never
// answered (the prompt build, a stalled embedding model), the spinner simply
// stayed, the queue behind it never moved, and nothing said where it stuck.
// The stages here name each step of a job, and the deadlines give every step
// an end.
//
// Dependency-free: the client imports the labels and the stop wording, and
// scripts/test-turn-watchdog.mjs imports the rest directly.

export type DmJobKind = "turn" | "work";

export type DmJobStage =
  | "starting"
  | "setting_scene"
  | "searching_lore"
  | "waiting_model"
  | "resolving"
  | "closing_chapter";

// Phrased for the table, like the utility call chips
// (src/lib/dm/call-tracker-logic.ts): what the engine is doing, not which
// function runs.
export const DM_JOB_STAGE_LABELS: Record<DmJobStage, string> = {
  starting: "Getting started",
  setting_scene: "Setting the scene",
  searching_lore: "Searching the lore",
  waiting_model: "Waiting on the model",
  resolving: "Resolving actions",
  closing_chapter: "Closing the chapter",
};

// How long a stage may go without progress. Engine stages are generous for
// what they are (a prompt build takes well under a second on a healthy
// server); a model stage's deadline comes from its own request timeout
// instead (src/lib/model-client.ts), so the watchdog never cuts a slow model
// off before the client's own timeout would.
export const DM_JOB_STAGE_DEADLINES_MS: Record<Exclude<DmJobStage, "waiting_model">, number> = {
  starting: 180_000,
  setting_scene: 90_000,
  searching_lore: 60_000,
  resolving: 120_000,
  closing_chapter: 180_000,
};

// Added to a model call's own timeout: that timeout fires first and the call
// returns its own error; the watchdog is only for a call that never returns.
export const MODEL_STAGE_GRACE_MS = 60_000;

// What the table and the client see of the job in flight.
export type DmJobView = {
  id: string;
  kind: DmJobKind;
  stage: DmJobStage;
  // Epoch millis the current stage began, so the client ticks elapsed time
  // without another event.
  since: number;
  startedAt: number;
  // A stop was asked for (the lead's button or the watchdog) and the job is
  // unwinding.
  stopping: boolean;
};

export function describeStage(stage: DmJobStage): string {
  return DM_JOB_STAGE_LABELS[stage] ?? "Working";
}

function spoken(ms: number): string {
  const seconds = Math.max(1, Math.round(ms / 1000));
  if (seconds < 90) {
    return `${seconds} second${seconds === 1 ? "" : "s"}`;
  }
  const minutes = Math.round(seconds / 60);
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}

// The halted notice's reason when the watchdog stops a job. It follows
// DM_HALTED_PREFIX ("The DM ran into a problem: "), so it starts lower case.
export function stalledReason(stage: DmJobStage, quietMs: number): string {
  return `it went ${spoken(quietMs)} without progress while ${describeStage(stage).toLowerCase()}, so the turn was stopped. Retry it, or send a new action.`;
}

export const LEAD_STOPPED_REASON = "the lead stopped this turn. Retry it, or send a new action.";

export const REWOUND_REASON = "the story was rewound while this turn was running.";

// A throw before the turn had a prompt to send.
export function unbuiltReason(stage: DmJobStage): string {
  return `an internal error stopped the turn while ${describeStage(stage).toLowerCase()}, before the model was asked. Retry it, or send a new action.`;
}
