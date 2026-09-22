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

console.log(`\n${passed} campaign reducer tests passed.`);
