// The campaign stream reducer (src/app/campaigns/[campaignId]/
// useCampaignStream.ts): the fixes from the pre-1.0 plan, section B and E1.
// A narration flush must not produce a new state, an unknown ephemeral
// event must not either, and hidden-roll refetches must land.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { campaignReducer, INITIAL_CAMPAIGN_STATE } = await import(
  "../src/app/campaigns/[campaignId]/useCampaignStream.ts"
);

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`ok: ${name}`);
}

const event = (eventType, payload = {}, seq = null) => ({ type: "event", eventType, seq, payload });
const loaded = campaignReducer(INITIAL_CAMPAIGN_STATE, {
  type: "snapshot",
  payload: { lastSeq: 10, dmStatus: "idle" },
});

test("E1: a rolls refetch replaces the visible list", () => {
  const rolls = [{ id: "r1" }, { id: "r2" }];
  const next = campaignReducer(loaded, { type: "rolls", rolls });
  assert.equal(next.rolls, rolls);
  assert.equal(next.lastSeq, 10);
});

test("an unknown seq-less event returns the same state object", () => {
  assert.equal(campaignReducer(loaded, event("battle_map_updated")), loaded);
  assert.equal(campaignReducer(loaded, event("voice_speaking", { userId: "u1" })), loaded);
  assert.equal(campaignReducer(loaded, event("side_activity")), loaded);
});

test("an unknown persisted event still records its seq", () => {
  const next = campaignReducer(loaded, event("note_suggested", {}, 11));
  assert.notEqual(next, loaded);
  assert.equal(next.lastSeq, 11);
  assert.equal(campaignReducer(next, event("note_suggested", {}, 11)), next, "a duplicate seq is dropped");
});

test("dm_delta marks the turn narrating once, then leaves the state alone", () => {
  const narrating = campaignReducer(loaded, event("dm_delta", { text: "The " }));
  assert.equal(narrating.dmStatus, "narrating");
  assert.equal(narrating.lastSeq, 10);
  assert.equal("dmDraft" in narrating, false, "the draft text lives in the live store");
  const again = campaignReducer(narrating, event("dm_delta", { text: "door" }));
  assert.equal(again, narrating, "no new state per flush");
});

test("the DM's passage ends the turn; a player's does not", () => {
  const narrating = campaignReducer(loaded, event("dm_delta", { text: "x" }));
  const dm = { id: "m1", seq: 11, authorType: "dm", content: "x" };
  const afterDm = campaignReducer(narrating, event("message_added", { message: dm }, 11));
  assert.equal(afterDm.dmStatus, "idle");
  assert.deepEqual(afterDm.messages.map((m) => m.id), ["m1"]);

  const player = { id: "m2", seq: 12, authorType: "player", content: "y" };
  const afterPlayer = campaignReducer(narrating, event("message_added", { message: player }, 12));
  assert.equal(afterPlayer.dmStatus, "narrating");

  const halted = { id: "m3", seq: 13, authorType: "system", dmTurnId: "t1", content: "halted" };
  assert.equal(campaignReducer(narrating, event("message_added", { message: halted }, 13)).dmStatus, "idle");
});

test("issue 68: a narration a player answered mid-stream lands before the answer", () => {
  const narrating = campaignReducer(loaded, event("dm_delta", { text: "Brom sheathes his axe." }));
  // The reply arrives first, at seq 12; the narration claimed seq 11 for
  // itself when the reply came in, and is written (event seq 13) after it.
  const reply = { id: "p1", seq: 12, authorType: "player", content: "Nice swing, Brom." };
  const afterReply = campaignReducer(narrating, event("message_added", { message: reply }, 12));
  const narration = { id: "d1", seq: 11, authorType: "dm", content: "Brom sheathes his axe." };
  const after = campaignReducer(afterReply, event("message_added", { message: narration }, 13));
  assert.deepEqual(after.messages.map((m) => m.id), ["d1", "p1"]);
  assert.equal(after.dmStatus, "idle");
  assert.equal(after.lastSeq, 13);
});

test("messages already in seq order keep their array", () => {
  const one = campaignReducer(loaded, event("message_added", { message: { id: "a", seq: 11, authorType: "player", content: "a" } }, 11));
  const two = campaignReducer(one, event("message_added", { message: { id: "b", seq: 12, authorType: "player", content: "b" } }, 12));
  assert.deepEqual(two.messages.map((m) => m.id), ["a", "b"]);
});

test("E2: the snapshot carries the scene, the active sheet, the handout, the pause and the card", () => {
  const handout = { id: "h1", title: "A letter", style: "parchment", audience: null, at: 1 };
  const next = campaignReducer(INITIAL_CAMPAIGN_STATE, {
    type: "snapshot",
    payload: {
      lastSeq: 3,
      scene: { hour: 9 },
      activeSheetId: "s1",
      handout,
      safetyPause: { at: 2, reason: "x_card" },
      titleCard: { id: "t1", title: "Chapter 1", tone: "gold", at: 3 },
    },
  });
  assert.equal(next.loading, false);
  assert.deepEqual(next.scene, { hour: 9 });
  assert.equal(next.activeSheetId, "s1");
  assert.equal(next.handout, handout);
  assert.deepEqual(next.safetyPause, { at: 2, reason: "x_card" });
  assert.equal(next.titleCard.id, "t1");
});

// Issue 88: narration status has its own slot. It used to share mediaStatus
// with the picture for the same message, so a voice that failed turned a
// picture still being painted into "Illustration failed".
{
  const media = (payload) => event("media_status", { startedAt: "2026-10-05T00:00:00.000Z", ...payload });
  let state = campaignReducer(loaded, media({ kind: "image", targetId: "m1", state: "generating" }));
  state = campaignReducer(state, media({ kind: "tts", targetId: "m1", state: "failed", reason: "The speech server could not be reached at 127.0.0.1:8880." }));
  assert.equal(state.mediaStatus.m1.kind, "image");
  assert.equal(state.mediaStatus.m1.state, "generating");
  assert.deepEqual(state.narrationStatus.m1, {
    state: "failed",
    reason: "The speech server could not be reached at 127.0.0.1:8880.",
  });
  // The voice arriving clears its own failure and leaves the picture alone.
  state = campaignReducer(state, event("tts_ready", { messageId: "m1", url: "/generated-audio/c/m1.mp3" }, 11));
  assert.equal(state.narrationStatus.m1, undefined);
  assert.equal(state.mediaStatus.m1.state, "generating");
  passed += 1;
  console.log("ok: a narration failure is kept apart from the picture's status");
}

test("updating one character preserves the same player's other sheets", () => {
  const first = { id: "first", userId: "player", level: 8, currentHp: 59 };
  const second = { id: "second", userId: "player", level: 8, currentHp: 67 };
  const other = { id: "other", userId: "other", level: 8 };
  const state = { ...loaded, sheets: [first, second, other], activeSheetId: "second" };
  const updated = { ...first, currentHp: 58 };
  const next = campaignReducer(state, event("sheet_updated", { sheet: updated }, 11));
  assert.deepEqual(next.sheets, [updated, second, other]);
  assert.equal(next.activeSheetId, "second");
  const deleted = campaignReducer(next, event("sheet_deleted", { sheetId: "first" }, 12));
  assert.deepEqual(deleted.sheets, [second, other]);
  const replacement = { ...first, id: "replacement" };
  const replaced = campaignReducer(deleted, event("sheet_updated", { sheet: replacement }, 13));
  assert.deepEqual(replaced.sheets.map((sheet) => sheet.id), ["second", "other", "replacement"]);
});

test("selection events update the named member without changing another player's selection", () => {
  const state = { ...loaded, me: { id: "player-a" }, activeSheetId: "a1", members: [
    { userId: "player-a", activeCharacterId: "a1" }, { userId: "player-b", activeCharacterId: "b1" },
  ] };
  const other = campaignReducer(state, event("roster_updated", { userId: "player-b", activeSheetId: "b2" }));
  assert.equal(other.activeSheetId, "a1");
  assert.equal(other.members[1].activeCharacterId, "b2");
  const own = campaignReducer(other, event("roster_updated", { userId: "player-a", activeSheetId: "a2" }));
  assert.equal(own.activeSheetId, "a2");
  assert.equal(own.members[0].activeCharacterId, "a2");
  const reconnect = campaignReducer(own, { type: "snapshot", payload: { members: own.members, sheets: own.sheets, activeSheetId: own.activeSheetId, lastSeq: own.lastSeq } });
  assert.equal(reconnect.activeSheetId, "a2");
});
console.log(`\n${passed} campaign reducer tests passed.`);
