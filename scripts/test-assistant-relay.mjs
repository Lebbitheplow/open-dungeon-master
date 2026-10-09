// Assistant links (src/lib/agents/assistant-relay.ts): the pure step a pass
// takes, then real passes against a throwaway database and a fake broker.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";
import { removeTempDir } from "./lib/remove-temp-dir.mjs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-assistant-relay-"));
process.env.SQLITE_DB_PATH = path.join(dir, "test.sqlite");
process.env.DB_ENCRYPTION_KEY = randomBytes(32).toString("hex");
process.env.ODM_ICE_BROKER_URL = "https://broker.test";
delete process.env.ODM_DEVICE_WORLD;

register("./lib/register-alias.mjs", import.meta.url);

const { getAppSetting, getInstanceId, saveGlobalConfig } = await import("../src/lib/db/app-settings.ts");
const { assistantRelayUrl, relayStep, relayTarget, syncAssistantRelay } = await import(
  "../src/lib/agents/assistant-relay.ts"
);

let passed = 0;
async function test(name, fn) {
  await fn();
  passed += 1;
  console.log(`ok: ${name}`);
}

const PLAY = "https://play-abcd2345.opendungeonmaster.com";
const DAY = 24 * 60 * 60 * 1000;

// A broker that records what it was asked and answers like the real one.
function fakeBroker(status = 200) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method, headers: init.headers, body: init.body ? JSON.parse(init.body) : null });
    const key = String(url).split("/").pop();
    return new Response(JSON.stringify({ key, relayUrl: `https://agents.opendungeonmaster.com/w/${key}` }), { status });
  };
  return { calls, fetchImpl };
}

function resetGate() {
  globalThis.__odmAssistantRelay = undefined;
}

await test("only a public https address is worth registering", () => {
  assert.equal(relayTarget(`${PLAY}/campaigns`), PLAY);
  assert.equal(relayTarget("http://192.168.1.20:3005"), "");
  assert.equal(relayTarget(""), "");
  assert.equal(relayTarget(null), "");
});

await test("a pass registers a new address, refreshes daily, and drops when sharing stops", () => {
  assert.deepEqual(relayStep({ url: "", at: 0 }, PLAY, 1000), { kind: "register", url: PLAY });
  assert.deepEqual(relayStep({ url: PLAY, at: 1000 }, PLAY, 2000), { kind: "none" });
  assert.deepEqual(relayStep({ url: PLAY, at: 1000 }, PLAY, 1000 + DAY), { kind: "register", url: PLAY });
  assert.deepEqual(relayStep({ url: PLAY, at: 1000 }, "https://next.trycloudflare.com", 2000), {
    kind: "register",
    url: "https://next.trycloudflare.com",
  });
  assert.deepEqual(relayStep({ url: PLAY, at: 1000 }, "http://192.168.1.20:3005", 2000), { kind: "drop" });
  assert.deepEqual(relayStep({ url: "", at: 1000 }, "", 2000), { kind: "none" });
});

await test("a server that is not a device world never talks to the broker", async () => {
  const broker = fakeBroker();
  saveGlobalConfig({ publicUrl: PLAY });
  assert.equal(await syncAssistantRelay(1000, broker.fetchImpl), "skipped");
  assert.equal(broker.calls.length, 0);
  assert.equal(assistantRelayUrl(), "");
});

process.env.ODM_DEVICE_WORLD = "1";

await test("a device world registers its shared address with its own key and secret", async () => {
  resetGate();
  const broker = fakeBroker();
  assert.equal(await syncAssistantRelay(1000, broker.fetchImpl), "register");
  const state = getAppSetting("assistant_relay", null);
  assert.match(state.key, /^[a-f0-9]{32}$/);
  assert.ok(state.secret.length >= 32);
  assert.equal(broker.calls[0].method, "PUT");
  assert.equal(broker.calls[0].url, `https://broker.test/world/${state.key}`);
  assert.equal(broker.calls[0].headers["x-world-secret"], state.secret);
  assert.deepEqual(broker.calls[0].body, { url: PLAY, instanceId: getInstanceId() });
  assert.equal(assistantRelayUrl(), `https://agents.opendungeonmaster.com/w/${state.key}`);
  assert.equal(await syncAssistantRelay(2000, broker.fetchImpl), "none");
  assert.equal(broker.calls.length, 1, "an unchanged address costs nothing");
});

await test("a re-share at a new address re-points the same key, and stopping drops it", async () => {
  resetGate();
  const broker = fakeBroker();
  const { key } = getAppSetting("assistant_relay", null);
  saveGlobalConfig({ publicUrl: "https://next-one.trycloudflare.com" });
  assert.equal(await syncAssistantRelay(3000, broker.fetchImpl), "register");
  assert.equal(broker.calls[0].url, `https://broker.test/world/${key}`);
  saveGlobalConfig({ publicUrl: "http://192.168.1.20:3005" });
  assert.equal(await syncAssistantRelay(4000, broker.fetchImpl), "drop");
  assert.equal(broker.calls[1].method, "DELETE");
  assert.equal(getAppSetting("assistant_relay", null).url, "");
  assert.equal(assistantRelayUrl(), `https://agents.opendungeonmaster.com/w/${key}`, "links keep their address");
});

await test("an unreachable broker is asked again ten minutes later, not every tick", async () => {
  resetGate();
  saveGlobalConfig({ publicUrl: PLAY });
  const down = fakeBroker(503);
  assert.equal(await syncAssistantRelay(10_000, down.fetchImpl), "failed");
  assert.equal(await syncAssistantRelay(70_000, down.fetchImpl), "skipped");
  const up = fakeBroker();
  assert.equal(await syncAssistantRelay(10_000 + 10 * 60 * 1000, up.fetchImpl), "register");
  const thrown = async () => {
    throw new Error("offline");
  };
  resetGate();
  saveGlobalConfig({ publicUrl: "https://third.trycloudflare.com" });
  assert.equal(await syncAssistantRelay(20 * 60 * 1000, thrown), "failed");
});

removeTempDir(dir);
console.log(`\ntest-assistant-relay: ${passed} passed`);
