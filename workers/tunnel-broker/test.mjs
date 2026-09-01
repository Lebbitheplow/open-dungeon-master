// Broker checks under plain Node: helper shapes, the create flow against a
// mocked Cloudflare API, and teardown auth. Run: node test.mjs
import assert from "node:assert/strict";
import worker, { parseCode, parsePort } from "./src/index.js";

class FakeKv {
  constructor() {
    this.map = new Map();
  }
  async get(key) {
    return this.map.get(key) ?? null;
  }
  async put(key, value) {
    this.map.set(key, value);
  }
  async delete(key) {
    this.map.delete(key);
  }
  async list({ prefix }) {
    return { keys: [...this.map.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })) };
  }
}

const calls = [];
globalThis.fetch = async (url, init = {}) => {
  calls.push({ url: String(url), method: init.method || "GET" });
  const path = new URL(url).pathname;
  let result = { id: "fake-id" };
  if (path.endsWith("/token")) result = "fake-tunnel-token";
  if (path.includes("dns_records")) result = { id: "fake-dns-id" };
  return new Response(JSON.stringify({ success: true, result }), { status: 200 });
};

const env = {
  SESSIONS: new FakeKv(),
  CF_API_TOKEN: "test-token",
  ACCOUNT_ID: "acct",
  ZONE_ID: "zone",
};

function request(method, path, { body, headers } = {}) {
  return new Request(`https://broker.test${path}`, {
    method,
    headers: { "cf-connecting-ip": "1.2.3.4", ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

let passed = 0;
async function test(name, fn) {
  await fn();
  passed += 1;
  console.log(`ok: ${name}`);
}

await test("parsePort accepts real ports only", () => {
  assert.equal(parsePort(3210), 3210);
  assert.equal(parsePort("8080"), 8080);
  assert.equal(parsePort(0), null);
  assert.equal(parsePort(70000), null);
  assert.equal(parsePort("nope"), null);
});

await test("parseCode enforces the invite alphabet shape", () => {
  assert.equal(parseCode("abcdefgh"), "ABCDEFGH");
  assert.equal(parseCode("ABCD"), null);
  assert.equal(parseCode("ABCDEFG0"), null);
});

let created;
await test("POST /session creates tunnel, config, DNS and returns the goods", async () => {
  const response = await worker.fetch(request("POST", "/session", { body: { port: 3210 } }), env);
  assert.equal(response.status, 200);
  created = await response.json();
  assert.equal(parseCode(created.code), created.code);
  assert.equal(created.hostname, `${created.code.toLowerCase()}.play.opendungeonmaster.com`);
  assert.equal(created.tunnelToken, "fake-tunnel-token");
  assert.ok(created.secret.length >= 32);
  const methods = calls.map((call) => `${call.method} ${new URL(call.url).pathname}`);
  assert.ok(methods.some((m) => m === "POST /client/v4/accounts/acct/cfd_tunnel"));
  assert.ok(methods.some((m) => m.startsWith("PUT /client/v4/accounts/acct/cfd_tunnel/")));
  assert.ok(methods.some((m) => m === "POST /client/v4/zones/zone/dns_records"));
});

await test("POST /session without a port is rejected", async () => {
  const response = await worker.fetch(request("POST", "/session", { body: {} }), env);
  assert.equal(response.status, 400);
});

await test("DELETE with the wrong secret is refused", async () => {
  const response = await worker.fetch(
    request("DELETE", `/session/${created.code}`, { headers: { "x-session-secret": "wrong" } }),
    env,
  );
  assert.equal(response.status, 403);
});

await test("DELETE with the right secret tears the session down", async () => {
  const response = await worker.fetch(
    request("DELETE", `/session/${created.code}`, {
      headers: { "x-session-secret": created.secret },
    }),
    env,
  );
  assert.equal(response.status, 200);
  assert.equal(await env.SESSIONS.get(`session:${created.code}`), null);
});

await test("rate limit trips after the daily allowance", async () => {
  let last;
  for (let i = 0; i < 25; i += 1) {
    last = await worker.fetch(request("POST", "/session", { body: { port: 3210 } }), env);
  }
  assert.equal(last.status, 429);
});

console.log(`\n${passed} checks passed`);
