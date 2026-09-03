// Real-world scheduling and the notification inbox, against a throwaway
// encrypted database with the real modules (workshop-integration pattern).
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";
import { removeTempDir } from "./lib/remove-temp-dir.mjs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-schedule-"));
process.env.SQLITE_DB_PATH = path.join(dir, "test.sqlite");
process.env.DB_ENCRYPTION_KEY = randomBytes(32).toString("hex");

register("./lib/register-alias.mjs", import.meta.url);

const { createUser } = await import("../src/lib/db/users.ts");
const { createCampaign } = await import("../src/lib/db/campaigns.ts");
const {
  cancelScheduledSession,
  createScheduledSession,
  getScheduledSession,
  listScheduledSessions,
  sessionWhen,
  setRsvp,
  updateScheduledSession,
} = await import("../src/lib/db/scheduling.ts");
const { listNotifications, markNotificationsRead, notifyUsers, unreadCount } = await import(
  "../src/lib/db/notifications.ts"
);

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`ok: ${name}`);
}

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

const inAWeek = new Date(Date.now() + 7 * 86_400_000).toISOString();

let session;
test("a session is created and listed", () => {
  session = createScheduledSession(campaign.id, gm.id, {
    title: "The bridge",
    startsAt: inAWeek,
    durationMin: 180,
    note: "Bring snacks",
  });
  const listed = listScheduledSessions(campaign.id);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].title, "The bridge");
  assert.equal(listed[0].rsvps.length, 0);
});

test("RSVPs upsert per user", () => {
  setRsvp(session.id, player.id, "maybe");
  setRsvp(session.id, player.id, "yes");
  setRsvp(session.id, gm.id, "yes");
  const fresh = getScheduledSession(campaign.id, session.id);
  assert.equal(fresh.rsvps.length, 2);
  assert.equal(fresh.rsvps.find((entry) => entry.userId === player.id)?.response, "yes");
});

test("updates keep unspecified fields; cancelled sessions refuse updates", () => {
  const moved = updateScheduledSession(campaign.id, session.id, { durationMin: 240 });
  assert.equal(moved.title, "The bridge");
  assert.equal(moved.durationMin, 240);
  const cancelled = cancelScheduledSession(campaign.id, session.id);
  assert.ok(cancelled.cancelledAt);
  assert.equal(updateScheduledSession(campaign.id, session.id, { title: "nope" }), null);
});

test("sessions far in the past fall off the list", () => {
  createScheduledSession(campaign.id, gm.id, {
    title: "Ancient history",
    startsAt: new Date(Date.now() - 30 * 86_400_000).toISOString(),
    durationMin: 180,
    note: "",
  });
  const listed = listScheduledSessions(campaign.id);
  assert.ok(!listed.some((entry) => entry.title === "Ancient history"));
});

test("sessionWhen renders the wire time readably", () => {
  assert.equal(sessionWhen("2026-09-05T19:00:00.000Z"), "2026-09-05 19:00 UTC");
});

test("notifications land unread, are listed newest first, and mark read", () => {
  notifyUsers([player.id], { campaignId: campaign.id, kind: "session_scheduled", body: "first" });
  notifyUsers([player.id], { campaignId: campaign.id, kind: "session_updated", body: "second" });
  assert.equal(unreadCount(player.id), 2);
  assert.equal(unreadCount(gm.id), 0);
  const inbox = listNotifications(player.id);
  assert.equal(inbox[0].body, "second");
  markNotificationsRead(player.id, inbox[0].id);
  assert.equal(unreadCount(player.id), 1);
  markNotificationsRead(player.id);
  assert.equal(unreadCount(player.id), 0);
});

test("the inbox is capped per user", () => {
  for (let i = 0; i < 210; i += 1) {
    notifyUsers([gm.id], { kind: "session_updated", body: `note ${i}` });
  }
  assert.ok(listNotifications(gm.id, 200).length <= 200);
});

test("an empty recipient list is a no-op", () => {
  notifyUsers([], { kind: "session_scheduled", body: "nobody" });
  assert.equal(unreadCount(player.id), 0);
});

removeTempDir(dir);
console.log(`\ntest-scheduling: ${passed} passed`);
