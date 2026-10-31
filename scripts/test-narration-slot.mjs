// Issue 68: a player's reply to narration that is still streaming must land
// after that narration, for the table, for a reload and for the DM's next
// turn. The narration claims its seq when the reply arrives
// (src/lib/dm/narration-slot.ts) and finalize writes it there.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-narration-slot-"));
process.env.SQLITE_DB_PATH = path.join(dir, "test.sqlite");
process.env.DB_ENCRYPTION_KEY = randomBytes(32).toString("hex");
register("./lib/register-alias.mjs", import.meta.url);

const { createUser } = await import("../src/lib/db/users.ts");
const { createCampaign, allocateSeq } = await import("../src/lib/db/campaigns.ts");
const { createDmTurn, saveDmTurn } = await import("../src/lib/db/dm-turns.ts");
const { insertCampaignMessage, listRecentMessages } = await import("../src/lib/db/messages.ts");
const { narrationShown, claimNarrationSeq, takeNarrationSeq, takeNarrationSlot, tableNoteSeq } = await import("../src/lib/dm/narration-slot.ts");
const { queuedIntents } = await import("../src/lib/dm/intent-queue.ts");
const { removeTempDir } = await import("./lib/remove-temp-dir.mjs");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`ok: ${name}`);
}

const kara = createUser("kara", "x");
const campaign = createCampaign(kara.id, { title: "T", description: "", theme: "", maxPlayers: 4, startingLevel: 1, difficulty: "normal" });
const id = campaign.id;
const say = (seq, authorType, content) =>
  insertCampaignMessage({ campaignId: id, seq, authorType, userId: authorType === "player" ? kara.id : null, content });

test("nothing streaming: a message claims nothing", () => {
  assert.equal(claimNarrationSeq(id), null);
});

test("a reply mid-stream lands after the narration it answers", () => {
  const turn = createDmTurn(id, []);
  narrationShown(id, turn.id);
  const slot = claimNarrationSeq(id);
  assert.equal(typeof slot, "number");
  assert.equal(claimNarrationSeq(id), slot, "a second reply keeps the same slot");
  const reply = say(allocateSeq(id), "player", "Nice swing, Brom.");
  assert.ok(reply.seq > slot);
  // finalize: the narration goes into the slot it claimed.
  assert.equal(takeNarrationSeq(id, turn.id), slot);
  say(slot, "dm", "Brom sheathes his axe and grins.");
  const order = listRecentMessages(id, 10).map((message) => message.content);
  assert.deepEqual(order.slice(-2), ["Brom sheathes his axe and grins.", "Nice swing, Brom."]);
  // The reply is still waiting on the DM, not taken as answered.
  assert.deepEqual(queuedIntents(listRecentMessages(id, 10), []).map((intent) => intent.messageId), [reply.id]);
  assert.equal(takeNarrationSeq(id, turn.id), null, "taken once");
});

test("a narration nobody answered takes its seq at the end, as before", () => {
  const turn = createDmTurn(id, []);
  narrationShown(id, turn.id);
  assert.equal(takeNarrationSeq(id, turn.id), null);
});

test("a turn parked for dice still holds its slot", () => {
  const turn = createDmTurn(id, []);
  narrationShown(id, turn.id);
  turn.status = "awaiting_rolls";
  saveDmTurn(turn);
  const slot = claimNarrationSeq(id);
  assert.equal(typeof slot, "number");
  assert.equal(takeNarrationSeq(id, turn.id), slot);
});

test("a turn that ended without writing is never claimed", () => {
  const turn = createDmTurn(id, []);
  narrationShown(id, turn.id);
  turn.status = "failed";
  saveDmTurn(turn);
  assert.equal(claimNarrationSeq(id), null);
  assert.equal(takeNarrationSeq(id, turn.id), null, "the stale slot was dropped");
});

test("another turn's finalize does not take this one's slot", () => {
  const turn = createDmTurn(id, []);
  narrationShown(id, turn.id);
  const slot = claimNarrationSeq(id);
  assert.equal(takeNarrationSeq(id, "some-other-turn"), null);
  assert.equal(takeNarrationSeq(id, turn.id), slot);
});

// Issue 668: "Sir Hollis Stonebridge walked out on the party" sat above the
// attack and damage cards that made him leave. The note was posted the
// moment the tool ran; the roll cards ride on the narration written at the
// end. A note the running turn's own tools post now claims the slot first.
test("a table note posted while a turn runs lands below its narration", () => {
  const turn = createDmTurn(id, []);
  narrationShown(id, turn.id);
  const noteSeq = tableNoteSeq(id);
  const slot = takeNarrationSlot(id, turn.id);
  assert.equal(typeof slot.seq, "number", "the note made the narration claim its place");
  assert.ok(slot.seq < noteSeq, `narration ${slot.seq} sits above the note ${noteSeq}`);
  assert.equal(slot.person, false, "no person posted while the turn ran");
});

test("a person's message after a table note marks the slot as theirs too", () => {
  const turn = createDmTurn(id, []);
  narrationShown(id, turn.id);
  const first = tableNoteSeq(id);
  const claimed = claimNarrationSeq(id);
  const slot = takeNarrationSlot(id, turn.id);
  assert.equal(slot.seq, claimed, "one slot, claimed once");
  assert.ok(slot.seq < first);
  assert.equal(slot.person, true);
});

test("with no turn running a table note is just the next seq", () => {
  const before = allocateSeq(id);
  assert.equal(tableNoteSeq(id), before + 1);
  const turn = createDmTurn(id, []);
  narrationShown(id, turn.id);
  turn.status = "done";
  saveDmTurn(turn);
  const after = tableNoteSeq(id);
  assert.equal(takeNarrationSlot(id, turn.id).seq, null, "a finished turn's slot is not claimed");
  assert.ok(after > before + 1);
});

removeTempDir(dir);
console.log(`narration slot: ${passed} checks passed`);
