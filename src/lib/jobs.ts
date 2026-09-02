import {
  getCampaignById,
  listIdleActiveCampaigns,
  listMembers,
  markCampaignNudged,
} from "@/lib/db/campaigns";
import { notifyUsers } from "@/lib/db/notifications";
import {
  listSessionsAwaitingReminder,
  sessionWhen,
  setSessionReminderStage,
} from "@/lib/db/scheduling";

// Background chores: session reminders and the idle-table nudge. One
// interval on globalThis (login-throttle pattern), started from
// src/instrumentation.ts, because a standalone Next server has no custom
// entry point of its own and dev HMR would strand a module-scoped timer.
//
// The decision logic is pure and takes the clock as an argument so the test
// harness can drive time (scripts/test-jobs.mjs); the tick functions only
// fetch candidates, ask the pure helpers, and write the results.

export const JOB_TICK_MS = 60_000;

const REMINDER_LEAD_MS = 60 * 60 * 1000;
// A session "is starting" for this long after its start time; beyond it the
// moment has passed and a late reminder would only be noise.
const START_GRACE_MS = 5 * 60 * 1000;
const IDLE_AFTER_MS = 4 * 24 * 60 * 60 * 1000;

// The reminder ladder a session climbs: stage 1 is the hour-before note,
// stage 2 the "starting now" one. Returns the stage that is due, or null.
// A session first seen inside the start window skips straight to stage 2:
// two notifications in the same minute would say the same thing twice.
export function dueReminderStage(
  session: { startsAt: string; remindedStage: number; cancelledAt: string | null },
  now = Date.now(),
): 1 | 2 | null {
  if (session.cancelledAt) {
    return null;
  }
  const startsAt = Date.parse(session.startsAt);
  if (!Number.isFinite(startsAt)) {
    return null;
  }
  if (session.remindedStage < 2 && startsAt <= now && now - startsAt <= START_GRACE_MS) {
    return 2;
  }
  if (session.remindedStage < 1 && startsAt > now && startsAt - now <= REMINDER_LEAD_MS) {
    return 1;
  }
  return null;
}

// One nudge per idle stretch: a nudge sent after the table's last activity
// already covers this stretch, and only new activity (updated_at moving past
// the nudge) arms the next one. ISO strings compare lexicographically, so no
// date parsing is needed for that half.
export function idleNudgeDue(
  campaign: { status: string; updatedAt: string; idleNudgedAt: string | null },
  now = Date.now(),
): boolean {
  if (campaign.status !== "active") {
    return false;
  }
  const updatedAt = Date.parse(campaign.updatedAt);
  if (!Number.isFinite(updatedAt) || now - updatedAt < IDLE_AFTER_MS) {
    return false;
  }
  return !campaign.idleNudgedAt || campaign.idleNudgedAt < campaign.updatedAt;
}

function sessionReminderJob(now: number) {
  const candidates = listSessionsAwaitingReminder(
    new Date(now - START_GRACE_MS).toISOString(),
    new Date(now + REMINDER_LEAD_MS).toISOString(),
  );
  for (const session of candidates) {
    const stage = dueReminderStage(session, now);
    if (!stage) {
      continue;
    }
    // Flag before sending, so a crash mid-send cannot double-remind.
    setSessionReminderStage(session.id, stage);
    const campaign = getCampaignById(session.campaignId);
    if (!campaign) {
      continue;
    }
    const memberIds = listMembers(session.campaignId).map((member) => member.userId);
    const title = session.title || "your session";
    notifyUsers(
      memberIds,
      stage === 1
        ? {
            campaignId: session.campaignId,
            kind: "session_reminder",
            body: `${campaign.title}: ${title} starts soon, at ${sessionWhen(session.startsAt)}. See you at the table.`,
          }
        : {
            campaignId: session.campaignId,
            kind: "session_starting",
            body: `${campaign.title}: ${title} is starting now. To the table!`,
          },
    );
  }
}

function idleCampaignJob(now: number) {
  const cutoff = new Date(now - IDLE_AFTER_MS).toISOString();
  for (const campaign of listIdleActiveCampaigns(cutoff)) {
    if (!idleNudgeDue(campaign, now)) {
      continue;
    }
    markCampaignNudged(campaign.id);
    notifyUsers(
      listMembers(campaign.id).map((member) => member.userId),
      {
        campaignId: campaign.id,
        kind: "campaign_idle",
        body: `The table misses you: ${campaign.title} has been quiet for a few days.`,
      },
    );
  }
}

const jobs: Array<[name: string, run: (now: number) => void]> = [
  ["session-reminders", sessionReminderJob],
  ["idle-campaigns", idleCampaignJob],
];

// One pass over every job. Exported so the test harness can drive ticks with
// its own clock instead of waiting a minute per assertion.
export function runJobsOnce(now = Date.now()) {
  for (const [name, run] of jobs) {
    try {
      run(now);
    } catch (error) {
      // One failing job must not take its siblings, or the loop, down.
      console.error(`[jobs] ${name} failed`, error);
    }
  }
}

declare global {
  var __odmJobRunner: ReturnType<typeof setInterval> | undefined;
}

export function startJobRunner() {
  if (globalThis.__odmJobRunner) {
    return;
  }
  const timer = setInterval(() => runJobsOnce(), JOB_TICK_MS);
  // The loop must never be the reason the process stays alive.
  timer.unref?.();
  globalThis.__odmJobRunner = timer;
}
