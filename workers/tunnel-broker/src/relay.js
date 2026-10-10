// The assistant relay: the one address a cloud assistant (ChatGPT, Claude,
// Grok, Meta Muse) saves for a world, agents.opendungeonmaster.com/w/<world
// key>/<token>, forwarded to the MCP endpoint wherever that world answers
// right now (src/worlds.js keeps the join).
//
// The token rides in the path because every one of those assistants takes a
// bare URL for a custom connector and only some take a header. It is a
// connection grant (src/lib/agents/grants.ts in the app): scoped to what its
// player ticked, revocable from Settings, expiring on its own. The relay
// moves it into the Authorization header and never logs or stores it.
//
// Two safeguards keep agent traffic off the free plan's daily request
// allowance that sharing itself runs on. Edge rate limits per world and for
// the relay as a whole (RELAY_WORLD, RELAY_ALL; storage-free), checked
// instead of the broker's per-address gate, because every ChatGPT user's
// calls arrive from the same few OpenAI addresses. And the kill switch in
// src/worlds.js, which stops forwarding for the rest of the UTC day once the
// account has spent half its allowance.

import { json } from "./util.js";

const PATH = /^\/w\/([a-f0-9]{32})\/(odm_[A-Za-z0-9_-]{16,200})\/?$/;
const LOOKUP_TTL_MS = 60_000;
const IDENTITY_TTL_MS = 10 * 60_000;
const PROBE_TIMEOUT_MS = 5_000;
const MAX_BODY_BYTES = 1_000_000;
const METHODS = new Set(["POST", "GET", "DELETE"]);
// What an MCP client sends that the world needs: these, and every header of
// MCP's own Mcp- family. The 2026-07-28 revision puts Mcp-Method on every
// request, Mcp-Name on tool calls and Mcp-Param-<Name> on some, and the
// world's MCP library refuses a request missing one, so a list of them by
// name breaks again with the next revision. Never Origin (the world refuses
// browser origins), cookies or Cloudflare's own headers.
const FORWARD_HEADERS = new Set(["accept", "content-type", "last-event-id", "user-agent"]);
const MCP_HEADER_PREFIX = "mcp-";
// WWW-Authenticate stays behind: on a revoked token it would send the
// assistant hunting for an OAuth server the relay does not have.
const RETURN_HEADERS = ["content-type", "mcp-session-id"];
// What Cloudflare answers for a tunnel nobody is running.
const TUNNEL_DOWN = new Set([502, 504, 520, 521, 522, 523, 524, 525, 526, 530]);

const OFFLINE = "This world is offline right now. Its assistant link answers whenever its host shares it.";

export function isRelayPath(pathname) {
  return pathname === "/w" || pathname.startsWith("/w/");
}

export function parseRelayPath(pathname) {
  const match = PATH.exec(pathname);
  return match ? { key: match[1], token: match[2] } : null;
}

function secondsToUtcMidnight(now) {
  const next = new Date(now);
  next.setUTCHours(24, 0, 0, 0);
  return Math.max(60, Math.ceil((next.getTime() - now) / 1000));
}

// lookup(env, key) resolves a world through the Durable Object. Each isolate
// keeps a world's address for a minute and the proof that the address is
// that world for ten, so a busy agent costs the Durable Object one call a
// minute rather than one per tool call.
export function createRelay({ lookup, fetch: fetchImpl = (...args) => fetch(...args), now = Date.now }) {
  const routes = new Map();
  const proven = new Map();

  async function route(env, key, fresh) {
    const cached = routes.get(key);
    if (!fresh && cached && now() - cached.at < LOOKUP_TTL_MS) return cached.world;
    const world = await lookup(env, key);
    routes.set(key, { world, at: now() });
    return world;
  }

  // The world at an address says who it is at /api/auth/providers. play-CODE
  // hostnames are recycled between sessions, so an address on file is not
  // proof of anything, and a token must never be posted to whoever answers
  // there now (the rule the apps' relocateWorld follows too).
  async function sameWorld(world) {
    const id = `${world.url} ${world.instanceId}`;
    const seen = proven.get(id);
    if (seen && now() - seen < IDENTITY_TTL_MS) return true;
    try {
      const response = await fetchImpl(`${world.url}/api/auth/providers`, {
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      });
      const body = response.ok ? await response.json().catch(() => null) : null;
      if (!world.instanceId || body?.instanceId !== world.instanceId) return false;
    } catch {
      return false;
    }
    proven.set(id, now());
    return true;
  }

  function forget(key, world) {
    routes.delete(key);
    if (world) proven.delete(`${world.url} ${world.instanceId}`);
  }

  return async function relay(request, env) {
    const target = parseRelayPath(new URL(request.url).pathname);
    if (!target) return json({ error: "That is not an Open Dungeon Master assistant link." }, 404);
    if (!METHODS.has(request.method)) {
      return json({ error: "Method not allowed." }, 405, { allow: "POST, GET, DELETE" });
    }
    for (const [limiter, key] of [
      [env.RELAY_WORLD, target.key],
      [env.RELAY_ALL, "all"],
    ]) {
      if (!limiter?.limit) continue;
      const { success } = await limiter.limit({ key });
      if (!success) {
        return json({ error: "Too many calls through this link. Try again in a minute." }, 429, { "retry-after": "60" });
      }
    }
    const length = Number.parseInt(request.headers.get("content-length") || "0", 10);
    if (Number.isFinite(length) && length > MAX_BODY_BYTES) return json({ error: "Request too large." }, 413);
    const body = request.method === "POST" ? await request.arrayBuffer() : undefined;
    if (body && body.byteLength > MAX_BODY_BYTES) return json({ error: "Request too large." }, 413);

    let world = await route(env, target.key, false);
    if (!world?.found) return json({ error: "This assistant link does not lead to any world." }, 404);
    if (world.paused) {
      return json(
        { error: "Assistant links are resting for the day across every world. They are back at midnight UTC." },
        503,
        { "retry-after": String(secondsToUtcMidnight(now())) },
      );
    }
    // A cached address may be a minute stale; one fresh look before giving up.
    if (!world.url || !(await sameWorld(world))) {
      forget(target.key, world);
      world = await route(env, target.key, true);
      if (!world?.found || world.paused || !world.url || !(await sameWorld(world))) {
        return json({ error: OFFLINE }, 503, { "retry-after": "60" });
      }
    }

    const headers = new Headers();
    for (const [name, value] of request.headers) {
      if (value && (FORWARD_HEADERS.has(name) || name.startsWith(MCP_HEADER_PREFIX))) headers.set(name, value);
    }
    headers.set("authorization", `Bearer ${target.token}`);
    let upstream;
    try {
      upstream = await fetchImpl(`${world.url}/api/mcp`, {
        method: request.method,
        headers,
        body,
        redirect: "manual",
      });
    } catch {
      forget(target.key, world);
      return json({ error: OFFLINE }, 503, { "retry-after": "60" });
    }
    if (TUNNEL_DOWN.has(upstream.status)) {
      forget(target.key, world);
      return json({ error: OFFLINE }, 503, { "retry-after": "60" });
    }
    const out = new Headers({ "cache-control": "no-store" });
    for (const name of RETURN_HEADERS) {
      const value = upstream.headers.get(name);
      if (value) out.set(name, value);
    }
    return new Response(upstream.body, { status: upstream.status, headers: out });
  };
}
