// Reports, blocks and mutes: a player flags a passage and the report keeps
// the text as it read; a block hides and is symmetric for contact; a mute
// is a member flag the lead sets and the speaking routes read. Real
// encrypted throwaway database, same harness as test-account-deletion.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";
import { removeTempDir } from "./lib/remove-temp-dir.mjs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-moderation-"));
process.env.SQLITE_DB_PATH = path.join(dir, "test.sqlite");
process.env.DB_ENCRYPTION_KEY = randomBytes(32).toString("hex");
process.chdir(dir);

register("./lib/register-alias.mjs", import.meta.url);

const { createUser } = await import("../src/lib/db/users.ts");
const { createCampaign, joinByInviteCode, listMembers, getMember } = await import(
  "../src/lib/db/campaigns.ts"
);
const { allocateSeq } = await import("../src/lib/db/campaigns.ts");
const { insertCampaignMessage, updateMessageContent } = await import("../src/lib/db/messages.ts");
const { sendRequest } = await import("../src/lib/db/friends.ts");
const {
  blockUser,
  contactBlocked,
  countOpenReports,
  createReport,
  hasReported,
  isMemberMuted,
  listBlockedUserIds,
  listBlockedUsers,
  listReports,
  setMemberMuted,
  setReportStatus,
  unblockUser,
} = await import("../src/lib/db/moderation.ts");

try {
  const lead = createUser("lead", "hash");
  const player = createUser("player", "hash");
  const other = createUser("other", "hash");
  const admin = createUser("admin", "hash");

  const campaign = createCampaign(lead.id, {
    title: "Table",
    description: "",
    theme: "",
    maxPlayers: 4,
    startingLevel: 1,
    difficulty: "normal",
  });
  joinByInviteCode(player.id, campaign.inviteCode);
  joinByInviteCode(other.id, campaign.inviteCode);

  // ---- reports keep a copy of the text as reported ----------------------
  const dmMessage = insertCampaignMessage({
    campaignId: campaign.id,
    seq: allocateSeq(campaign.id),
    authorType: "dm",
    content: "The narration that crossed a line.",
  });
  const playerMessage = insertCampaignMessage({
    campaignId: campaign.id,
    seq: allocateSeq(campaign.id),
    authorType: "player",
    userId: other.id,
    content: "A rude thing to say at the table.",
  });

  const report = createReport({
    campaignId: campaign.id,
    reporterUserId: player.id,
    messageId: dmMessage.id,
    authorType: "dm",
    reason: "sexual",
    details: "This is not what the table asked for.",
    excerpt: dmMessage.content,
  });
  assert.equal(report.status, "open");
  assert.equal(report.campaignName, "Table");
  assert.equal(report.reporterUsername, "player");
  assert.equal(report.reportedUserId, null);
  assert.equal(report.authorType, "dm");
  assert.ok(hasReported(player.id, dmMessage.id));
  assert.ok(!hasReported(other.id, dmMessage.id));

  const playerReport = createReport({
    campaignId: campaign.id,
    reporterUserId: player.id,
    messageId: playerMessage.id,
    reportedUserId: other.id,
    authorType: "player",
    reason: "harassment",
    excerpt: playerMessage.content,
  });
  assert.equal(playerReport.reportedUsername, "other");

  // A later edit does not rewrite what was reported.
  updateMessageContent(dmMessage.id, "Something tamer.");
  assert.equal(listReports("open").find((entry) => entry.id === report.id).excerpt, dmMessage.content);
  assert.equal(countOpenReports(), 2);

  const resolved = setReportStatus(report.id, "resolved", admin.id);
  assert.equal(resolved.status, "resolved");
  assert.ok(resolved.resolvedAt);
  assert.equal(countOpenReports(), 1);
  assert.equal(listReports("open").length, 1);
  assert.equal(listReports("all").length, 2);
  assert.equal(setReportStatus(report.id, "open", admin.id).status, "open");
  assert.equal(countOpenReports(), 2);

  // ---- blocks: hidden for the blocker, contact refused both ways ----------
  assert.ok(blockUser(player.id, other.id));
  assert.ok(!blockUser(player.id, other.id), "a second block is a no-op");
  assert.ok(!blockUser(player.id, player.id), "cannot block yourself");
  assert.deepEqual(listBlockedUserIds(player.id), [other.id]);
  assert.deepEqual(listBlockedUserIds(other.id), []);
  assert.equal(listBlockedUsers(player.id)[0].username, "other");
  assert.ok(contactBlocked(player.id, other.id));
  assert.ok(contactBlocked(other.id, player.id), "the block reads both ways");
  assert.ok(!contactBlocked(player.id, lead.id));
  assert.equal(sendRequest(other.id, "player").outcome, "noop", "no friend request past a block");
  assert.equal(sendRequest(player.id, "other").outcome, "noop");
  assert.equal(sendRequest(player.id, "lead").outcome, "requested");
  assert.ok(unblockUser(player.id, other.id));
  assert.ok(!contactBlocked(player.id, other.id));
  assert.equal(sendRequest(other.id, "player").outcome, "requested");

  // ---- mutes travel with the member row -----------------------------------
  assert.ok(!isMemberMuted(campaign.id, other.id));
  assert.ok(setMemberMuted(campaign.id, other.id, true));
  assert.ok(isMemberMuted(campaign.id, other.id));
  assert.equal(getMember(campaign.id, other.id).muted, true);
  assert.equal(listMembers(campaign.id).find((member) => member.userId === player.id).muted, false);
  assert.ok(!setMemberMuted(campaign.id, admin.id, true), "not a member");
  assert.ok(setMemberMuted(campaign.id, other.id, false));
  assert.ok(!isMemberMuted(campaign.id, other.id));

  console.log("moderation: ok");
} finally {
  removeTempDir(dir);
}
