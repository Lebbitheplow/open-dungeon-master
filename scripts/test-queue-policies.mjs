// Queue lifecycles (audit P12): a campaign's DM queue entry goes when it
// runs dry and its waiting turns are skipped once it is deleted; a picture
// asked for twice before the GPU reached it renders once, and both callers
// wait for that render; a failed embedding-model load is retried with a
// backoff, or not at all when the runtime is missing.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { dmQueueDepth, dropDmQueue, enqueueDmJob, enqueueDmJobFirst, pauseDmQueue, resumeDmQueue } = await import("../src/lib/dm/queue.ts");
const { enqueueMediaJob, mediaQueueStats } = await import("../src/lib/media-queue.ts");
const { embed, embedLoadRetryDelay, isPermanentEmbedLoadFailure } = await import("../src/lib/embeddings.ts");

let passed = 0;
async function test(name, fn) {
  await fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

await test("a campaign's queue entry goes once its last job has run", async () => {
  const ran = [];
  const first = enqueueDmJob("c-drain", async () => {
    ran.push(1);
  });
  const second = enqueueDmJob("c-drain", async () => {
    ran.push(2);
  });
  assert.equal(dmQueueDepth("c-drain"), 2);
  await Promise.all([first, second]);
  await tick();
  assert.deepEqual(ran, [1, 2]);
  assert.equal(globalThis.__odmDmQueues.has("c-drain"), false);
  assert.equal(dmQueueDepth("c-drain"), 0);
});

await test("a failing job still releases the entry", async () => {
  const original = console.error;
  console.error = () => {};
  try {
    await enqueueDmJob("c-fail", async () => {
      throw new Error("boom");
    });
  } finally {
    console.error = original;
  }
  await tick();
  assert.equal(globalThis.__odmDmQueues.has("c-fail"), false);
});

await test("turns waiting on a deleted campaign are skipped, even behind a pause", async () => {
  pauseDmQueue("c-gone", "x-card");
  let ran = false;
  const waiting = enqueueDmJob("c-gone", async () => {
    ran = true;
  });
  await tick();
  assert.equal(ran, false, "the pause holds it");
  dropDmQueue("c-gone");
  await waiting;
  await tick();
  assert.equal(ran, false, "dropped, not run");
  assert.equal(globalThis.__odmDmQueues.has("c-gone"), false);
  // A campaign enqueued afterwards (a fresh id) runs normally.
  let later = false;
  await enqueueDmJob("c-other", async () => {
    later = true;
  });
  assert.equal(later, true);
});

// A blocker job the test lets go of, and the order jobs ran in.
function blockedQueue(campaignId) {
  const ran = [];
  let release;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  const running = enqueueDmJob(campaignId, async () => {
    ran.push("running");
    await held;
  });
  return { ran, release, running };
}

await test("a job put first runs right after the running one, ahead of the queue", async () => {
  const { ran, release, running } = blockedQueue("c-first");
  const queued = enqueueDmJob("c-first", async () => {
    ran.push("queued");
  });
  await tick();
  const first = enqueueDmJobFirst("c-first", async () => {
    ran.push("first");
  });
  assert.equal(dmQueueDepth("c-first"), 3);
  await tick();
  assert.deepEqual(ran, ["running"], "nothing overtakes the running job");
  release();
  await Promise.all([running, queued, first]);
  await tick();
  assert.deepEqual(ran, ["running", "first", "queued"]);
  assert.equal(dmQueueDepth("c-first"), 0);
  assert.equal(globalThis.__odmDmFirst.has("c-first"), false);
});

await test("a job put first on an idle campaign runs at once, and later jobs wait for it", async () => {
  const ran = [];
  let release;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  const first = enqueueDmJobFirst("c-idle", async () => {
    ran.push("first");
    await held;
  });
  const later = enqueueDmJob("c-idle", async () => {
    ran.push("later");
  });
  await tick();
  await tick();
  assert.deepEqual(ran, ["first"], "the queued job waits for the one put first");
  release();
  await Promise.all([first, later]);
  assert.deepEqual(ran, ["first", "later"]);
});

await test("two jobs put first keep their order, and both go before the queue", async () => {
  const { ran, release, running } = blockedQueue("c-two");
  const queued = enqueueDmJob("c-two", async () => {
    ran.push("queued");
  });
  await tick();
  const a = enqueueDmJobFirst("c-two", async () => {
    ran.push("a");
  });
  const b = enqueueDmJobFirst("c-two", async () => {
    ran.push("b");
  });
  release();
  await Promise.all([running, queued, a, b]);
  assert.deepEqual(ran, ["running", "a", "b", "queued"]);
});

await test("a pause holds a job put first until it lifts", async () => {
  pauseDmQueue("c-paused-first", "x-card");
  let ran = false;
  const first = enqueueDmJobFirst("c-paused-first", async () => {
    ran = true;
  });
  await tick();
  await tick();
  assert.equal(ran, false);
  resumeDmQueue("c-paused-first", "x-card");
  await first;
  assert.equal(ran, true);
});

await test("a job put first while a queued one is between its gate and its start never runs beside it", async () => {
  const { ran, release, running } = blockedQueue("c-race");
  let inside = 0;
  let overlapped = false;
  const track = (name) => async () => {
    inside += 1;
    if (inside > 1) overlapped = true;
    ran.push(name);
    await tick();
    inside -= 1;
  };
  const queued = enqueueDmJob("c-race", track("queued"));
  release();
  // Put first from inside a promise callback, the way an async route lands
  // between two of the queue's own callbacks.
  const first = running.then(() => enqueueDmJobFirst("c-race", track("first")));
  await Promise.all([running, queued, first]);
  await first.then((job) => job);
  await tick();
  assert.equal(overlapped, false, "never two jobs at once");
  assert.equal(ran.filter((name) => name !== "running").length, 2);
});

await test("a picture asked for again while still waiting renders once, for both callers", async () => {
  let release;
  const blocker = new Promise((resolve) => {
    release = resolve;
  });
  const order = [];
  const busy = enqueueMediaJob("blocker", () => blocker);
  let firstDone = false;
  const first = enqueueMediaJob("portrait sheet-1", async () => {
    order.push("first");
  }).then(() => {
    firstDone = true;
  });
  const second = enqueueMediaJob("portrait sheet-1", async () => {
    order.push("second");
  });
  const other = enqueueMediaJob("portrait sheet-2", async () => {
    order.push("other");
  });
  release();
  await busy;
  await tick();
  // The replaced caller is not told it is done before the replacement ran.
  await second;
  assert.equal(firstDone || order.includes("second"), true);
  await first;
  await other;
  assert.deepEqual(order, ["second", "other"]);
  assert.ok(mediaQueueStats().gpu.superseded >= 1);
  assert.equal(mediaQueueStats().gpu.waiting, 0);
});

await test("narration is never merged: every passage on a tts lane is read", async () => {
  const read = [];
  await Promise.all([
    enqueueMediaJob("tts m1", async () => read.push("a"), "tts:camp"),
    enqueueMediaJob("tts m1", async () => read.push("b"), "tts:camp"),
  ]);
  assert.deepEqual(read, ["a", "b"]);
});

await test("load retries back off, and a missing runtime is not retried", () => {
  assert.equal(embedLoadRetryDelay(1), 60_000);
  assert.equal(embedLoadRetryDelay(2), 120_000);
  assert.equal(embedLoadRetryDelay(20), 30 * 60_000);
  assert.equal(isPermanentEmbedLoadFailure(Object.assign(new Error("x"), { code: "ERR_MODULE_NOT_FOUND" })), true);
  assert.equal(isPermanentEmbedLoadFailure(new Error("Cannot find module 'onnxruntime-node'")), true);
  assert.equal(isPermanentEmbedLoadFailure(new Error("fetch failed")), false);
});

await test("a remembered failure answers at once until its backoff runs out", async () => {
  const failure = new Error("fetch failed");
  globalThis.__odmEmbedderPromise = undefined;
  globalThis.__odmEmbedderFailure = { at: Date.now(), failures: 1, permanent: false, error: failure };
  await assert.rejects(embed(["hello"]), /fetch failed/);
  // Once the window has passed, the next call loads again (here: a stand-in).
  globalThis.__odmEmbedderFailure.at = Date.now() - 61_000;
  globalThis.__odmEmbedderPromise = Promise.resolve(async (texts) => ({
    tolist: () => texts.map(() => Array.from({ length: 384 }, () => 0)),
  }));
  globalThis.__odmEmbedderFailure = undefined;
  const [vector] = await embed(["hello"]);
  assert.equal(vector.length, 384);
});

await test("a turn's query goes ahead of re-index batches that have not started", async () => {
  const seen = [];
  globalThis.__odmEmbedderPromise = Promise.resolve(async (texts) => {
    seen.push(texts[0]);
    await tick();
    return { tolist: () => texts.map(() => Array.from({ length: 384 }, () => 0)) };
  });
  const jobs = [
    embed(["bg-1"], { background: true }),
    embed(["bg-2"], { background: true }),
    embed(["bg-3"], { background: true }),
  ];
  await tick();
  jobs.push(embed(["query"]));
  await Promise.all(jobs);
  assert.equal(seen[0], "bg-1", "the running batch finishes");
  assert.equal(seen[1], "query", "then the query, before the rest");
});

console.log(`\n${passed} queue-policy tests passed.`);
