// Helpers shared by the broker's handlers (src/broker.js) and the world
// registry (src/worlds.js).

export const API = "https://api.cloudflare.com/client/v4";

const CREATES_PER_DAY = 20;

export async function sha256Hex(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

// The per-address counters are keyed by a salted SHA-256 of the address, so
// the store never holds a caller's IP. RATE_LIMIT_SALT is a Worker secret
// (wrangler secret put RATE_LIMIT_SALT); the counters still work without it,
// unsalted, which is the only fallback that keeps abuse limits on.
export async function rateLimited(env, ip, kind = "ip", cap = CREATES_PER_DAY) {
  const subject = await sha256Hex(`${env.RATE_LIMIT_SALT || ""}:${ip}`);
  const key = `${kind}:${subject.slice(0, 32)}:${new Date().toISOString().slice(0, 10)}`;
  const used = Number((await env.SESSIONS.get(key)) || "0");
  if (used >= cap) return true;
  await env.SESSIONS.put(key, String(used + 1), { expirationTtl: 86_400 });
  return false;
}
