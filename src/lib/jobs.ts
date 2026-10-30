import { purgeDueAccounts } from "@/lib/account-deletion";
import { syncAssistantRelay } from "@/lib/agents/assistant-relay";
import {
  getCampaignById,
  listIdleActiveCampaigns,
  listMembers,
  markCampaignNudged,
} from "@/lib/db/campaigns";
import { notifyUsers } from "@/lib/db/notifications";
import { retentionDue, runRetention } from "@/lib/ops/retention";
import { pruneExpiredSessions } from "@/lib/db/users";
import {
  listSessionsAwaitingReminder,
  nextScheduledSession,
  sessionWhen,
  setSessionReminderStage,
} from "@/lib/db/scheduling";

// Background chores: session reminders, the idle-table nudge, the daily
// storage tidy. One interval on globalThis (login-throttle pattern),
// started from src/instrumentation.ts, because a standalone Next server has
// no custom entry point of its own and dev HMR would strand a module-scoped
// timer.
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
    // A table with its next session booked is not idle, only between
    // sessions: a weekly group was told it was missed every week (issue
    // 586). The session's own reminders speak for it. One already under way
    // has had its "starting now" note, so a table still quiet through it is.
    const next = nextScheduledSession(campaign.id, now);
    if (next && Date.parse(next.startsAt) > now) {
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

// Expired sign-ins. The session lookup refuses them by date already; this
// only keeps the table from growing (src/lib/db/users.ts).
function expiredSessionsJob(now: number) {
  pruneExpiredSessions(new Date(now).toISOString());
}

// Accounts whose deletion grace period has run out (src/lib/account-deletion.ts).
function accountPurgeJob(now: number) {
  purgeDueAccounts(now);
}

// A device world's assistant links follow its shared address to the
// broker (src/lib/agents/assistant-relay.ts). Async, so it is started here
// and finishes on its own; it never runs two passes at once.
function assistantRelayJob(now: number) {
  void syncAssistantRelay(now).catch((error) => console.error("[jobs] assistant-relay failed", error));
}

// The daily tidy of what nothing reads back (src/lib/ops/retention.ts).
// Async and batched, so a long event log never holds the table up.
function retentionJob(now: number) {
  if (retentionDue(now)) {
    void runRetention(now).catch((error) => console.error("[jobs] retention failed", error));
  }
}

const jobs: Array<[name: string, run: (now: number) => void]> = [
  ["expired-sessions", expiredSessionsJob],
  ["session-reminders", sessionReminderJob],
  ["idle-campaigns", idleCampaignJob],
  ["account-purge", accountPurgeJob],
  ["assistant-relay", assistantRelayJob],
  ["retention", retentionJob],
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
