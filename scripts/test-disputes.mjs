// Disputed rulings (src/lib/dm/dispute-logic.ts, src/lib/db/disputes.ts):
// who may raise one, how a vote settles, what the transcript says, and the
// record on a real throwaway database.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";
import { removeTempDir } from "./lib/remove-temp-dir.mjs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-disputes-"));
process.env.SQLITE_DB_PATH = path.join(dir, "test.sqlite");
process.env.DB_ENCRYPTION_KEY = randomBytes(32).toString("hex");

register("./lib/register-alias.mjs", import.meta.url);

const { disputeRefusal, disputeTranscriptLine, tallyEarly, tallyVotes } = await import("../src/lib/dm/dispute-logic.ts");
const { castVote, getDispute, insertDispute, listOpenDisputes, openDisputeForMessage, openVote, publicDispute, settleDispute } =
  await import("../src/lib/db/disputes.ts");
const { createUser } = await import("../src/lib/db/users.ts");
const { allocateSeq, createCampaign } = await import("../src/lib/db/campaigns.ts");
const { audienceOf } = await import("../src/lib/event-audience.ts");

let failed = 0;
function test(name, run) {
  try {
    run();
    console.log(`ok - ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`not ok - ${name}`);
    console.log(error);
  }
}

test("only a narrated passage at an AI table can be disputed, and only once at a time", () => {
  const dm = { authorType: "dm" };
  assert.equal(disputeRefusal({ narratorIsAi: true, message: dm, raiserSteersStory: false, alreadyOpen: false }), null);
  assert.match(disputeRefusal({ narratorIsAi: false, message: dm, raiserSteersStory: false, alreadyOpen: false }), /A person runs this table/);
  assert.match(disputeRefusal({ narratorIsAi: true, message: null, raiserSteersStory: false, alreadyOpen: false }), /not in the transcript/);
  assert.match(disputeRefusal({ narratorIsAi: true, message: { authorType: "player" }, raiserSteersStory: false, alreadyOpen: false }), /Only a passage the Dungeon Master/);
  assert.match(disputeRefusal({ narratorIsAi: true, message: dm, raiserSteersStory: true, alreadyOpen: false }), /You steer this story/);
  assert.match(disputeRefusal({ narratorIsAi: true, message: dm, raiserSteersStory: false, alreadyOpen: true }), /already under dispute/);
});

test("a vote settles on a strict majority, or when everyone has spoken, and a tie upholds", () => {
  const four = ["a", "b", "c", "d"];
  assert.equal(tallyVotes({}, four).outcome, null);
  assert.deepEqual(tallyVotes({ a: "overrule" }, four).pending, ["b", "c", "d"]);
  assert.equal(tallyVotes({ a: "overrule", b: "overrule" }, four).outcome, null, "two of four is not a majority");
  assert.equal(tallyVotes({ a: "overrule", b: "overrule", c: "overrule" }, four).outcome, "overruled");
  assert.equal(tallyVotes({ a: "uphold", b: "uphold", c: "uphold" }, four).outcome, "upheld");
  assert.equal(tallyVotes({ a: "overrule", b: "overrule", c: "uphold", d: "uphold" }, four).outcome, "upheld", "a tie at the end upholds");
  assert.equal(tallyVotes({ a: "overrule", b: "uphold", c: "overrule" }, ["a", "b", "c"]).outcome, "overruled");
  assert.equal(tallyVotes({}, []).outcome, "upheld", "nobody to vote: the ruling stands");
  // Counting early: whoever leads, a tie upholds.
  assert.equal(tallyEarly({ a: "overrule", b: "overrule", c: "uphold" }, four), "overruled");
  assert.equal(tallyEarly({ a: "overrule", b: "uphold" }, four), "upheld");
  assert.equal(tallyEarly({}, four), "upheld");
  // A vote from someone off the roll does not count.
  assert.equal(tallyVotes({ zed: "overrule", a: "uphold", b: "uphold", c: "uphold" }, four).outcome, "upheld");
});

test("the transcript line says who objected, how it was settled, and what the narrator does next", () => {
  assert.equal(
    disputeTranscriptLine({ status: "upheld", raisedBy: "Kara", reason: "the goblin hit on a 7", byVote: false }),
    'Kara disputed the last ruling: "the goblin hit on a 7". The steerer ruled: the ruling stands as narrated.',
  );
  assert.match(disputeTranscriptLine({ status: "overruled", raisedBy: "Kara", reason: "", byVote: true }), /^Kara disputed the last ruling\. The table voted: the ruling is overruled\. Treat it as never having happened/);
  assert.equal(disputeTranscriptLine({ status: "withdrawn", raisedBy: "Kara", reason: "x", byVote: false }), "Kara withdrew their dispute of the last ruling.");
});

test("the record: raise, open a vote on a fixed roll, cast, settle, and the two events are declared", () => {
  const owner = createUser("Steerer", "x");
  const campaign = createCampaign(owner.id, { title: "T", description: "", theme: "", maxPlayers: 4, startingLevel: 1, difficulty: "normal", gameSettings: { dmMode: "steered" } });
  assert.equal(campaign.dmUserId, owner.id, "the creator takes the steering seat");
  const dispute = insertDispute({ campaignId: campaign.id, messageId: "msg-1", raisedByUserId: "kara", reason: "the goblin hit on a 7", seq: allocateSeq(campaign.id) });
  assert.equal(dispute.status, "open");
  assert.equal(openDisputeForMessage(campaign.id, "msg-1")?.id, dispute.id);
  assert.equal(openDisputeForMessage(campaign.id, "msg-2"), null);
  assert.equal(listOpenDisputes(campaign.id).length, 1);
  assert.equal(castVote(dispute.id, "kara", "overrule"), null, "no vote before one is opened");
  const voting = openVote(dispute.id, ["kara", "brom", "vee"]);
  assert.equal(voting.status, "voting");
  assert.deepEqual(voting.voterIds, ["kara", "brom", "vee"]);
  assert.equal(castVote(dispute.id, "stranger", "overrule"), null, "off the roll");
  assert.equal(castVote(dispute.id, "kara", "overrule").votes.kara, "overrule");
  const after = castVote(dispute.id, "brom", "overrule");
  assert.equal(tallyVotes(after.votes, after.voterIds).outcome, "overruled");
  const settled = settleDispute(dispute.id, "overruled", null);
  assert.equal(settled.status, "overruled");
  assert.equal(settleDispute(dispute.id, "upheld", null), null, "settled once");
  assert.equal(listOpenDisputes(campaign.id).length, 0);
  assert.equal(getDispute(dispute.id).decidedAt !== null, true);
  const shown = publicDispute(settled);
  assert.deepEqual(Object.keys(shown).sort(), ["createdAt", "decidedByUserId", "id", "messageId", "raisedByUserId", "reason", "status", "voterIds", "votes"]);
  assert.equal(audienceOf("ruling_disputed")?.kind, "table");
  assert.equal(audienceOf("ruling_resolved")?.kind, "table");
});

removeTempDir(dir);
if (failed) {
  process.exit(1);
}
console.log("\ndispute checks passed");
