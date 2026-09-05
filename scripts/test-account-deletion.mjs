// Self-service account deletion: the request stamps a due date and signs
// the account out, the purge job erases it once the date passes (and not a
// minute before), keeping the account clears the stamps, and a zero grace
// period erases at once. Real encrypted throwaway database, test-jobs pattern.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";
import { removeTempDir } from "./lib/remove-temp-dir.mjs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-account-deletion-"));
process.env.SQLITE_DB_PATH = path.join(dir, "test.sqlite");
process.env.DB_ENCRYPTION_KEY = randomBytes(32).toString("hex");
// Upload cleanup looks under process.cwd()/public/uploads; point it at the
// temp dir so the test never touches the real folder.
const uploadsDir = path.join(dir, "public", "uploads");
fs.mkdirSync(uploadsDir, { recursive: true });
process.chdir(dir);

register("./lib/register-alias.mjs", import.meta.url);

const { getDatabase } = await import("../src/lib/db/core.ts");
const {
  createUser,
  getSessionUser,
  getUserById,
  getUserByUsername,
  insertSession,
  listUsersDueForPurge,
  setUserAvatar,
} = await import("../src/lib/db/users.ts");
const { createCampaign, joinByInviteCode } = await import("../src/lib/db/campaigns.ts");
const { saveGlobalConfig } = await import("../src/lib/db/app-settings.ts");
const {
  cancelAccountDeletion,
  purgeAccount,
  purgeDueAccounts,
  requestAccountDeletion,
} = await import("../src/lib/account-deletion.ts");
const { runJobsOnce } = await import("../src/lib/jobs.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`ok: ${name}`);
}

const DAY = 86_400_000;
const now = Date.now();
const iso = (ms) => new Date(ms).toISOString();
const db = getDatabase();

function count(sql, ...args) {
  return db.prepare(sql).get(...args).n;
}

// Alice runs a table Bob plays at; Bob runs his own table Alice never joined.
const alice = createUser("alice", "hash");
const bob = createUser("bob", "hash");
const table = (title) => ({
  title,
  description: "",
  theme: "",
  maxPlayers: 4,
  startingLevel: 1,
  difficulty: "normal",
});
const aliceTable = createCampaign(alice.id, table("Alice's table"));
joinByInviteCode(bob.id, aliceTable.inviteCode);
const bobTable = createCampaign(bob.id, table("Bob's table"));

// Bob's traces at Alice's table: a message, a roll table, an RSVP, a seat as
// party lead.
db.prepare(
  `INSERT INTO campaign_messages (id, campaign_id, seq, author_type, user_id, content, created_at)
   VALUES ('m1', ?, 1, 'player', ?, 'I open the door.', ?)`,
).run(aliceTable.id, bob.id, iso(now));
db.prepare(
  `INSERT INTO roll_tables (id, campaign_id, name, created_by_user_id, created_at, updated_at)
   VALUES ('rt1', ?, 'Loot', ?, ?, ?)`,
).run(aliceTable.id, bob.id, iso(now), iso(now));
db.prepare(
  `INSERT INTO scheduled_sessions (id, campaign_id, starts_at, created_by_user_id, created_at)
   VALUES ('s1', ?, ?, ?, ?)`,
).run(aliceTable.id, iso(now + DAY), alice.id, iso(now));
db.prepare(
  `INSERT INTO session_rsvps (session_id, user_id, response, responded_at) VALUES ('s1', ?, 'yes', ?)`,
).run(bob.id, iso(now));
db.prepare(`UPDATE campaigns SET party_lead_user_id = ? WHERE id = ?`).run(bob.id, aliceTable.id);

// Bob's avatar file, and a portrait file shared with a sheet Alice owns.
fs.writeFileSync(path.join(uploadsDir, "bob-avatar.png"), "png");
fs.writeFileSync(path.join(uploadsDir, "shared.png"), "png");
setUserAvatar(bob.id, { url: "/uploads/bob-avatar.png" });
db.prepare(`UPDATE character_sheets SET portrait_json = ? WHERE user_id = ?`).run(
  JSON.stringify({ url: "/uploads/shared.png" }),
  bob.id,
);
db.prepare(
  `INSERT INTO library_characters (id, user_id, name, race, class, sheet_json, portrait_json, created_at, updated_at)
   VALUES ('lc1', ?, 'Shared', 'elf', 'wizard', '{}', ?, ?, ?)`,
).run(alice.id, JSON.stringify({ url: "/uploads/shared.png" }), iso(now), iso(now));

insertSession("bob-token", bob.id, iso(now + 30 * DAY));
insertSession("bob-phone", bob.id, iso(now + 30 * DAY));

test("requesting deletion stamps the due date and signs out every device", () => {
  saveGlobalConfig({ accountDeletionGraceDays: 14 });
  const schedule = requestAccountDeletion(bob.id, now);
  assert.equal(schedule.purged, false);
  assert.equal(schedule.graceDays, 14);
  assert.equal(schedule.dueAt, iso(now + 14 * DAY));
  const user = getUserById(bob.id);
  assert.equal(user.deletionRequestedAt, iso(now));
  assert.equal(user.deletionDueAt, schedule.dueAt);
  assert.equal(getSessionUser("bob-token"), null);
  assert.equal(getSessionUser("bob-phone"), null);
  // The username stays taken until the purge: nobody can step into it.
  assert.ok(getUserByUsername("bob"));
});

test("the purge job leaves the account alone until the due date", () => {
  runJobsOnce(now + 13 * DAY);
  assert.ok(getUserById(bob.id));
  assert.deepEqual(listUsersDueForPurge(iso(now + 13 * DAY)), []);
  assert.deepEqual(listUsersDueForPurge(iso(now + 14 * DAY)), [bob.id]);
});

test("keeping the account clears the stamps and stops the purge", () => {
  assert.equal(cancelAccountDeletion(bob.id), true);
  const user = getUserById(bob.id);
  assert.equal(user.deletionRequestedAt, null);
  assert.equal(user.deletionDueAt, null);
  runJobsOnce(now + 30 * DAY);
  assert.ok(getUserById(bob.id));
  // Nothing pending: cancelling again is a no-op that says so.
  assert.equal(cancelAccountDeletion(bob.id), false);
});

test("once due, the job erases the account and everything it owned", () => {
  requestAccountDeletion(bob.id, now);
  assert.deepEqual(purgeDueAccounts(now + 14 * DAY), [bob.id]);
  assert.equal(getUserById(bob.id), null);
  assert.equal(getUserByUsername("bob"), null);
  // His own table went with him; Alice's table did not.
  assert.equal(count(`SELECT COUNT(*) AS n FROM campaigns WHERE id = ?`, bobTable.id), 0);
  assert.equal(count(`SELECT COUNT(*) AS n FROM campaigns WHERE id = ?`, aliceTable.id), 1);
  assert.equal(
    count(`SELECT COUNT(*) AS n FROM campaign_members WHERE user_id = ?`, bob.id),
    0,
  );
  assert.equal(
    count(`SELECT COUNT(*) AS n FROM character_sheets WHERE user_id = ?`, bob.id),
    0,
  );
  assert.equal(count(`SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?`, bob.id), 0);
});

test("the transcript keeps its words minus the author, tools pass to the owner", () => {
  const message = db.prepare(`SELECT user_id, content FROM campaign_messages WHERE id = 'm1'`).get();
  assert.equal(message.content, "I open the door.");
  assert.equal(message.user_id, null);
  const table = db.prepare(`SELECT created_by_user_id FROM roll_tables WHERE id = 'rt1'`).get();
  assert.equal(table.created_by_user_id, alice.id);
  assert.equal(count(`SELECT COUNT(*) AS n FROM session_rsvps WHERE user_id = ?`, bob.id), 0);
  const seat = db.prepare(`SELECT party_lead_user_id FROM campaigns WHERE id = ?`).get(aliceTable.id);
  assert.equal(seat.party_lead_user_id, null);
});

test("only pictures nothing else points at are removed from disk", () => {
  assert.equal(fs.existsSync(path.join(uploadsDir, "bob-avatar.png")), false);
  // Alice's library character still shows the shared portrait.
  assert.equal(fs.existsSync(path.join(uploadsDir, "shared.png")), true);
});

test("a zero-day grace period erases at the moment of the request", () => {
  saveGlobalConfig({ accountDeletionGraceDays: 0 });
  const carol = createUser("carol", "hash");
  const schedule = requestAccountDeletion(carol.id, now);
  assert.equal(schedule.purged, true);
  assert.equal(getUserById(carol.id), null);
});

test("purgeAccount erases an account with no deletion pending (the admin path)", () => {
  const dave = createUser("dave", "hash");
  createCampaign(dave.id, table("Dave's table"));
  purgeAccount(dave.id);
  assert.equal(getUserById(dave.id), null);
  assert.equal(count(`SELECT COUNT(*) AS n FROM campaigns WHERE owner_user_id = ?`, dave.id), 0);
  // Alice, who never asked for anything, is untouched throughout.
  assert.ok(getUserById(alice.id));
});

console.log(`\n${passed} account deletion checks passed.`);
process.chdir(os.tmpdir());
removeTempDir(dir);
