// Per-server friendships, against a throwaway encrypted database with the
// real modules (scheduling test pattern). The no-enumeration guarantee is
// asserted at this layer as "a miss changes nothing"; the uniform
// "Request sent." reply is the API route's half of it.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-friends-"));
process.env.SQLITE_DB_PATH = path.join(dir, "test.sqlite");
process.env.DB_ENCRYPTION_KEY = randomBytes(32).toString("hex");

register("./lib/register-alias.mjs", import.meta.url);

const { createCompanionUser, createUser, setUserAvatar } = await import(
  "../src/lib/db/users.ts"
);
const { purgeAccount } = await import("../src/lib/account-deletion.ts");
const { createCampaign, getCampaignForUser, isCampaignMember } = await import(
  "../src/lib/db/campaigns.ts"
);
const {
  acceptRequest,
  areFriends,
  declineOrRemove,
  listFriends,
  listPendingIncoming,
  listPendingOutgoing,
  sendRequest,
} = await import("../src/lib/db/friends.ts");
const { listNotifications, notifyUsers } = await import("../src/lib/db/notifications.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`ok: ${name}`);
}

const alice = createUser("alice", "x");
const bob = createUser("bob", "x");
const cara = createUser("cara", "x");
setUserAvatar(bob.id, { url: "/uploads/bob.png" });

test("a request lands as pending on both sides", () => {
  const result = sendRequest(alice.id, "bob");
  assert.equal(result.outcome, "requested");
  assert.equal(result.targetUserId, bob.id);
  assert.equal(listPendingOutgoing(alice.id)[0]?.username, "bob");
  assert.equal(listPendingIncoming(bob.id)[0]?.username, "alice");
  assert.equal(areFriends(alice.id, bob.id), false);
});

test("misses change nothing: unknown name, self, companion, duplicate", () => {
  assert.equal(sendRequest(alice.id, "nobody-here").outcome, "noop");
  assert.equal(sendRequest(alice.id, "alice").outcome, "noop");
  const companion = createCompanionUser("Faithful Hound");
  assert.equal(sendRequest(alice.id, companion.username).outcome, "noop");
  assert.equal(sendRequest(alice.id, "bob").outcome, "noop");
  assert.equal(listPendingOutgoing(alice.id).length, 1);
  assert.equal(listPendingIncoming(bob.id).length, 1);
});

test("accepting makes the friendship mutual and clears the pending lists", () => {
  assert.equal(acceptRequest(bob.id, alice.id), true);
  assert.equal(areFriends(alice.id, bob.id), true);
  assert.equal(areFriends(bob.id, alice.id), true);
  assert.equal(listPendingIncoming(bob.id).length, 0);
  assert.equal(listPendingOutgoing(alice.id).length, 0);
  const fromAlice = listFriends(alice.id);
  assert.equal(fromAlice.length, 1);
  assert.equal(fromAlice[0].username, "bob");
  assert.equal(fromAlice[0].avatar?.url, "/uploads/bob.png");
  assert.equal(listFriends(bob.id)[0]?.username, "alice");
});

test("accepting without a pending request does nothing", () => {
  assert.equal(acceptRequest(cara.id, alice.id), false);
  assert.equal(areFriends(cara.id, alice.id), false);
});

test("declining removes the request without making friends", () => {
  sendRequest(cara.id, "alice");
  assert.equal(listPendingIncoming(alice.id).length, 1);
  assert.equal(declineOrRemove(alice.id, cara.id), true);
  assert.equal(listPendingIncoming(alice.id).length, 0);
  assert.equal(areFriends(alice.id, cara.id), false);
});

test("asking back completes the handshake instead of stacking a second row", () => {
  sendRequest(cara.id, "alice");
  const result = sendRequest(alice.id, "cara");
  assert.equal(result.outcome, "accepted");
  assert.equal(result.targetUserId, cara.id);
  assert.equal(areFriends(alice.id, cara.id), true);
  assert.equal(listPendingIncoming(alice.id).length, 0);
});

test("unfriending works from either side of the stored row", () => {
  // cara holds the user_id column (she asked); alice removes anyway.
  assert.equal(declineOrRemove(alice.id, cara.id), true);
  assert.equal(areFriends(alice.id, cara.id), false);
  assert.equal(declineOrRemove(alice.id, cara.id), false);
});

test("the campaign membership gate the invite route relies on holds", () => {
  const campaign = createCampaign(alice.id, {
    title: "Test Table",
    description: "",
    theme: "",
    maxPlayers: 4,
    startingLevel: 1,
    difficulty: "normal",
  });
  assert.equal(isCampaignMember(campaign.id, alice.id), true);
  assert.equal(isCampaignMember(campaign.id, bob.id), false);
  assert.equal(getCampaignForUser(campaign.id, bob.id), null);
  assert.ok(getCampaignForUser(campaign.id, alice.id)?.inviteCode);
});

test("an invite notification carries the campaign pointer and the code", () => {
  const campaign = createCampaign(alice.id, {
    title: "Second Table",
    description: "",
    theme: "",
    maxPlayers: 4,
    startingLevel: 1,
    difficulty: "normal",
  });
  notifyUsers([bob.id], {
    campaignId: campaign.id,
    kind: "friend_invite",
    body: `alice invited you to "${campaign.title}". Join with room code ${campaign.inviteCode}.`,
  });
  const inbox = listNotifications(bob.id);
  assert.equal(inbox[0].kind, "friend_invite");
  assert.equal(inbox[0].campaignId, campaign.id);
  assert.ok(inbox[0].body.includes(campaign.inviteCode));
});

test("deleting a user cascades their friendship rows away", () => {
  sendRequest(alice.id, "bob");
  assert.equal(listFriends(alice.id).some((friend) => friend.userId === bob.id), true);
  purgeAccount(bob.id);
  assert.equal(listFriends(alice.id).length, 0);
  assert.equal(listPendingIncoming(alice.id).length, 0);
});

console.log(`${passed} friends tests passed`);
