// The live store (the streaming draft and who is speaking) and the
// coalesced per-seat refetch, both pure enough to run without a DOM
// (src/app/campaigns/[campaignId]/liveStore.ts, coalesce.ts).
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const {
  appendDmDraft,
  clearDmDraft,
  createValueStore,
  dmDraftStore,
  resetLiveStores,
  setVoiceSpeaking,
  voiceSpeakingStore,
} = await import("../src/app/campaigns/[campaignId]/liveStore.ts");
const { coalesceRefresh } = await import("../src/app/campaigns/[campaignId]/coalesce.ts");

let passed = 0;
async function test(name, fn) {
  await fn();
  passed += 1;
  console.log(`ok: ${name}`);
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

await test("a value store notifies on change and stays quiet on the same value", () => {
  const store = createValueStore(1);
  let calls = 0;
  const unsubscribe = store.subscribe(() => {
    calls += 1;
  });
  store.set(2);
  assert.equal(store.get(), 2);
  assert.equal(calls, 1);
  store.set(2);
  assert.equal(calls, 1, "Object.is-equal writes do not notify");
  unsubscribe();
  store.set(3);
  assert.equal(calls, 1, "an unsubscribed listener hears nothing");
  assert.equal(store.get(), 3);
});

await test("the draft grows per delta, clears on the passage, and resets with the table", () => {
  resetLiveStores();
  let notified = 0;
  const unsubscribe = dmDraftStore.subscribe(() => {
    notified += 1;
  });
  appendDmDraft("The door ");
  appendDmDraft("creaks.");
  assert.equal(dmDraftStore.get(), "The door creaks.");
  assert.equal(notified, 2);
  appendDmDraft("");
  assert.equal(notified, 2, "an empty delta is not a change");
  clearDmDraft();
  assert.equal(dmDraftStore.get(), "");
  appendDmDraft("again");
  setVoiceSpeaking({ userId: "u1", at: 5 });
  resetLiveStores();
  assert.equal(dmDraftStore.get(), "");
  assert.equal(voiceSpeakingStore.get(), null);
  unsubscribe();
});

await test("a burst of refetches costs one request in flight plus one trailing", async () => {
  const resolvers = [];
  const load = () => new Promise((resolve) => resolvers.push(resolve));
  const applied = [];
  const refresh = coalesceRefresh(load, (body) => applied.push(body));

  const first = refresh();
  refresh();
  refresh();
  const last = refresh();
  assert.equal(resolvers.length, 1, "only one request opened for four pings");
  assert.equal(first, last, "the waiting callers share the in-flight promise");

  resolvers[0]("a");
  await tick();
  assert.equal(resolvers.length, 2, "one trailing request follows");
  assert.deepEqual(applied, ["a"]);

  resolvers[1]("b");
  await last;
  assert.deepEqual(applied, ["a", "b"]);

  // Quiet again: a new ping opens a fresh request.
  const next = refresh();
  assert.equal(resolvers.length, 3);
  resolvers[2]("b");
  await next;
  assert.deepEqual(applied, ["a", "b"], "an answer identical to the last applied one is dropped");
});

await test("a refused or failed request applies nothing and does not wedge the next", async () => {
  let answers = [Promise.resolve(null), Promise.reject(new Error("offline")), Promise.resolve("x")];
  const applied = [];
  const refresh = coalesceRefresh(() => answers.shift(), (body) => applied.push(body));
  await refresh();
  await refresh();
  assert.deepEqual(applied, []);
  await refresh();
  assert.deepEqual(applied, ["x"]);
  answers = [Promise.resolve("y")];
  await refresh();
  assert.deepEqual(applied, ["x", "y"]);
});

console.log(`\n${passed} live store tests passed.`);
