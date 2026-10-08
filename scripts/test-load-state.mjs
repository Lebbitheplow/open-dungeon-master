// A list request read to its end (issue 140): the payload when the server
// said yes, otherwise one sentence that names what did not load and why, in
// the server's words where it gave any. The panels draw their "nothing here
// yet" plate only after a yes with nothing in it, which is what keeps three
// prepared maps behind a 403 from looking lost.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { readLoad, UNREACHABLE, UNREADABLE } = await import("../src/lib/load-state.ts");

let passed = 0;
async function test(name, fn) {
  await fn();
  passed += 1;
}

const reply = (body, status = 200) =>
  Promise.resolve(new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));

await test("a yes is the payload, with no sentence", async () => {
  const outcome = await readLoad(reply({ maps: [{ id: "m1" }], board: null }), "The maps");
  assert.equal(outcome.error, null);
  assert.deepEqual(outcome.payload, { maps: [{ id: "m1" }], board: null });
});

await test("a yes with nothing in it is still a yes: the empty plate is the panel's call", async () => {
  const outcome = await readLoad(reply({ maps: [] }), "The maps");
  assert.equal(outcome.error, null);
  assert.deepEqual(outcome.payload.maps, []);
});

await test("a refusal keeps the server's sentence after what did not load", async () => {
  const outcome = await readLoad(reply({ error: "Only the Dungeon Master can do that." }, 403), "The maps");
  assert.equal(outcome.payload, null);
  assert.equal(outcome.error, "The maps did not load. Only the Dungeon Master can do that.");
});

await test("a refusal without a sentence names the status", async () => {
  assert.equal((await readLoad(reply("", 500), "The cast")).error, "The cast did not load. The server answered 500.");
  assert.equal((await readLoad(reply({ error: "   " }, 404), "The cast")).error, "The cast did not load. The server answered 404.");
  assert.equal((await readLoad(reply({ error: 12 }, 401), "The cast")).error, "The cast did not load. The server answered 401.");
});

await test("a request that never reached the server says so, and never throws", async () => {
  const outcome = await readLoad(Promise.reject(new TypeError("fetch failed")), "The tables");
  assert.equal(outcome.payload, null);
  assert.equal(outcome.error, `The tables did not load. ${UNREACHABLE}`);
});

await test("a 200 that is not JSON is not an empty list either", async () => {
  const outcome = await readLoad(reply("<html>sign in</html>"), "The bestiary");
  assert.equal(outcome.payload, null);
  assert.equal(outcome.error, `The bestiary did not load. ${UNREADABLE}`);
});

console.log(`test-load-state: ${passed} passed`);
