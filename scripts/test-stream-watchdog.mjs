// The table stream's watchdog (issue 73): a stream that stays open but stops
// carrying anything is reopened, and nothing else is
// (src/app/campaigns/[campaignId]/streamWatchdog.ts).
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { createStreamWatchdog, STREAM_PING_MS, STREAM_SILENCE_MS } = await import(
  "../src/app/campaigns/[campaignId]/streamWatchdog.ts"
);

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`ok: ${name}`);
}

function rig() {
  let clock = 1_000;
  let silent = 0;
  const watchdog = createStreamWatchdog(() => {
    silent += 1;
  }, () => clock);
  return {
    watchdog,
    advance: (ms) => {
      clock += ms;
    },
    silent: () => silent,
  };
}

test("several beats may go missing before a stream is given up on", () => {
  assert.ok(STREAM_SILENCE_MS >= STREAM_PING_MS * 2);
});

test("a quiet stream from a server that beats is reopened", () => {
  const { watchdog, advance, silent } = rig();
  watchdog.pinged();
  advance(STREAM_SILENCE_MS);
  watchdog.check(true);
  assert.equal(silent(), 0, "exactly the limit is still alive");
  advance(1);
  watchdog.check(true);
  assert.equal(silent(), 1);
});

test("pings and events keep the stream alive", () => {
  const { watchdog, advance, silent } = rig();
  watchdog.pinged();
  for (let beat = 0; beat < 10; beat += 1) {
    advance(STREAM_PING_MS);
    if (beat % 2) {
      watchdog.pinged();
    } else {
      watchdog.heard();
    }
    watchdog.check(true);
  }
  assert.equal(silent(), 0);
});

test("a server that never pings is never taken for dead", () => {
  // An app built on this page, talking to an older server whose beat is an
  // invisible SSE comment, would otherwise reconnect every few seconds.
  const { watchdog, advance, silent } = rig();
  watchdog.heard();
  advance(STREAM_SILENCE_MS * 10);
  watchdog.check(true);
  assert.equal(silent(), 0);
});

test("a stream closed for good is left to the snapshot probe", () => {
  const { watchdog, advance, silent } = rig();
  watchdog.pinged();
  advance(STREAM_SILENCE_MS * 2);
  watchdog.check(false);
  assert.equal(silent(), 0);
});

test("one silence is one reopen, and the new stream gets its own window", () => {
  const { watchdog, advance, silent } = rig();
  watchdog.pinged();
  advance(STREAM_SILENCE_MS + 1);
  watchdog.check(true);
  watchdog.check(true);
  assert.equal(silent(), 1, "checked twice at once, reopened once");
  advance(STREAM_SILENCE_MS);
  watchdog.check(true);
  assert.equal(silent(), 1, "the reopened stream is not given up on early");
  advance(1);
  watchdog.check(true);
  assert.equal(silent(), 2, "but a reopened stream that stays silent is reopened again");
});

console.log(`stream watchdog: ${passed} passed`);
