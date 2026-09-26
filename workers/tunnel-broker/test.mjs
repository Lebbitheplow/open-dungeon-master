// Broker checks under plain Node: helper shapes, the create flow against a
// mocked Cloudflare API, and teardown auth. Run: node test.mjs
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import worker, { parseCode, parsePort } from "./src/broker.js";
import { gate } from "./src/gate.js";
import { SqlStore, importLegacy } from "./src/store.js";

// The store under test is the real SqlStore over node:sqlite, so every
// check below runs against the SQL the Durable Object runs. Writes and
// deletes are counted because they are what the free plan meters.
class TestStore extends SqlStore {
  constructor() {
    const db = new DatabaseSync(":memory:");
    super((sql, ...params) => db.prepare(sql).all(...params));
    this.db = db;
    this.writes = 0;
    this.deletes = 0;
  }
  async put(key, value, options) {
    this.writes += 1;
    return super.put(key, value, options);
  }
  async delete(key) {
    this.deletes += 1;
    return super.delete(key);
  }
  // Straight at the row, expiry and all, for the tests that age things.
  raw(key) {
    return this.db.prepare("SELECT value, expires_at FROM kv WHERE key = ?").get(key) ?? null;
  }
  setRaw(key, value) {
    this.db.prepare("UPDATE kv SET value = ? WHERE key = ?").run(value, key);
  }
}

// What the legacy import reads from: Workers KV's list/get shape.
class FakeKv {
  constructor() {
    this.map = new Map();
    this.expiry = new Map();
  }
  async get(key) {
    return this.map.get(key) ?? null;
  }
  async put(key, value, { expirationTtl } = {}) {
    this.map.set(key, value);
    if (expirationTtl) this.expiry.set(key, Math.floor(Date.now() / 1000) + expirationTtl);
  }
  async list({ prefix }) {
    return {
      keys: [...this.map.keys()]
        .filter((k) => k.startsWith(prefix))
        .map((name) => ({ name, expiration: this.expiry.get(name) })),
    };
  }
}

const calls = [];
globalThis.fetch = async (url, init = {}) => {
  calls.push({ url: String(url), method: init.method || "GET" });
  const path = new URL(url).pathname;
  let result = { id: "fake-id" };
  if (path.endsWith("/token")) result = "fake-tunnel-token";
  if (path.includes("dns_records")) result = { id: "fake-dns-id" };
  if (path === "/client/v4/zones") result = [{ id: "zone" }];
  return new Response(JSON.stringify({ success: true, result }), { status: 200 });
};

const env = {
  SESSIONS: new TestStore(),
  CF_API_TOKEN: "test-token",
  ACCOUNT_ID: "acct",
  ZONE_NAME: "opendungeonmaster.com",
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
  assert.equal(created.hostname, `play-${created.code.toLowerCase()}.opendungeonmaster.com`);
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

await test("GET /turn degrades to STUN-only without a TURN key", async () => {
  const response = await worker.fetch(request("GET", "/turn"), env);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.iceServers, [{ urls: ["stun:stun.cloudflare.com:3478"] }]);
});

await test("GET /turn appends minted TURN credentials when configured", async () => {
  const turnEnv = { ...env, TURN_KEY_ID: "key", TURN_API_TOKEN: "tok" };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    if (String(url).includes("rtc.live.cloudflare.com")) {
      return new Response(
        JSON.stringify({
          iceServers: [{ urls: ["turn:turn.cloudflare.com:3478"], username: "u", credential: "c" }],
        }),
        { status: 200 },
      );
    }
    return realFetch(url, init);
  };
  const response = await worker.fetch(request("GET", "/turn"), turnEnv);
  globalThis.fetch = realFetch;
  const body = await response.json();
  assert.equal(body.iceServers.length, 2);
  assert.equal(body.iceServers[1].username, "u");
});

await test("GET /turn is STUN-only while the monthly pause flag is set", async () => {
  const turnEnv = { ...env, SESSIONS: new TestStore(), TURN_KEY_ID: "key", TURN_API_TOKEN: "tok" };
  const month = new Date().toISOString().slice(0, 7);
  await turnEnv.SESSIONS.put(`turn-paused:${month}`, "over-budget");
  const response = await worker.fetch(request("GET", "/turn"), turnEnv);
  const body = await response.json();
  assert.deepEqual(body.iceServers, [{ urls: ["stun:stun.cloudflare.com:3478"] }]);
});

await test("GET /turn is STUN-only after the monthly mint budget is spent", async () => {
  const turnEnv = {
    ...env,
    SESSIONS: new TestStore(),
    TURN_KEY_ID: "key",
    TURN_API_TOKEN: "tok",
    TURN_MONTHLY_MINT_CAP: "1",
  };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    if (String(url).includes("rtc.live.cloudflare.com")) {
      return new Response(
        JSON.stringify({ iceServers: [{ urls: ["turn:turn.cloudflare.com:3478"] }] }),
        { status: 200 },
      );
    }
    return realFetch(url, init);
  };
  const first = await (await worker.fetch(request("GET", "/turn"), turnEnv)).json();
  const second = await (await worker.fetch(request("GET", "/turn"), turnEnv)).json();
  globalThis.fetch = realFetch;
  assert.equal(first.iceServers.length, 2);
  assert.deepEqual(second.iceServers, [{ urls: ["stun:stun.cloudflare.com:3478"] }]);
});

await test("the usage cron pauses minting when egress passes the budget", async () => {
  const turnEnv = {
    ...env,
    SESSIONS: new TestStore(),
    TURN_KEY_ID: "key",
    TURN_API_TOKEN: "tok",
    TURN_MONTHLY_GB_BUDGET: "1",
  };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    if (String(url).endsWith("/graphql")) {
      return new Response(
        JSON.stringify({
          data: {
            viewer: {
              accounts: [
                { callsTurnUsageAdaptiveGroups: [{ sum: { egressBytes: 2e9 } }] },
              ],
            },
          },
        }),
        { status: 200 },
      );
    }
    return realFetch(url, init);
  };
  await worker.scheduled({}, turnEnv);
  const month = new Date().toISOString().slice(0, 7);
  assert.equal(await turnEnv.SESSIONS.get(`turn-paused:${month}`), "over-budget");
  assert.equal(await turnEnv.SESSIONS.get(`turn-usage-gb:${month}`), "2.00");

  // The next hour, nothing changed: the cron must cost no write and no
  // delete, or it alone eats 48 of the free tier's daily 1,000 of each.
  const writes = turnEnv.SESSIONS.writes;
  const deletes = turnEnv.SESSIONS.deletes;
  await worker.scheduled({}, turnEnv);
  assert.equal(turnEnv.SESSIONS.writes, writes);
  assert.equal(turnEnv.SESSIONS.deletes, deletes);

  // A new month under budget lifts the pause exactly once.
  turnEnv.TURN_MONTHLY_GB_BUDGET = "5";
  await worker.scheduled({}, turnEnv);
  assert.equal(await turnEnv.SESSIONS.get(`turn-paused:${month}`), null);
  assert.equal(turnEnv.SESSIONS.deletes, deletes + 1);
  await worker.scheduled({}, turnEnv);
  assert.equal(turnEnv.SESSIONS.deletes, deletes + 1);
  globalThis.fetch = realFetch;
});

await test("an analytics-blind token skips the usage check without breaking cleanup", async () => {
  const turnEnv = { ...env, SESSIONS: new TestStore(), TURN_KEY_ID: "key", TURN_API_TOKEN: "tok" };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    if (String(url).endsWith("/graphql")) {
      return new Response(JSON.stringify({ errors: [{ message: "auth" }] }), { status: 403 });
    }
    return realFetch(url, init);
  };
  await worker.scheduled({}, turnEnv);
  globalThis.fetch = realFetch;
  const month = new Date().toISOString().slice(0, 7);
  assert.equal(await turnEnv.SESSIONS.get(`turn-paused:${month}`), null);
});

await test("rate limit trips after the daily allowance", async () => {
  let last;
  for (let i = 0; i < 25; i += 1) {
    last = await worker.fetch(request("POST", "/session", { body: { port: 3210 } }), env);
  }
  assert.equal(last.status, 429);
});

await test("a table code is claimed, re-pointed by its owner, and read back", async () => {
  const secret = "0123456789abcdef0123";
  const put = await worker.fetch(
    request("PUT", "/table/EFGH6789", {
      body: { url: "https://play-abcd2345.opendungeonmaster.com" },
      headers: { "x-table-secret": secret },
    }),
    env,
  );
  assert.equal(put.status, 200);
  const found = await worker.fetch(request("GET", "/table/EFGH6789"), env);
  assert.equal(found.status, 200);
  assert.equal((await found.json()).url, "https://play-abcd2345.opendungeonmaster.com");

  // The session ends and the world comes back at a new address: the same
  // code, re-pointed by the same secret, is what makes one code last.
  const again = await worker.fetch(
    request("PUT", "/table/EFGH6789", {
      body: { url: "https://play-wxyz9876.opendungeonmaster.com" },
      headers: { "x-table-secret": secret },
    }),
    env,
  );
  assert.equal(again.status, 200);
  const moved = await worker.fetch(request("GET", "/table/efgh6789"), env);
  assert.equal((await moved.json()).url, "https://play-wxyz9876.opendungeonmaster.com");
});

await test("re-sending an unchanged address costs no KV write", async () => {
  const secret = "0123456789abcdef0123";
  const body = { url: "https://play-wxyz9876.opendungeonmaster.com" };
  const headers = { "x-table-secret": secret };
  const before = env.SESSIONS.writes;
  for (let i = 0; i < 5; i += 1) {
    const put = await worker.fetch(request("PUT", "/table/EFGH6789", { body, headers }), env);
    assert.equal(put.status, 200);
    assert.equal((await put.json()).url, body.url);
  }
  assert.equal(env.SESSIONS.writes, before, "a host's minute-by-minute republish must be free");

  // A row that is a day old is rewritten once, so its 45-day expiry
  // keeps sliding for as long as the table stays shared.
  const raw = JSON.parse(env.SESSIONS.raw("table:EFGH6789").value);
  raw.at = Date.now() - 2 * 86_400 * 1000;
  env.SESSIONS.setRaw("table:EFGH6789", JSON.stringify(raw));
  const refreshed = await worker.fetch(request("PUT", "/table/EFGH6789", { body, headers }), env);
  assert.equal(refreshed.status, 200);
  assert.equal(env.SESSIONS.writes, before + 1);

  // A row written before the timestamp existed is treated as stale once.
  delete raw.at;
  env.SESSIONS.setRaw("table:EFGH6789", JSON.stringify(raw));
  await worker.fetch(request("PUT", "/table/EFGH6789", { body, headers }), env);
  assert.equal(env.SESSIONS.writes, before + 2);
  await worker.fetch(request("PUT", "/table/EFGH6789", { body, headers }), env);
  assert.equal(env.SESSIONS.writes, before + 2);

  // Moving is still a write, as it must be.
  const moved = await worker.fetch(
    request("PUT", "/table/EFGH6789", {
      body: { url: "https://play-moved123.opendungeonmaster.com" },
      headers,
    }),
    env,
  );
  assert.equal(moved.status, 200);
  assert.equal(env.SESSIONS.writes, before + 3);
  const found = await worker.fetch(request("GET", "/table/EFGH6789"), env);
  assert.equal((await found.json()).url, "https://play-moved123.opendungeonmaster.com");
  // Back where the other tests expect it.
  await worker.fetch(request("PUT", "/table/EFGH6789", { body, headers }), env);
});

await test("a session whose record cannot be written is torn down, not leaked", async () => {
  const kv = new TestStore();
  const failing = { ...env, SESSIONS: kv };
  calls.length = 0;
  // The rate-limit counter is the first write; let that one through so
  // the failure lands on the session record itself.
  let puts = 0;
  const realPut = kv.put.bind(kv);
  kv.put = async (key, value, options) => {
    puts += 1;
    if (key.startsWith("session:")) throw new Error("row write limit exceeded for the day.");
    return realPut(key, value, options);
  };
  const response = await worker.fetch(request("POST", "/session", { body: { port: 3210 } }), failing);
  assert.equal(response.status, 502);
  const methods = calls.map((call) => `${call.method} ${new URL(call.url).pathname}`);
  assert.ok(methods.some((m) => m.startsWith("POST /client/v4/accounts/acct/cfd_tunnel")));
  assert.ok(methods.some((m) => m === "DELETE /client/v4/accounts/acct/cfd_tunnel/fake-id"));
  assert.ok(methods.some((m) => m.startsWith("DELETE /client/v4/zones/zone/dns_records/")));
  assert.ok(puts >= 2);
  assert.equal((await kv.list({ prefix: "session:" })).keys.length, 0);
});

await test("nobody else can point a claimed table somewhere", async () => {
  const stolen = await worker.fetch(
    request("PUT", "/table/EFGH6789", {
      body: { url: "https://evil.example.com" },
      headers: { "x-table-secret": "ffffffffffffffffffff" },
    }),
    env,
  );
  assert.equal(stolen.status, 409);
  const dropped = await worker.fetch(
    request("DELETE", "/table/EFGH6789", { headers: { "x-table-secret": "ffffffffffffffffffff" } }),
    env,
  );
  assert.equal(dropped.status, 409);
});

await test("a table goes offline when its host stops sharing", async () => {
  const secret = "0123456789abcdef0123";
  const gone = await worker.fetch(
    request("DELETE", "/table/EFGH6789", { headers: { "x-table-secret": secret } }),
    env,
  );
  assert.equal(gone.status, 200);
  const missing = await worker.fetch(request("GET", "/table/EFGH6789"), env);
  assert.equal(missing.status, 404);
});

await test("dropping a table twice costs one write, and a quick-tunnel address is a fine home", async () => {
  const secret = "0123456789abcdef0123";
  const headers = { "x-table-secret": secret };
  // The free fallback: an anonymous trycloudflare address is what a host
  // without a broker session publishes, and it must round-trip like any other.
  const quick = "https://brave-lamp-1234.trycloudflare.com";
  const put = await worker.fetch(
    request("PUT", "/table/EFGH6789", { body: { url: quick }, headers }),
    env,
  );
  assert.equal(put.status, 200);
  const found = await worker.fetch(request("GET", "/table/EFGH6789"), env);
  assert.equal((await found.json()).url, quick);

  const before = env.SESSIONS.writes;
  const first = await worker.fetch(request("DELETE", "/table/EFGH6789", { headers }), env);
  assert.equal(first.status, 200);
  assert.equal(env.SESSIONS.writes, before + 1);
  const second = await worker.fetch(request("DELETE", "/table/EFGH6789", { headers }), env);
  assert.equal(second.status, 200);
  assert.equal(env.SESSIONS.writes, before + 1, "stop and then quit must not pay twice");
  const gone = await worker.fetch(request("GET", "/table/EFGH6789"), env);
  assert.equal(gone.status, 404);
});

await test("a dropped table keeps its claim: only its owner can bring it back", async () => {
  const secret = "0123456789abcdef0123";
  const squatter = await worker.fetch(
    request("PUT", "/table/EFGH6789", {
      body: { url: "https://evil.example.com" },
      headers: { "x-table-secret": "ffffffffffffffffffff" },
    }),
    env,
  );
  assert.equal(squatter.status, 409);
  const back = await worker.fetch(
    request("PUT", "/table/EFGH6789", {
      body: { url: "https://play-third.opendungeonmaster.com" },
      headers: { "x-table-secret": secret },
    }),
    env,
  );
  assert.equal(back.status, 200);
  const found = await worker.fetch(request("GET", "/table/EFGH6789"), env);
  assert.equal(found.status, 200);
  assert.equal((await found.json()).url, "https://play-third.opendungeonmaster.com");
  await worker.fetch(
    request("DELETE", "/table/EFGH6789", { headers: { "x-table-secret": secret } }),
    env,
  );
});

await test("junk codes, junk addresses and short secrets are refused", async () => {
  const secret = "0123456789abcdef0123";
  const badCode = await worker.fetch(
    request("PUT", "/table/AB", { body: { url: "https://x.example.com" }, headers: { "x-table-secret": secret } }),
    env,
  );
  assert.equal(badCode.status, 400);
  const badUrl = await worker.fetch(
    request("PUT", "/table/JKLM2345", { body: { url: "javascript:alert(1)" }, headers: { "x-table-secret": secret } }),
    env,
  );
  assert.equal(badUrl.status, 400);
  const shortSecret = await worker.fetch(
    request("PUT", "/table/JKLM2345", { body: { url: "https://x.example.com" }, headers: { "x-table-secret": "short" } }),
    env,
  );
  assert.equal(shortSecret.status, 400);
  const unknown = await worker.fetch(request("GET", "/table/JKLM2345"), env);
  assert.equal(unknown.status, 404);
});


await test("the SQLite store keeps the KV contract: upsert, expiry, prefix list, sweep", async () => {
  const store = new TestStore();
  assert.equal(await store.get("a"), null);
  await store.put("a", "1");
  await store.put("a", "2");
  assert.equal(await store.get("a"), "2");
  await store.put("table:X", "x", { expirationTtl: 3600 });
  await store.put("table:Y", "y", { expirationTtl: 3600 });
  await store.put("session:Z", "z");
  assert.deepEqual(
    (await store.list({ prefix: "table:" })).keys.map((k) => k.name),
    ["table:X", "table:Y"],
  );
  assert.deepEqual((await store.list({ prefix: "nothing:" })).keys, []);
  assert.ok(store.raw("table:X").expires_at > Date.now());
  // Aged past its expiry the row is invisible at once and swept later.
  store.db.prepare("UPDATE kv SET expires_at = ? WHERE key = ?").run(Date.now() - 1, "table:X");
  assert.equal(await store.get("table:X"), null);
  assert.deepEqual((await store.list({ prefix: "table:" })).keys.map((k) => k.name), ["table:Y"]);
  assert.equal(await store.sweep(), 1);
  assert.equal(store.raw("table:X"), null);
  await store.delete("a");
  assert.equal(await store.get("a"), null);
  // A value with a quote and a prefix with a wildcard are plain data.
  await store.put("q", "it's \"quoted\" 100%");
  assert.equal(await store.get("q"), "it's \"quoted\" 100%");
  await store.put("100%:x", "w");
  assert.deepEqual((await store.list({ prefix: "100%:" })).keys.map((k) => k.name), ["100%:x"]);
});

await test("the legacy import carries claims, live sessions and the zone id over once", async () => {
  const kv = new FakeKv();
  await kv.put("table:EFGH6789", JSON.stringify({ url: "https://x", secretHash: "h" }), {
    expirationTtl: 45 * 86_400,
  });
  await kv.put("session:ABCD2345", JSON.stringify({ tunnelId: "t", createdAt: 1 }), {
    expirationTtl: 3600,
  });
  await kv.put("zone-id", "zone");
  await kv.put("turn:abc:2026-09-25", "3", { expirationTtl: 60 });
  const store = new TestStore();
  assert.equal(await importLegacy(store, kv), 2);
  assert.equal(await store.get("table:EFGH6789"), JSON.stringify({ url: "https://x", secretHash: "h" }));
  assert.equal(await store.get("session:ABCD2345"), JSON.stringify({ tunnelId: "t", createdAt: 1 }));
  assert.equal(await store.get("zone-id"), "zone");
  assert.equal(await store.get("turn:abc:2026-09-25"), null, "counters are not worth carrying");
  const tableTtl = store.raw("table:EFGH6789").expires_at - Date.now();
  assert.ok(tableTtl > 44 * 86_400 * 1000 && tableTtl <= 45 * 86_400 * 1000);
  assert.equal(await importLegacy(store, kv), 0, "runs once");
  assert.equal(await importLegacy(new TestStore(), undefined), 0, "no binding, no-op");
});

await test("the edge gate refuses on either limiter and passes without them", async () => {
  const seen = [];
  const limiter = (ok) => ({
    async limit({ key }) {
      seen.push(key);
      return { success: ok };
    },
  });
  assert.equal(await gate(request("GET", "/turn"), { PER_IP: limiter(true), GLOBAL: limiter(true) }), null);
  assert.deepEqual(seen, ["1.2.3.4", "all"]);
  const refused = await gate(request("GET", "/turn"), { PER_IP: limiter(false), GLOBAL: limiter(true) });
  assert.equal(refused.status, 429);
  const damped = await gate(request("GET", "/turn"), { PER_IP: limiter(true), GLOBAL: limiter(false) });
  assert.equal(damped.status, 429);
  assert.equal(await gate(request("GET", "/turn"), {}), null);
});

console.log(`\n${passed} checks passed`);
