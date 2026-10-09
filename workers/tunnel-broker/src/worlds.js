// The world registry, and the kill switch on the assistant relay that reads
// it (src/relay.js).
//
// A cloud assistant (ChatGPT, Claude, Grok, Meta Muse) saves one address for
// a world's MCP endpoint and calls it from its own servers for months. A
// device world answers at a new tunnel hostname every share session, so the
// join the table registry makes for room codes is made here for that
// address: the world's own server writes "world K is at <url> right now"
// whenever the address its app publishes changes (src/lib/agents/
// assistant-relay.ts in the app), and the relay reads it back.
//
// K is 128 random bits the world minted for itself and only ever shows its
// own players, inside their assistant links, so there is nothing to guess or
// squat. It is claimed on first write with a secret that never leaves the
// world's server, the rule a table code follows, so a player holding a link
// can call through it but never re-point it.
import { API, json, rateLimited, sha256Hex } from "./util.js";

const WORLD_TTL_S = 400 * 86_400;
const WORLD_REFRESH_MS = 86_400 * 1000;
const WORLD_CLAIMS_PER_DAY = 20;
const WORLD_KEY_SHAPE = /^[a-f0-9]{32}$/;
const INSTANCE_SHAPE = /^[A-Za-z0-9-]{8,64}$/;

// The cron line the kill switch runs on; the hourly chores skip it.
export const RELAY_CRON = "*/10 * * * *";
// Account-wide Worker (or Durable Object) requests in a UTC day past which
// the relay stops forwarding until midnight. Half the free plan's 100,000:
// whatever assistants do, sharing, room codes and voice keep the other half.
export const RELAY_DAILY_REQUEST_CAP = 50_000;

export function parseWorldKey(raw) {
  if (typeof raw !== "string") return null;
  const key = raw.trim().toLowerCase();
  return WORLD_KEY_SHAPE.test(key) ? key : null;
}

// Only the addresses a device world is shared at: a broker hostname one
// label under the zone, or a quick tunnel. A server with an address of its
// own does not need the relay, and an entry that could name any host would
// make the relay an open proxy.
export function parseWorldUrl(raw, zone) {
  if (typeof raw !== "string" || raw.length > 300) return null;
  let url;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
  const host = url.hostname.toLowerCase();
  const suffix = `.${String(zone || "").toLowerCase()}`;
  const play = Boolean(zone) && host.endsWith(suffix) && /^play-[a-z0-9]+$/.test(host.slice(0, -suffix.length));
  const quick = /^[a-z0-9-]+\.trycloudflare\.com$/.test(host);
  return play || quick ? url.origin : null;
}

function dayKey() {
  return new Date().toISOString().slice(0, 10);
}

async function readWorld(env, key) {
  const raw = await env.SESSIONS.get(`world:${key}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function relayUrlFor(env, request, key) {
  const origin = env.AGENTS_ORIGIN || new URL(request.url).origin;
  return `${origin.replace(/\/+$/, "")}/w/${key}`;
}

// The world's server calls this whenever its shared address changes and
// once a day while it stays put. The answer carries the relay address its
// players' assistant links start with.
export async function putWorld(env, request, rawKey) {
  const key = parseWorldKey(rawKey);
  if (!key) return json({ error: "Bad world key." }, 400);
  const secret = request.headers.get("x-world-secret") || "";
  if (secret.length < 16 || secret.length > 128) {
    return json({ error: "Bad world secret." }, 400);
  }
  const body = await request.json().catch(() => ({}));
  const url = parseWorldUrl(body?.url, env.ZONE_NAME);
  if (!url) return json({ error: "Send the tunnel address the world is shared at." }, 400);
  const instanceId = typeof body?.instanceId === "string" ? body.instanceId : "";
  if (!INSTANCE_SHAPE.test(instanceId)) return json({ error: "Send the world's instance id." }, 400);
  const secretHash = await sha256Hex(secret);
  const existing = await readWorld(env, key);
  if (existing && existing.secretHash !== secretHash) {
    return json({ error: "That world key is claimed by another world." }, 409);
  }
  if (!existing) {
    const ip = request.headers.get("cf-connecting-ip") || "unknown";
    if (await rateLimited(env, ip, "world", WORLD_CLAIMS_PER_DAY)) {
      return json({ error: "Too many worlds registered today. Try again tomorrow." }, 429);
    }
  }
  // Same economy as a table: a PUT that changes nothing is answered from
  // the read, and the row is rewritten only when the address moves or has
  // gone a day without a refresh.
  const now = Date.now();
  const fresh =
    existing &&
    existing.url === url &&
    existing.instanceId === instanceId &&
    typeof existing.at === "number" &&
    now - existing.at < WORLD_REFRESH_MS;
  if (!fresh) {
    await env.SESSIONS.put(`world:${key}`, JSON.stringify({ url, instanceId, secretHash, at: now }), {
      expirationTtl: WORLD_TTL_S,
    });
  }
  return json({ key, url, relayUrl: relayUrlFor(env, request, key) });
}

// Sharing stopped: the relay answers "offline" instead of forwarding to a
// dead address. The claim survives for the next share, as a table's does.
export async function dropWorld(env, request, rawKey) {
  const key = parseWorldKey(rawKey);
  if (!key) return json({ error: "Bad world key." }, 400);
  const entry = await readWorld(env, key);
  if (!entry) return json({ key, dropped: true });
  const secretHash = await sha256Hex(request.headers.get("x-world-secret") || "");
  if (entry.secretHash !== secretHash) {
    return json({ error: "That world key is claimed by another world." }, 409);
  }
  if (!entry.url) return json({ key, dropped: true });
  await env.SESSIONS.put(`world:${key}`, JSON.stringify({ ...entry, url: "", at: Date.now() }), {
    expirationTtl: WORLD_TTL_S,
  });
  return json({ key, dropped: true });
}

// What the relay needs for one world: where it is, who it claims to be, and
// whether the kill switch is on. Reached only through the Durable Object's
// RPC method (src/index.js), never over HTTP, so a key never resolves to an
// address for anyone outside the Worker.
export async function worldRoute(env, rawKey) {
  const paused = Boolean(await env.SESSIONS.get(`relay-paused:${dayKey()}`));
  const key = parseWorldKey(rawKey);
  const entry = key ? await readWorld(env, key) : null;
  if (!entry) return { found: false, url: "", instanceId: "", paused };
  return { found: true, url: entry.url || "", instanceId: entry.instanceId || "", paused };
}

// The kill switch. Every ten minutes the account's requests so far today
// (every Worker, and the Durable Object, which counts on its own) are read
// from analytics; past the cap the relay stops forwarding until the UTC day
// rolls over, which is when the free plan's allowance resets too. Reading
// analytics needs Account > Account Analytics > Read on CF_API_TOKEN, the
// same scope the TURN egress check uses; without it the switch never
// trips and the edge rate limits in src/relay.js are the only bound.
// Returns the count it saw, or null when analytics could not be read.
export async function checkRelayUsage(env) {
  if (!env.CF_API_TOKEN || !env.ACCOUNT_ID) return null;
  const cap = Number(env.RELAY_DAILY_REQUEST_CAP || RELAY_DAILY_REQUEST_CAP);
  const day = dayKey();
  let used;
  try {
    const response = await fetch(`${API}/graphql`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.CF_API_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        query: `query($account: String!, $day: Date!) {
          viewer { accounts(filter: { accountTag: $account }) {
            workers: workersInvocationsAdaptive(filter: { date_geq: $day, date_leq: $day }, limit: 1000) {
              sum { requests }
            }
            objects: durableObjectsInvocationsAdaptiveGroups(filter: { date_geq: $day, date_leq: $day }, limit: 1000) {
              sum { requests }
            }
          } }
        }`,
        variables: { account: env.ACCOUNT_ID, day },
      }),
    });
    const body = await response.json().catch(() => null);
    const account = body?.data?.viewer?.accounts?.[0];
    if (!account) return null;
    const total = (rows) =>
      Array.isArray(rows) ? rows.reduce((sum, row) => sum + (row?.sum?.requests || 0), 0) : 0;
    used = Math.max(total(account.workers), total(account.objects));
  } catch {
    return null;
  }
  // Compared before it is touched: six runs an hour must not cost six
  // writes an hour when nothing changed.
  const key = `relay-paused:${day}`;
  const paused = Boolean(await env.SESSIONS.get(key));
  if (used >= cap && !paused) {
    await env.SESSIONS.put(key, String(used), { expirationTtl: 2 * 86_400 });
  } else if (used < cap && paused) {
    await env.SESSIONS.delete(key);
  }
  return used;
}
