// Broker checks under plain Node: helper shapes, the create flow against a
// mocked Cloudflare API, and teardown auth. Run: node test.mjs
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import worker, { parseCode, parsePort } from "./src/broker.js";
import { gate } from "./src/gate.js";
import { createRelay, parseRelayPath } from "./src/relay.js";
import { SqlStore, importLegacy } from "./src/store.js";
import { checkRelayUsage, parseWorldUrl, RELAY_CRON, worldRoute } from "./src/worlds.js";

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

  // A claim outlives a season away from the table: nobody else can
  // register the code while its host is on a break.
  const life = env.SESSIONS.raw("table:EFGH6789").expires_at - Date.now();
  assert.ok(life > 365 * 86_400 * 1000, "a claim must hold for over a year");

  // A row that is a day old is rewritten once, so its expiry keeps
  // sliding for as long as the table stays shared.
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

// ---------- the world registry and the assistant relay ----------

const WORLD_KEY = "0123456789abcdef0123456789abcdef";
const WORLD_SECRET = "world-secret-0123456789";
const TOKEN = "odm_abcdefghijklmnopqrstuvwxyz0123456789ABCD";
const PLAY = "https://play-abcd2345.opendungeonmaster.com";

function worldEnv() {
  return { ...env, SESSIONS: new TestStore(), AGENTS_ORIGIN: "https://agents.opendungeonmaster.com" };
}

function putWorld(e, body, secret = WORLD_SECRET, key = WORLD_KEY) {
  return worker.fetch(request("PUT", `/world/${key}`, { body, headers: { "x-world-secret": secret } }), e);
}

await test("a world key is claimed once and answers with its assistant link base", async () => {
  const e = worldEnv();
  const first = await putWorld(e, { url: PLAY, instanceId: "inst-12345678" });
  assert.equal(first.status, 200);
  assert.deepEqual(await first.json(), {
    key: WORLD_KEY,
    url: PLAY,
    relayUrl: `https://agents.opendungeonmaster.com/w/${WORLD_KEY}`,
  });
  const writes = e.SESSIONS.writes;
  assert.equal((await putWorld(e, { url: PLAY, instanceId: "inst-12345678" })).status, 200);
  assert.equal(e.SESSIONS.writes, writes, "the same address again costs no write");
  assert.equal((await putWorld(e, { url: "https://other-name.trycloudflare.com", instanceId: "inst-12345678" })).status, 200);
  assert.equal(e.SESSIONS.writes, writes + 1, "a moved address is written");
  const stolen = await putWorld(e, { url: PLAY, instanceId: "inst-12345678" }, "someone-elses-secret-000");
  assert.equal(stolen.status, 409);
  assert.equal((await worldRoute(e, WORLD_KEY)).url, "https://other-name.trycloudflare.com");
});

await test("a world can only point at a tunnel address, with its instance id", async () => {
  assert.equal(parseWorldUrl(PLAY + "/path", "opendungeonmaster.com"), PLAY);
  assert.equal(parseWorldUrl("https://abc-def.trycloudflare.com", "opendungeonmaster.com"), "https://abc-def.trycloudflare.com");
  for (const bad of [
    "http://play-abcd2345.opendungeonmaster.com",
    "https://broker.opendungeonmaster.com",
    "https://play-x.y.opendungeonmaster.com",
    "https://play-abcd2345.opendungeonmaster.com:8443",
    "https://example.com",
    "https://u:p@abc.trycloudflare.com",
  ]) {
    assert.equal(parseWorldUrl(bad, "opendungeonmaster.com"), null, bad);
  }
  const e = worldEnv();
  assert.equal((await putWorld(e, { url: "https://example.com", instanceId: "inst-12345678" })).status, 400);
  assert.equal((await putWorld(e, { url: PLAY })).status, 400, "instance id required");
  assert.equal((await putWorld(e, { url: PLAY, instanceId: "inst-12345678" }, "short")).status, 400);
  assert.equal((await putWorld(e, { url: PLAY, instanceId: "inst-12345678" }, WORLD_SECRET, "XYZ")).status, 400);
});

await test("dropping a world keeps its claim and a second drop is free", async () => {
  const e = worldEnv();
  await putWorld(e, { url: PLAY, instanceId: "inst-12345678" });
  const drop = () =>
    worker.fetch(request("DELETE", `/world/${WORLD_KEY}`, { headers: { "x-world-secret": WORLD_SECRET } }), e);
  assert.equal((await drop()).status, 200);
  const route = await worldRoute(e, WORLD_KEY);
  assert.deepEqual(route, { found: true, url: "", instanceId: "inst-12345678", paused: false });
  const writes = e.SESSIONS.writes;
  assert.equal((await drop()).status, 200);
  assert.equal(e.SESSIONS.writes, writes);
  const wrong = await worker.fetch(
    request("DELETE", `/world/${WORLD_KEY}`, { headers: { "x-world-secret": "nope-nope-nope-nope" } }),
    e,
  );
  assert.equal(wrong.status, 409);
  assert.equal((await putWorld(e, { url: PLAY, instanceId: "inst-12345678" }, "a-new-device-secret-00")).status, 409);
});

// A fake world behind a tunnel: answers the identity probe and the MCP
// endpoint, and records what reached it.
function fakeWorld({ instanceId = "inst-12345678", status = 200 } = {}) {
  const seen = [];
  const fetchImpl = async (url, init = {}) => {
    seen.push({ url: String(url), method: init.method || "GET", headers: new Headers(init.headers), body: init.body });
    if (String(url).endsWith("/api/auth/providers")) {
      return new Response(JSON.stringify({ instanceId }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response('{"jsonrpc":"2.0","id":1,"result":{}}', {
      status,
      headers: { "content-type": "application/json", "mcp-session-id": "s1", "www-authenticate": "Bearer", "set-cookie": "x=1" },
    });
  };
  return { seen, fetchImpl };
}

function relayCall(path = `/w/${WORLD_KEY}/${TOKEN}`, init = {}) {
  return new Request(`https://agents.opendungeonmaster.com${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", origin: "https://evil.example", cookie: "odm_session=abc" },
    body: '{"jsonrpc":"2.0","id":1,"method":"initialize"}',
    ...init,
  });
}

const ONLINE = { found: true, url: PLAY, instanceId: "inst-12345678", paused: false };

await test("an assistant link is forwarded to the world with its token as a bearer header", async () => {
  const world = fakeWorld();
  let lookups = 0;
  const relay = createRelay({ lookup: async () => (lookups++, ONLINE), fetch: world.fetchImpl });
  const response = await relay(relayCall(), {});
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("mcp-session-id"), "s1");
  assert.equal(response.headers.get("www-authenticate"), null);
  assert.equal(response.headers.get("set-cookie"), null);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const mcp = world.seen.find((call) => call.url === `${PLAY}/api/mcp`);
  assert.equal(mcp.method, "POST");
  assert.equal(mcp.headers.get("authorization"), `Bearer ${TOKEN}`);
  assert.equal(mcp.headers.get("origin"), null, "the world refuses browser origins");
  assert.equal(mcp.headers.get("cookie"), null);
  assert.equal(mcp.headers.get("accept"), "application/json, text/event-stream");
  assert.equal(new TextDecoder().decode(mcp.body), '{"jsonrpc":"2.0","id":1,"method":"initialize"}');
  await relay(relayCall(), {});
  assert.equal(lookups, 1, "the address is cached between calls");
  assert.equal(world.seen.filter((call) => call.url.endsWith("/api/auth/providers")).length, 1, "and so is the proof");
});

// The 2026-07-28 revision's standard headers: the world's MCP library answers
// 400 to a modern request without Mcp-Method, and to a tool call without
// Mcp-Name (or a declared Mcp-Param-<Name>).
await test("every Mcp- header reaches the world, so a 2026-07-28 client can call tools", async () => {
  const world = fakeWorld();
  const relay = createRelay({ lookup: async () => ONLINE, fetch: world.fetchImpl });
  const mcpHeaders = {
    "mcp-protocol-version": "2026-07-28",
    "mcp-method": "tools/call",
    "mcp-name": "list_campaigns",
    "mcp-param-region": "north",
  };
  const call = relayCall(undefined, {
    headers: { "content-type": "application/json", ...mcpHeaders, "cf-connecting-ip": "203.0.113.9", "x-forwarded-for": "203.0.113.9" },
    body: '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"list_campaigns","arguments":{}}}',
  });
  assert.equal((await relay(call, {})).status, 200);
  const mcp = world.seen.find((seen) => seen.url === `${PLAY}/api/mcp`);
  for (const [name, value] of Object.entries(mcpHeaders)) assert.equal(mcp.headers.get(name), value, name);
  assert.equal(mcp.headers.get("cf-connecting-ip"), null, "Cloudflare's own headers stay behind");
  assert.equal(mcp.headers.get("x-forwarded-for"), null);
});

await test("a token is never sent to an address that is not that world", async () => {
  const world = fakeWorld({ instanceId: "somebody-else" });
  const relay = createRelay({ lookup: async () => ONLINE, fetch: world.fetchImpl });
  const response = await relay(relayCall(), {});
  assert.equal(response.status, 503);
  assert.equal(world.seen.some((call) => call.url.endsWith("/api/mcp")), false);
});

await test("a stale cached address gets one fresh look before the world is called offline", async () => {
  let clock = 0;
  const answers = [ONLINE, { ...ONLINE, url: "https://next-one.trycloudflare.com" }];
  let lookups = 0;
  const world = fakeWorld();
  const fetchImpl = async (url, init) => {
    if (String(url).startsWith(PLAY) && lookups > 1) throw new Error("tunnel gone");
    return world.fetchImpl(url, init);
  };
  const relay = createRelay({ lookup: async () => answers[Math.min(lookups++, 1)], fetch: fetchImpl, now: () => clock });
  assert.equal((await relay(relayCall(), {})).status, 200);
  clock += 11 * 60_000; // the identity proof has lapsed, the address is re-checked
  assert.equal((await relay(relayCall(), {})).status, 200);
  assert.ok(world.seen.some((call) => call.url === "https://next-one.trycloudflare.com/api/mcp"));
});

await test("offline, unknown, paused and dead-tunnel worlds get a clear refusal", async () => {
  const world = fakeWorld();
  const offline = createRelay({ lookup: async () => ({ ...ONLINE, url: "" }), fetch: world.fetchImpl });
  const off = await offline(relayCall(), {});
  assert.equal(off.status, 503);
  assert.match((await off.json()).error, /offline/);
  const unknown = createRelay({ lookup: async () => ({ found: false, paused: false }), fetch: world.fetchImpl });
  assert.equal((await unknown(relayCall(), {})).status, 404);
  const paused = createRelay({ lookup: async () => ({ ...ONLINE, paused: true }), fetch: world.fetchImpl });
  const rest = await paused(relayCall(), {});
  assert.equal(rest.status, 503);
  assert.ok(Number(rest.headers.get("retry-after")) >= 60);
  assert.equal(world.seen.length, 0, "a paused relay forwards nothing");
  const dead = fakeWorld({ status: 530 });
  const tunnel = createRelay({ lookup: async () => ONLINE, fetch: dead.fetchImpl });
  assert.equal((await tunnel(relayCall(), {})).status, 503);
  const relay = createRelay({ lookup: async () => ONLINE, fetch: world.fetchImpl });
  assert.equal((await relay(relayCall("/w/not-a-key/odm_x"), {})).status, 404);
  assert.equal((await relay(relayCall(undefined, { method: "PUT" }), {})).status, 405);
  assert.equal(parseRelayPath(`/w/${WORLD_KEY}/not_a_token_shape_at_all`), null);
});

await test("the relay's limiters are keyed per world and for the whole relay", async () => {
  const seen = [];
  const limiter = (ok) => ({
    async limit({ key }) {
      seen.push(key);
      return { success: ok };
    },
  });
  const world = fakeWorld();
  const relay = createRelay({ lookup: async () => ONLINE, fetch: world.fetchImpl });
  assert.equal((await relay(relayCall(), { RELAY_WORLD: limiter(true), RELAY_ALL: limiter(true) })).status, 200);
  assert.deepEqual(seen, [WORLD_KEY, "all"]);
  const busy = await relay(relayCall(), { RELAY_WORLD: limiter(false), RELAY_ALL: limiter(true) });
  assert.equal(busy.status, 429);
  assert.equal(busy.headers.get("retry-after"), "60");
  assert.equal((await relay(relayCall(), { RELAY_WORLD: limiter(true), RELAY_ALL: limiter(false) })).status, 429);
});

await test("the kill switch trips past the daily cap, once, and lifts under it", async () => {
  const e = { ...worldEnv(), RELAY_DAILY_REQUEST_CAP: "1000" };
  const original = globalThis.fetch;
  let workers = 0;
  let objects = 0;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        data: { viewer: { accounts: [{ workers: [{ sum: { requests: workers } }, { sum: { requests: 1 } }], objects: [{ sum: { requests: objects } }] }] } },
      }),
    );
  try {
    workers = 400;
    objects = 300;
    assert.equal(await checkRelayUsage(e), 401);
    assert.equal((await worldRoute(e, WORLD_KEY)).paused, false);
    objects = 1200;
    assert.equal(await checkRelayUsage(e), 1200, "whichever counter is higher");
    assert.equal((await worldRoute(e, WORLD_KEY)).paused, true);
    const writes = e.SESSIONS.writes;
    await checkRelayUsage(e);
    assert.equal(e.SESSIONS.writes, writes, "an unchanged switch costs no write");
    e.RELAY_DAILY_REQUEST_CAP = "5000";
    await checkRelayUsage(e);
    assert.equal((await worldRoute(e, WORLD_KEY)).paused, false);
    globalThis.fetch = async () => new Response(JSON.stringify({ errors: [{ message: "no scope" }] }));
    assert.equal(await checkRelayUsage(e), null, "unreadable analytics changes nothing");
  } finally {
    globalThis.fetch = original;
  }
});

await test("the ten-minute schedule runs the kill switch and skips the hourly chores", async () => {
  const e = worldEnv();
  let sweeps = 0;
  e.SESSIONS.sweep = async () => {
    sweeps += 1;
    return 0;
  };
  await worker.scheduled({ cron: RELAY_CRON }, e);
  assert.equal(sweeps, 0);
  await worker.scheduled({ cron: "17 * * * *" }, e);
  assert.equal(sweeps, 1);
});

console.log(`\n${passed} checks passed`);
