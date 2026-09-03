// The background job loop: the pure due/dedupe decisions, then a real pass
// against a throwaway encrypted database (test-scheduling pattern).
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";
import { removeTempDir } from "./lib/remove-temp-dir.mjs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-jobs-"));
process.env.SQLITE_DB_PATH = path.join(dir, "test.sqlite");
process.env.DB_ENCRYPTION_KEY = randomBytes(32).toString("hex");

register("./lib/register-alias.mjs", import.meta.url);

const { getDatabase } = await import("../src/lib/db/core.ts");
const { createUser } = await import("../src/lib/db/users.ts");
const { createCampaign, joinByInviteCode, setCampaignStatus } = await import(
  "../src/lib/db/campaigns.ts"
);
const { createScheduledSession, updateScheduledSession } = await import(
  "../src/lib/db/scheduling.ts"
);
const { listNotifications } = await import("../src/lib/db/notifications.ts");
const { dueReminderStage, idleNudgeDue, runJobsOnce } = await import("../src/lib/jobs.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`ok: ${name}`);
}

const now = Date.now();
const MIN = 60_000;
const DAY = 86_400_000;
const iso = (ms) => new Date(ms).toISOString();

test("the hour-before reminder comes due inside the window, once", () => {
  const soon = { startsAt: iso(now + 30 * MIN), remindedStage: 0, cancelledAt: null };
  assert.equal(dueReminderStage(soon, now), 1);
  assert.equal(dueReminderStage({ ...soon, remindedStage: 1 }, now), null);
  const far = { startsAt: iso(now + 2 * 60 * MIN), remindedStage: 0, cancelledAt: null };
  assert.equal(dueReminderStage(far, now), null);
});

test("the starting-now note fires within the grace window, from any stage", () => {
  const starting = { startsAt: iso(now - 2 * MIN), remindedStage: 1, cancelledAt: null };
  assert.equal(dueReminderStage(starting, now), 2);
  // First seen inside the start window: skip straight to the final call.
  assert.equal(dueReminderStage({ ...starting, remindedStage: 0 }, now), 2);
  assert.equal(dueReminderStage({ ...starting, remindedStage: 2 }, now), null);
  const missed = { startsAt: iso(now - 10 * MIN), remindedStage: 0, cancelledAt: null };
  assert.equal(dueReminderStage(missed, now), null);
});

test("cancelled and unparseable sessions never remind", () => {
  assert.equal(
    dueReminderStage({ startsAt: iso(now + 30 * MIN), remindedStage: 0, cancelledAt: iso(now) }, now),
    null,
  );
  assert.equal(dueReminderStage({ startsAt: "garbage", remindedStage: 0, cancelledAt: null }, now), null);
});

test("the idle nudge fires once per quiet stretch and re-arms on activity", () => {
  const quiet = { status: "active", updatedAt: iso(now - 5 * DAY), idleNudgedAt: null };
  assert.equal(idleNudgeDue(quiet, now), true);
  // Already nudged since the table last moved: covered.
  assert.equal(idleNudgeDue({ ...quiet, idleNudgedAt: iso(now - DAY) }, now), false);
  // Came back after the nudge, then went quiet again: due once more.
  assert.equal(
    idleNudgeDue(
      { status: "active", updatedAt: iso(now - 5 * DAY), idleNudgedAt: iso(now - 6 * DAY) },
      now,
    ),
    true,
  );
  assert.equal(idleNudgeDue({ ...quiet, status: "ended" }, now), false);
  assert.equal(idleNudgeDue({ ...quiet, updatedAt: iso(now - 3 * DAY) }, now), false);
});

// The real loop, against real tables.
const gm = createUser("gm", "x");
const player = createUser("player", "x");
const campaign = createCampaign(gm.id, {
  title: "Test Table",
  description: "",
  theme: "",
  maxPlayers: 4,
  startingLevel: 1,
  difficulty: "normal",
});
joinByInviteCode(player.id, campaign.inviteCode);
const db = getDatabase();
const kinds = (userId) => listNotifications(userId).map((entry) => entry.kind);
const count = (userId, kind) => kinds(userId).filter((entry) => entry === kind).length;

const session = createScheduledSession(campaign.id, gm.id, {
  title: "The bridge",
  startsAt: iso(now + 30 * MIN),
  durationMin: 180,
  note: "",
});

test("a tick sends the hour-before reminder to every member, exactly once", () => {
  runJobsOnce(now);
  runJobsOnce(now + MIN);
  assert.equal(count(gm.id, "session_reminder"), 1);
  assert.equal(count(player.id, "session_reminder"), 1);
});

test("rescheduling re-arms the ladder and the start note follows", () => {
  updateScheduledSession(campaign.id, session.id, { startsAt: iso(now - MIN) });
  runJobsOnce(now);
  runJobsOnce(now + MIN);
  assert.equal(count(gm.id, "session_starting"), 1);
  assert.equal(count(player.id, "session_starting"), 1);
});

test("a quiet active table is nudged once, and again only after new activity", () => {
  setCampaignStatus(campaign.id, "active");
  // Time travel: the table last moved five days ago.
  db.prepare(`UPDATE campaigns SET updated_at = ? WHERE id = ?`).run(iso(now - 5 * DAY), campaign.id);
  runJobsOnce(now);
  runJobsOnce(now + MIN);
  assert.equal(count(gm.id, "campaign_idle"), 1);
  assert.equal(count(player.id, "campaign_idle"), 1);
  // The table came back after the nudge, then went quiet for five more days.
  db.prepare(`UPDATE campaigns SET updated_at = ?, idle_nudged_at = ? WHERE id = ?`).run(
    iso(now - 5 * DAY),
    iso(now - 6 * DAY),
    campaign.id,
  );
  runJobsOnce(now);
  assert.equal(count(player.id, "campaign_idle"), 2);
});

removeTempDir(dir);
console.log(`\ntest-jobs: ${passed} passed`);
