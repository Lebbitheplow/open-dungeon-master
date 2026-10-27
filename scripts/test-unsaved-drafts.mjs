// The workshop's leave check (src/app/workshop/unsaved.ts, WA-03). An
// editor that saves itself hands over how to save now, so moving to another
// tool saves it first and asks only when that save did not land; an editor
// that cannot save itself is asked about as before. The browser's own
// "leave this page?" is armed while any draft is unsaved and disarmed with
// the last. Run against a stand-in window: no ConfirmHost is mounted, so the
// app's confirm falls back to window.confirm, which is counted here.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const listeners = new Map();
let asked = 0;
let answer = false;
globalThis.window = {
  addEventListener: (type, fn) => listeners.set(type, [...(listeners.get(type) ?? []), fn]),
  removeEventListener: (type, fn) => listeners.set(type, (listeners.get(type) ?? []).filter((entry) => entry !== fn)),
  confirm: () => {
    asked += 1;
    return answer;
  },
};

const { mayLeaveDrafts, registerDraft } = await import("../src/app/workshop/unsaved.ts");

let passed = 0;
async function test(name, fn) {
  asked = 0;
  answer = false;
  await fn();
  passed += 1;
}

const guards = () => (listeners.get("beforeunload") ?? []).length;

await test("nothing unsaved: leave at once, nothing asked", async () => {
  assert.equal(await mayLeaveDrafts(), true);
  assert.equal(asked, 0);
});

await test("a self-saving editor whose save lands lets the workshop move on without asking", async () => {
  let saves = 0;
  const done = registerDraft({ flush: async () => (saves += 1) > 0 });
  assert.equal(await mayLeaveDrafts(), true);
  assert.equal(saves, 1, "the draft was saved on the way out");
  assert.equal(asked, 0);
  done();
});

await test("a save that is refused, throws or never answers asks once", async () => {
  for (const flush of [async () => false, async () => Promise.reject(new Error("offline")), () => new Promise(() => {}), () => {
    throw new Error("sync");
  }]) {
    asked = 0;
    const done = registerDraft({ flush });
    answer = false;
    assert.equal(await mayLeaveDrafts(20), false, "staying keeps the draft");
    assert.equal(asked, 1);
    answer = true;
    assert.equal(await mayLeaveDrafts(20), true, "leaving them is the author's call");
    assert.equal(asked, 2);
    done();
  }
});

await test("an editor that cannot save itself is asked about, once, beside one that saved", async () => {
  const saved = registerDraft({ flush: async () => true });
  const plain = registerDraft({});
  answer = false;
  assert.equal(await mayLeaveDrafts(), false);
  assert.equal(asked, 1);
  saved();
  plain();
});

await test("the browser's own leave warning is armed with the first draft and disarmed with the last", async () => {
  assert.equal(guards(), 0);
  const first = registerDraft({});
  assert.equal(guards(), 1);
  const second = registerDraft({ flush: async () => true });
  assert.equal(guards(), 1, "one listener however many drafts");
  first();
  assert.equal(guards(), 1, "still armed while one draft is unsaved");
  second();
  assert.equal(guards(), 0);
  let prevented = false;
  const third = registerDraft({});
  listeners.get("beforeunload")[0]({ preventDefault: () => (prevented = true) });
  assert.ok(prevented, "the warning asks the browser to hold the page");
  third();
  assert.equal(await mayLeaveDrafts(), true, "with every draft gone, nothing is asked");
});

console.log(`test-unsaved-drafts: ${passed} passed`);
