// How a passage's speech requests are run (issue 97): a few at a time, in
// order, nothing rendered twice, and offered to listeners as it lands.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { closeLiveNarration, liveNarrationStream, openLiveNarration, pushLiveNarration, renderSpeech, speechConcurrency } = await import(
  "../src/lib/tts-render.ts"
);

let passed = 0;
async function test(name, fn) {
  await fn();
  passed += 1;
}

const backend = { provider: "kokoro", v1: "http://test/v1", model: "kokoro", apiKey: "", defaultVoice: "af_heart" };
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let serial = 0;
const fresh = (text) => ({ text: `${text} #${(serial += 1)}`, voice: "af_heart", speed: 1 });

await test("clips come back in order however long each takes", async () => {
  const requests = [fresh("slow"), fresh("quick"), fresh("middling")];
  const delays = [40, 5, 20];
  let running = 0;
  let peak = 0;
  const heard = [];
  const clips = await renderSpeech(requests, backend, (audio, index) => heard.push([index, audio.toString()]), {
    concurrency: 2,
    synthesize: async (text) => {
      running += 1;
      peak = Math.max(peak, running);
      await wait(delays[requests.findIndex((request) => request.text === text)]);
      running -= 1;
      return Buffer.from(text);
    },
  });
  assert.deepEqual(clips.map((clip) => clip.toString()), requests.map((request) => request.text));
  assert.deepEqual(heard.map(([index]) => index), [0, 1, 2], "listeners get them in the order they are heard");
  assert.equal(peak, 2, "two at a time, never more");
});

await test("a clip already rendered is not asked for again", async () => {
  const requests = [fresh("once"), fresh("twice")];
  let calls = 0;
  const synthesize = async (text) => {
    calls += 1;
    return Buffer.from(text);
  };
  await renderSpeech(requests, backend, undefined, { synthesize });
  await renderSpeech([requests[1], fresh("new")], backend, undefined, { synthesize });
  assert.equal(calls, 3, "the second take renders only the new line");
  await renderSpeech([requests[0]], { ...backend, model: "other" }, undefined, { synthesize });
  assert.equal(calls, 4, "another model is another clip");
});

await test("the first failure stops the passage and is the caller's", async () => {
  const requests = [fresh("fine"), fresh("broken"), fresh("never"), fresh("started")];
  const asked = [];
  await assert.rejects(
    renderSpeech(requests, backend, undefined, {
      concurrency: 1,
      synthesize: async (text) => {
        asked.push(text);
        if (text.startsWith("broken")) {
          throw new Error("HTTP 500");
        }
        return Buffer.from(text);
      },
    }),
    /HTTP 500/,
  );
  assert.equal(asked.length, 2, "nothing is started after the failure");
});

await test("a passage is heard while it is still being made", async () => {
  const live = openLiveNarration("camp", "msg");
  assert.equal(liveNarrationStream("other-camp", "msg"), null, "another table's passage is not this one");
  const reader = liveNarrationStream("camp", "msg").getReader();
  pushLiveNarration(live, Buffer.from("one "));
  assert.equal(Buffer.from((await reader.read()).value).toString(), "one ");
  const pending = reader.read();
  await wait(5);
  pushLiveNarration(live, Buffer.from("two"));
  assert.equal(Buffer.from((await pending).value).toString(), "two", "a listener waits for the next clip");
  closeLiveNarration("msg", live, "done");
  assert.equal((await reader.read()).done, true);
  assert.equal(liveNarrationStream("camp", "msg"), null, "a finished passage is the file's to serve");

  const failing = openLiveNarration("camp", "msg2");
  const cut = liveNarrationStream("camp", "msg2").getReader();
  closeLiveNarration("msg2", failing, "failed");
  await assert.rejects(cut.read(), /Narration failed/);
});

await test("the limit is a small whole number", async () => {
  assert.equal(speechConcurrency(undefined), 2);
  assert.equal(speechConcurrency("4"), 4);
  assert.equal(speechConcurrency("0"), 2);
  assert.equal(speechConcurrency("lots"), 2);
});

console.log(`test-tts-render: ${passed} passed`);
