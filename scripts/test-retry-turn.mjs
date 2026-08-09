// Retrying a halted DM turn: when it is safe, where the turn re-enters the
// bounded call loop, and repairing a conversation that stopped mid tool loop.
import assert from "node:assert/strict";
import {
  assistantTextOf,
  checkRetryEligible,
  danglingToolCallIds,
  retryCallIndex,
  rewindHaltedCall,
} from "../src/lib/dm/retry-turn-logic.ts";

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

const failedTurn = { id: "t1", campaignId: "c1", status: "failed", callIndex: 2 };
function eligibility(overrides = {}) {
  return checkRetryEligible({
    campaignId: "c1",
    campaignActive: true,
    turn: failedTurn,
    latestTurnId: "t1",
    openPendingRollCount: 0,
    ...overrides,
  });
}

test("a failed turn that is still the latest one may be retried", () => {
  assert.deepEqual(eligibility(), { ok: true });
});

test("an unknown turn is a 404", () => {
  const result = eligibility({ turn: null });
  assert.equal(result.ok, false);
  assert.equal(result.status, 404);
});

test("a turn from another campaign is a 404, not someone else's retry", () => {
  const result = eligibility({ turn: { ...failedTurn, campaignId: "c2" } });
  assert.equal(result.ok, false);
  assert.equal(result.status, 404);
});

test("an inactive campaign refuses", () => {
  const result = eligibility({ campaignActive: false });
  assert.equal(result.ok, false);
  assert.equal(result.status, 409);
});

test("a turn that already succeeded is never retried", () => {
  const result = eligibility({ turn: { ...failedTurn, status: "done" } });
  assert.equal(result.ok, false);
  assert.equal(result.status, 409);
  assert.match(result.error, /already finished/);
});

test("a running turn refuses, which is also the two-players-at-once case", () => {
  const result = eligibility({ turn: { ...failedTurn, status: "running" } });
  assert.equal(result.ok, false);
  assert.match(result.error, /already working/);
});

test("a parked turn points at the dice instead", () => {
  const result = eligibility({ turn: { ...failedTurn, status: "awaiting_rolls" } });
  assert.equal(result.ok, false);
  assert.match(result.error, /waiting on dice/);
});

test("a failed turn with dice still out points at the dice too", () => {
  const result = eligibility({ openPendingRollCount: 1 });
  assert.equal(result.ok, false);
  assert.match(result.error, /waiting on dice/);
});

test("a turn the story moved past refuses", () => {
  const result = eligibility({ latestTurnId: "t2" });
  assert.equal(result.ok, false);
  assert.equal(result.status, 409);
  assert.match(result.error, /moved on/);
});

test("no turns recorded at all still allows the retry", () => {
  // Defensive: latestTurnId is null only if the turn row vanished mid-request.
  assert.deepEqual(eligibility({ latestTurnId: null }), { ok: true });
});

test("call index resumes where the turn stopped", () => {
  assert.equal(retryCallIndex(0, 4), 0);
  assert.equal(retryCallIndex(2, 4), 2);
});

test("an exhausted budget resumes at the forced-narration call", () => {
  assert.equal(retryCallIndex(4, 4), 3);
  assert.equal(retryCallIndex(9, 4), 3);
});

test("nonsense call indexes clamp instead of looping forever", () => {
  assert.equal(retryCallIndex(-1, 4), 0);
  assert.equal(retryCallIndex(Number.NaN, 4), 0);
  assert.equal(retryCallIndex(2.7, 4), 2);
  assert.equal(retryCallIndex(3, 1), 0);
});

test("a fully answered conversation has nothing dangling", () => {
  const dangling = danglingToolCallIds([
    { role: "system", content: "rules" },
    { role: "user", content: "I open the door." },
    {
      role: "assistant",
      content: "",
      tool_calls: [{ id: "call_1" }, { id: "call_2" }],
    },
    { role: "tool", tool_call_id: "call_1", content: "{}" },
    { role: "tool", tool_call_id: "call_2", content: "{}" },
  ]);
  assert.deepEqual(dangling, []);
});

test("a turn that threw partway leaves its unanswered calls, in order", () => {
  const dangling = danglingToolCallIds([
    {
      role: "assistant",
      content: "",
      tool_calls: [{ id: "call_1" }, { id: "call_2" }, { id: "call_3" }],
    },
    { role: "tool", tool_call_id: "call_2", content: "{}" },
  ]);
  assert.deepEqual(dangling, ["call_1", "call_3"]);
});

test("tool calls without ids are invisible to the repair", () => {
  const dangling = danglingToolCallIds([
    { role: "assistant", content: "", tool_calls: [{ function: { name: "request_roll" } }] },
  ]);
  assert.deepEqual(dangling, []);
});

test("an id asked for twice is only repaired once", () => {
  const dangling = danglingToolCallIds([
    { role: "assistant", content: "", tool_calls: [{ id: "call_1" }] },
    { role: "assistant", content: "", tool_calls: [{ id: "call_1" }] },
  ]);
  assert.deepEqual(dangling, ["call_1"]);
});

test("malformed conversations do not throw", () => {
  assert.deepEqual(danglingToolCallIds([]), []);
  assert.deepEqual(danglingToolCallIds([null, undefined]), []);
  assert.deepEqual(
    danglingToolCallIds([{ role: "assistant", content: "", tool_calls: "not an array" }]),
    [],
  );
});

test("narration the conversation never echoed is dropped, with its call", () => {
  // The crash landed after the model wrote a paragraph and before turn.ts
  // echoed that call, so the retried model cannot see the paragraph.
  const rewind = rewindHaltedCall({
    narrationParts: ["The door groans open on a cold stairwell."],
    callIndex: 1,
    assistantText: "",
  });
  assert.equal(rewind.rewound, true);
  assert.deepEqual(rewind.narrationParts, []);
  assert.equal(rewind.callIndex, 0);
});

test("narration the conversation does echo is kept", () => {
  const rewind = rewindHaltedCall({
    narrationParts: ["Torches gutter in the draft."],
    callIndex: 2,
    assistantText: "  Torches gutter in the draft.\n\nI will ask for a roll.  ",
  });
  assert.equal(rewind.rewound, false);
  assert.deepEqual(rewind.narrationParts, ["Torches gutter in the draft."]);
  assert.equal(rewind.callIndex, 2);
});

test("only the trailing part is ever in question", () => {
  const rewind = rewindHaltedCall({
    narrationParts: ["Echoed beat.", "Lost beat."],
    callIndex: 3,
    assistantText: "Echoed beat.",
  });
  assert.deepEqual(rewind.narrationParts, ["Echoed beat."]);
  assert.equal(rewind.callIndex, 2);
});

test("a turn that never narrated rewinds nothing", () => {
  const rewind = rewindHaltedCall({ narrationParts: [], callIndex: 1, assistantText: "" });
  assert.equal(rewind.rewound, false);
  assert.equal(rewind.callIndex, 1);
});

test("the call index never goes below zero", () => {
  const rewind = rewindHaltedCall({ narrationParts: ["x"], callIndex: 0, assistantText: "" });
  assert.equal(rewind.callIndex, 0);
});

test("assistant text collects only assistant prose", () => {
  const text = assistantTextOf([
    { role: "system", content: "rules" },
    { role: "assistant", content: "First." },
    { role: "tool", tool_call_id: "call_1", content: "{}" },
    { role: "assistant", content: "Second." },
    { role: "assistant", content: [{ type: "image_url" }] },
  ]);
  assert.equal(text, "First.\nSecond.");
});

console.log(`${passed} retry turn tests passed`);
