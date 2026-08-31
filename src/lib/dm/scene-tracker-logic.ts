// Exploration and social encounter trackers: structure for the scenes that
// are not fights.
//
// Combat has an encounter row, an initiative order, a round counter and a
// win condition. A chase, a negotiation, a ritual and a skill challenge have
// exactly the same shape and had none of it: they were prose, and whether
// the party was winning was a thing the DM held in their head.
//
// A tracker is a clock with participants: N successes before M failures,
// counted in rounds, with each round's checks recorded. That is the 4e skill
// challenge, the Blades progress clock and the 5e chase all at once, because
// they are the same object.
//
// Pure by design: no imports at all, so scripts/test-scene-tracker.mjs can
// load it and the console can preview a clock before starting it.

export const TRACKER_KINDS = ["exploration", "social", "chase", "ritual"] as const;
export type TrackerKind = (typeof TRACKER_KINDS)[number];

export const TRACKER_KIND_LABELS: Record<TrackerKind, string> = {
  exploration: "Exploration",
  social: "Negotiation",
  chase: "Chase",
  ritual: "Ritual or task",
};

export const TRACKER_KIND_HINTS: Record<TrackerKind, string> = {
  exploration: "Crossing something dangerous: a swamp, a collapsing ruin, a blizzard.",
  social: "Talking someone round. Each round is one approach, and a failure hardens them.",
  chase: "Running someone down, or away. Failures are ground lost.",
  ritual: "A long working under pressure. Failures are the thing going wrong.",
};

export const TRACKER_TITLE_MAX = 80;
export const MAX_CLOCK = 12;
export const MAX_ROUNDS_RECORDED = 40;

export type TrackerEntry = {
  round: number;
  characterId: string;
  characterName: string;
  // What they tried, in the DM's or the player's words.
  approach: string;
  skill: string;
  dc: number;
  total: number;
  success: boolean;
};

export type SceneTracker = {
  id: string;
  campaignId: string;
  kind: TrackerKind;
  title: string;
  // What winning looks like and what losing looks like, in the DM's words.
  // Written down at the start so the outcome is not renegotiated at the end.
  onSuccess: string;
  onFailure: string;
  successesNeeded: number;
  failuresAllowed: number;
  successes: number;
  failures: number;
  round: number;
  // Every check that has counted, newest last.
  log: TrackerEntry[];
  // "running" until it resolves; then it stays for the record.
  status: TrackerStatus;
  // Which characters are in it. Empty means the whole party.
  characterIds: string[];
  createdAt: string;
};

export const TRACKER_STATUSES = ["running", "won", "lost", "abandoned"] as const;
export type TrackerStatus = (typeof TRACKER_STATUSES)[number];

export type TrackerInput = {
  kind: unknown;
  title: unknown;
  successesNeeded?: unknown;
  failuresAllowed?: unknown;
  onSuccess?: unknown;
  onFailure?: unknown;
  characterIds?: unknown;
};

// The 4e default and still the best starting shape: three failures ends it,
// and the successes needed scale with how hard the DM wants it to be.
export const DEFAULT_SUCCESSES = 4;
export const DEFAULT_FAILURES = 3;

export function checkTracker(
  input: TrackerInput,
): { tracker: Omit<SceneTracker, "id" | "campaignId" | "createdAt"> } | { error: string } {
  const kind = String(input.kind ?? "") as TrackerKind;
  if (!TRACKER_KINDS.includes(kind)) {
    return { error: `"${input.kind}" is not a kind of scene this tracks.` };
  }
  const title = String(input.title ?? "").trim().slice(0, TRACKER_TITLE_MAX);
  if (!title) {
    return { error: "Name the scene." };
  }
  const successesNeeded = clampClock(input.successesNeeded, DEFAULT_SUCCESSES);
  const failuresAllowed = clampClock(input.failuresAllowed, DEFAULT_FAILURES);
  return {
    tracker: {
      kind,
      title,
      onSuccess: String(input.onSuccess ?? "").trim().slice(0, 300),
      onFailure: String(input.onFailure ?? "").trim().slice(0, 300),
      successesNeeded,
      failuresAllowed,
      successes: 0,
      failures: 0,
      round: 1,
      log: [],
      status: "running",
      characterIds: Array.isArray(input.characterIds)
        ? (input.characterIds as unknown[]).slice(0, 12).map((id) => String(id))
        : [],
    },
  };
}

function clampClock(raw: unknown, fallback: number): number {
  const value = Math.round(Number(raw));
  if (!Number.isFinite(value) || value < 1) {
    return fallback;
  }
  return Math.min(MAX_CLOCK, value);
}

// Recording one check against the clock. Returns the tracker as it now
// stands, plus whether this check ended the scene, so the caller can narrate
// the outcome in the same breath as the roll.
export type TrackerAdvance = {
  tracker: SceneTracker;
  resolved: boolean;
  outcome: TrackerStatus;
};

export function recordCheck(
  tracker: SceneTracker,
  entry: Omit<TrackerEntry, "round">,
): TrackerAdvance | { error: string } {
  if (tracker.status !== "running") {
    return { error: `"${tracker.title}" already finished.` };
  }
  const successes = tracker.successes + (entry.success ? 1 : 0);
  const failures = tracker.failures + (entry.success ? 0 : 1);
  // Failure is checked first: a check that fills both clocks at once is a
  // loss, because the failure that ended it happened.
  const status: TrackerStatus =
    failures >= tracker.failuresAllowed
      ? "lost"
      : successes >= tracker.successesNeeded
        ? "won"
        : "running";
  const next: SceneTracker = {
    ...tracker,
    successes,
    failures,
    status,
    // A round is everyone having had a go; the caller decides when that is,
    // and calls advanceRound. Recording a check does not move it, so two
    // players acting in the same round both land on that round.
    log: [...tracker.log, { ...entry, round: tracker.round }].slice(-MAX_ROUNDS_RECORDED),
  };
  return { tracker: next, resolved: status !== "running", outcome: status };
}

export function advanceRound(tracker: SceneTracker): SceneTracker {
  return tracker.status === "running" ? { ...tracker, round: tracker.round + 1 } : tracker;
}

export function abandonTracker(tracker: SceneTracker): SceneTracker {
  return tracker.status === "running" ? { ...tracker, status: "abandoned" } : tracker;
}

// ---- reading the clock ----

// How close the scene is to going either way, as a fraction, for a progress
// bar. Reported for both directions because a scene at 3 of 4 successes and
// 2 of 3 failures is tense in a way one number cannot say.
export function trackerProgress(tracker: SceneTracker): {
  success: number;
  failure: number;
} {
  return {
    success: Math.min(1, tracker.successes / Math.max(1, tracker.successesNeeded)),
    failure: Math.min(1, tracker.failures / Math.max(1, tracker.failuresAllowed)),
  };
}

// One line for the DM prompt and the players' banner. Says the count rather
// than the odds: a table that can see "2 of 4, one failure left" plays the
// scene, and a table shown a percentage plays the percentage.
export function describeTracker(tracker: SceneTracker): string {
  if (tracker.status === "won") {
    return `${tracker.title}: succeeded${tracker.onSuccess ? ` (${tracker.onSuccess})` : ""}.`;
  }
  if (tracker.status === "lost") {
    return `${tracker.title}: failed${tracker.onFailure ? ` (${tracker.onFailure})` : ""}.`;
  }
  if (tracker.status === "abandoned") {
    return `${tracker.title}: called off.`;
  }
  return `${TRACKER_KIND_LABELS[tracker.kind]} in progress, "${tracker.title}", round ${tracker.round}: ${tracker.successes} of ${tracker.successesNeeded} successes, ${tracker.failures} of ${tracker.failuresAllowed} failures.`;
}

// The block the DM prompt carries while a tracker runs. It states the stakes
// as well as the count, because a model that knows only the numbers narrates
// arithmetic.
export function trackerPromptBlock(tracker: SceneTracker | null): string {
  if (!tracker || tracker.status !== "running") {
    return "";
  }
  const lines = [
    `A structured scene is running: ${TRACKER_KIND_LABELS[tracker.kind].toLowerCase()}, "${tracker.title}".`,
    `Round ${tracker.round}. ${tracker.successes} of ${tracker.successesNeeded} successes, ${tracker.failures} of ${tracker.failuresAllowed} failures allowed.`,
    "Each player's action is one approach. Call for the check their approach actually calls for rather than the same skill every round, and narrate the scene shifting with each result: a success moves them closer, a failure costs them something now.",
  ];
  if (tracker.onSuccess) {
    lines.push(`If they succeed: ${tracker.onSuccess}`);
  }
  if (tracker.onFailure) {
    lines.push(`If they fail: ${tracker.onFailure}`);
  }
  if (tracker.log.length) {
    const recent = tracker.log.slice(-4).map(
      (entry) =>
        `round ${entry.round}, ${entry.characterName} ${entry.approach ? `(${entry.approach}) ` : ""}${entry.skill} ${entry.total} vs DC ${entry.dc}: ${entry.success ? "success" : "failure"}`,
    );
    lines.push(`So far: ${recent.join("; ")}.`);
  }
  return lines.join("\n");
}

// Anything unreadable reads as no tracker, rather than throwing: a corrupt
// clock should cost a scene its structure, not the session.
export function normalizeTracker(raw: unknown): SceneTracker | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const record = raw as Record<string, unknown>;
  const kind = String(record.kind ?? "") as TrackerKind;
  const status = String(record.status ?? "running") as TrackerStatus;
  if (!TRACKER_KINDS.includes(kind) || !TRACKER_STATUSES.includes(status)) {
    return null;
  }
  return {
    id: String(record.id ?? ""),
    campaignId: String(record.campaignId ?? ""),
    kind,
    title: String(record.title ?? "").slice(0, TRACKER_TITLE_MAX),
    onSuccess: String(record.onSuccess ?? "").slice(0, 300),
    onFailure: String(record.onFailure ?? "").slice(0, 300),
    successesNeeded: clampClock(record.successesNeeded, DEFAULT_SUCCESSES),
    failuresAllowed: clampClock(record.failuresAllowed, DEFAULT_FAILURES),
    successes: Math.max(0, Math.round(Number(record.successes) || 0)),
    failures: Math.max(0, Math.round(Number(record.failures) || 0)),
    round: Math.max(1, Math.round(Number(record.round) || 1)),
    log: Array.isArray(record.log)
      ? (record.log as Array<Record<string, unknown>>)
          .slice(-MAX_ROUNDS_RECORDED)
          .map((entry) => ({
            round: Math.max(1, Math.round(Number(entry?.round) || 1)),
            characterId: String(entry?.characterId ?? ""),
            characterName: String(entry?.characterName ?? "someone").slice(0, 60),
            approach: String(entry?.approach ?? "").slice(0, 120),
            skill: String(entry?.skill ?? "").slice(0, 40),
            dc: Math.round(Number(entry?.dc) || 0),
            total: Math.round(Number(entry?.total) || 0),
            success: entry?.success === true,
          }))
      : [],
    status,
    characterIds: Array.isArray(record.characterIds)
      ? (record.characterIds as unknown[]).slice(0, 12).map((id) => String(id))
      : [],
    createdAt: String(record.createdAt ?? new Date(0).toISOString()),
  };
}
