// replyTimeout (src/lib/reply-timeout.ts): a backend's reply that came in
// while this process was held up past the timeout is still read, where
// AbortSignal.timeout aborted it (the model registry's listing on a stalled
// Windows runner); a backend that never answers is still given up on.
import assert from "node:assert/strict";
import http from "node:http";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { replyTimeout } = await import("../src/lib/reply-timeout.ts");

let passed = 0;
async function test(name, fn) {
  await fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

// Holds the whole process, as a stalled machine does, then answers. The
// server is in this process, so its reply is written as the hold ends, with
// the client's timer already due.
const held = http.createServer((request, response) => {
  const end = Date.now() + 300;
  while (Date.now() < end);
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify({ models: [{ name: "gemma4:31b-it-qat" }] }));
});
await new Promise((resolve) => held.listen(0, "127.0.0.1", resolve));
const heldUrl = `http://127.0.0.1:${held.address().port}/api/tags`;

// Takes the request and says nothing.
const silent = http.createServer(() => {});
await new Promise((resolve) => silent.listen(0, "127.0.0.1", resolve));
const silentUrl = `http://127.0.0.1:${silent.address().port}/api/tags`;

try {
  await test("a reply that came in while the process was held past the timeout is read", async () => {
    const response = await fetch(heldUrl, { cache: "no-store", signal: replyTimeout(100) });
    assert.deepEqual(await response.json(), { models: [{ name: "gemma4:31b-it-qat" }] });
  });

  await test("which is the case AbortSignal.timeout loses", async () => {
    await assert.rejects(fetch(heldUrl, { cache: "no-store", signal: AbortSignal.timeout(100) }), { name: "TimeoutError" });
  });

  await test("a backend that never answers is still given up on, as a timeout", async () => {
    const started = Date.now();
    await assert.rejects(fetch(silentUrl, { cache: "no-store", signal: replyTimeout(150) }), { name: "TimeoutError" });
    assert.ok(Date.now() - started < 2_000, "not held past the timeout");
  });

  console.log(`reply-timeout: ${passed} tests passed`);
} finally {
  held.closeAllConnections();
  held.close();
  silent.closeAllConnections();
  silent.close();
}
