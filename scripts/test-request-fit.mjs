// The whole-request fit (docs/agent-context-efficiency-audit-2026-10-17.md
// F01, F04): every request is sized with its tools and framing against the
// window the model really has, history gives way oldest first, the newest
// line is clipped rather than dropped, a turn's own calls are never dropped,
// results before the latest call shrink without losing their numbers, and a
// request that cannot fit is refused with the numbers that say why. Also the
// token calibration that scales the estimate by what backends report, and
// the utility model's circuit breaker.
import assert from "node:assert/strict";
import {
  fitRequest,
  messageTokens,
  requestTokens,
  shrinkToolResult,
  toolDefinitionTokens,
  REQUEST_FRAMING_TOKENS,
} from "../src/lib/dm/request-fit.ts";
import { calibrationFor, noteReportedInput, resetCalibration, MAX_CALIBRATION } from "../src/lib/dm/token-calibration.ts";
import { afterFailure, afterSuccess, breakerOpen, CLOSED, FIRST_PAUSE_MS, MAX_PAUSE_MS } from "../src/lib/dm/utility-breaker-logic.ts";

let passed = 0;
const check = (name, fn) => {
  try {
    fn();
  } catch (error) {
    console.error(`FAILED: ${name}`);
    throw error;
  }
  passed += 1;
};

const words = (tokens) => "word ".repeat(Math.ceil((tokens * 4) / 5)).trim();
const tool = (name, size) => ({ type: "function", function: { name, description: words(size), parameters: { type: "object", properties: {} } } });

check("a request counts its messages, its tools and the template's framing", () => {
  const messages = [
    { role: "system", content: words(100) },
    { role: "user", content: words(50) },
  ];
  const tools = [tool("a", 200)];
  assert.equal(requestTokens(messages, tools), messageTokens(messages[0]) + messageTokens(messages[1]) + toolDefinitionTokens(tools) + REQUEST_FRAMING_TOKENS);
  assert.ok(toolDefinitionTokens(tools) >= 200);
  // An assistant's tool calls are counted too.
  const withCalls = { role: "assistant", content: "", tool_calls: [{ id: "1", type: "function", function: { name: "x", arguments: JSON.stringify({ long: words(80) }) } }] };
  assert.ok(messageTokens(withCalls) > 80);
});

check("a request that fits goes whole, with the reply capped to what the window leaves", () => {
  const messages = [
    { role: "system", content: words(1_000) },
    { role: "user", content: words(100) },
  ];
  const fit = fitRequest(messages, { windowTokens: 4_000, minOutputTokens: 512, maxOutputTokens: 16_384 });
  assert.equal(fit.ok, true);
  assert.equal(fit.dropped, 0);
  assert.equal(fit.clipped, 0);
  assert.equal(fit.outputTokens, 4_000 - fit.promptTokens, "the cap is the room left, not the backend's default");
  const small = fitRequest(messages, { windowTokens: 4_000, minOutputTokens: 512, maxOutputTokens: 600 });
  assert.equal(small.outputTokens, 600, "a smaller task cap wins");
});

check("history gives way oldest first and the newest line is clipped, both ends kept", () => {
  const history = Array.from({ length: 10 }, (_, index) => ({ role: index % 2 ? "assistant" : "user", content: `Line ${index}. ${words(400)}` }));
  const newest = { role: "user", content: `I ask the guard: ${words(3_000)} and who holds the key?` };
  const messages = [{ role: "system", content: words(1_000) }, ...history, newest, { role: "user", content: "[Director] steer" }];
  const end = 1 + history.length + 1;
  const fit = fitRequest(messages, {
    windowTokens: 3_000,
    minOutputTokens: 512,
    maxOutputTokens: 4_096,
    history: { start: 1, end },
    protectFrom: messages.length,
  });
  assert.equal(fit.ok, true, fit.reason);
  assert.equal(fit.dropped, history.length, "every older line went");
  assert.equal(fit.clipped, 1, "the newest was cut");
  assert.equal(fit.messages.length, 3, "system, the clipped newest, the director's line");
  assert.equal(fit.messages[0].content, messages[0].content, "the system prompt is never cut");
  assert.match(fit.messages[1].content, /^I ask the guard/);
  assert.match(fit.messages[1].content, /who holds the key\?$/);
  assert.match(fit.messages[1].content, /left out to fit the model's window/);
  assert.equal(fit.messages[2].content, "[Director] steer", "what follows the transcript is never dropped");
  assert.ok(fit.promptTokens + 512 <= 3_000);
});

check("a turn's own calls are never dropped; older results shrink, the latest stays whole", () => {
  const longResult = JSON.stringify({ ok: true, total: 17, hit: true, damage: 9, note: words(900), log: Array.from({ length: 40 }, (_, i) => `entry ${i}`) });
  const latest = JSON.stringify({ ok: true, total: 4, note: words(300) });
  const messages = [
    { role: "system", content: words(800) },
    { role: "user", content: words(200) },
    { role: "assistant", content: "", tool_calls: [{ id: "a", type: "function", function: { name: "pc_attack", arguments: "{}" } }] },
    { role: "tool", tool_call_id: "a", content: longResult },
    { role: "assistant", content: "", tool_calls: [{ id: "b", type: "function", function: { name: "request_roll", arguments: "{}" } }] },
    { role: "tool", tool_call_id: "b", content: latest },
  ];
  const fit = fitRequest(messages, {
    windowTokens: requestTokens(messages) - 400 + 512,
    minOutputTokens: 512,
    maxOutputTokens: 2_048,
    history: { start: 1, end: 2 },
    protectFrom: 2,
  });
  assert.equal(fit.ok, true, fit.reason);
  assert.equal(fit.messages.length, messages.length, "no call or result was dropped");
  const shrunk = JSON.parse(fit.messages[3].content);
  assert.equal(shrunk.total, 17, "the numbers survive");
  assert.equal(shrunk.hit, true);
  assert.equal(shrunk.damage, 9);
  assert.ok(shrunk.note.length < 500, "the prose was cut");
  assert.ok(shrunk.log.length <= 13, "the list was cut");
  assert.equal(fit.messages[5].content, latest, "the latest result is whole");
  for (const [index, message] of fit.messages.entries()) {
    if (message.role === "tool") {
      assert.equal(fit.messages[index - 1].role, "assistant", "every result still follows its call");
    }
  }
});

check("a request that cannot fit is refused with the numbers", () => {
  const messages = [{ role: "system", content: words(6_000) }, { role: "user", content: "hello" }];
  const tools = [tool("big", 4_000)];
  const fit = fitRequest(messages, { windowTokens: 8_192, tools, minOutputTokens: 1_024, maxOutputTokens: 4_096, history: { start: 1, end: 2 }, protectFrom: 2 });
  assert.equal(fit.ok, false);
  assert.ok(fit.needTokens > 8_192);
  assert.match(fit.reason, /needs about [\d,]+ tokens/);
  assert.match(fit.reason, /of tool definitions/);
  assert.match(fit.reason, /window is 8,192/);
  assert.equal(fit.messages[0].content, messages[0].content, "the system prompt was not cut to make it fit");
});

check("utility work with one big input is clipped at its middle", () => {
  const messages = [
    { role: "system", content: "Summarize." },
    { role: "user", content: `BEGIN ${words(10_000)} END` },
  ];
  const fit = fitRequest(messages, { windowTokens: 4_096, minOutputTokens: 512, maxOutputTokens: 1_024 });
  assert.equal(fit.ok, true, fit.reason);
  assert.equal(fit.clipped >= 1, true);
  assert.match(fit.messages[1].content, /^BEGIN /);
  assert.match(fit.messages[1].content, / END$/);
  assert.ok(fit.promptTokens + 512 <= 4_096);
});

check("calibration scales the estimate up when a backend counts more", () => {
  const messages = [{ role: "system", content: words(2_000) }, { role: "user", content: "x" }];
  const plain = fitRequest(messages, { windowTokens: 3_000, minOutputTokens: 512, maxOutputTokens: 1_024 });
  assert.equal(plain.ok, true);
  const scaled = fitRequest(messages, { windowTokens: 3_000, minOutputTokens: 512, maxOutputTokens: 1_024, calibration: 1.4 });
  assert.equal(scaled.ok, false, "the same request no longer fits once the estimate is known to run low");
});

check("the learned ratio rises with reports, is capped, ignores cached reports, and never lowers below 1", () => {
  resetCalibration();
  assert.equal(calibrationFor("k"), 1);
  noteReportedInput("k", 1_000, 1_000);
  assert.equal(calibrationFor("k"), 1);
  for (let i = 0; i < 20; i += 1) noteReportedInput("k", 1_000, 1_500);
  assert.ok(calibrationFor("k") > 1.4 && calibrationFor("k") <= 1.5);
  for (let i = 0; i < 20; i += 1) noteReportedInput("k", 1_000, 5_000);
  assert.equal(calibrationFor("k"), MAX_CALIBRATION, "capped");
  noteReportedInput("k", 1_000, 100);
  assert.equal(calibrationFor("k"), MAX_CALIBRATION, "a cached report says nothing of the tokenizer");
  resetCalibration();
  for (let i = 0; i < 10; i += 1) noteReportedInput("o", 1_000, 1_300);
  const before = calibrationFor("o");
  noteReportedInput("o", 1_000, 900, { partialReport: true });
  assert.equal(calibrationFor("o"), before, "a backend that counts only part of the prompt never lowers it");
  for (let i = 0; i < 40; i += 1) noteReportedInput("p", 1_000, 800);
  assert.equal(calibrationFor("p"), 1, "a tokenizer that does better than four characters leaves the estimate alone");
  resetCalibration();
});

check("shrinking keeps JSON readable and numbers exact", () => {
  const result = shrinkToolResult(JSON.stringify({ a: 1, b: "x".repeat(5_000), c: [1, 2, 3] }));
  const parsed = JSON.parse(result);
  assert.equal(parsed.a, 1);
  assert.deepEqual(parsed.c, [1, 2, 3]);
  assert.ok(parsed.b.length <= 400);
  assert.ok(shrinkToolResult("not json " + "y".repeat(5_000)).length < 2_000);
});

check("a failing utility model is skipped for a while, longer each time, and a success closes it", () => {
  const t0 = 1_000_000;
  let state = CLOSED;
  state = afterFailure(state, t0);
  assert.equal(breakerOpen(state, t0), false, "one failure does not open it");
  state = afterFailure(state, t0);
  assert.equal(breakerOpen(state, t0 + 1), true, "two in a row open it");
  assert.equal(breakerOpen(state, t0 + FIRST_PAUSE_MS + 1), false, "the pause ends: the next call is the probe");
  state = afterFailure(state, t0 + FIRST_PAUSE_MS + 1);
  assert.equal(state.pauseMs, FIRST_PAUSE_MS * 2, "a failed probe doubles the pause");
  for (let i = 0; i < 10; i += 1) state = afterFailure(state, t0);
  assert.equal(state.pauseMs, MAX_PAUSE_MS, "up to the ceiling");
  assert.deepEqual(afterSuccess(), CLOSED);
});

console.log(`request-fit: ${passed} tests passed`);
