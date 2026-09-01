// The tunnel broker: gives a desktop app hosting a session a pretty, stable
// address (CODE.play.opendungeonmaster.com) instead of a random
// trycloudflare.com name.
//
// Flow: the app POSTs /session with the local port its bundled server
// listens on. The broker uses a scoped API token to create a remotely
// managed Cloudflare Tunnel, points CODE.play at it, and returns the tunnel
// token; the app runs `cloudflared tunnel run --token ...` and the world is
// reachable. Sessions die by DELETE (the app closing) or by the hourly cron
// after MAX_AGE_MS, so abandoned tunnels and DNS records never pile up.
//
// SECURITY: the API token lives in a Worker secret, scoped to Tunnel:Edit
// and this zone's DNS:Edit only. Creation is open but rate limited per IP;
// a session can only be torn down early with the secret returned at
// creation (stored hashed). Codes use the invite alphabet, so a hostname
// never collides with meaningful subdomains.

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 8;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const CREATES_PER_DAY = 20;
const API = "https://api.cloudflare.com/client/v4";

function randomCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
  let code = "";
  for (const byte of bytes) code += CODE_ALPHABET[byte % CODE_ALPHABET.length];
  return code;
}

export function parsePort(raw) {
  const port = Number(raw);
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : null;
}

export function parseCode(raw) {
  if (typeof raw !== "string") return null;
  const code = raw.trim().toUpperCase();
  return new RegExp(`^[${CODE_ALPHABET}]{${CODE_LENGTH}}$`).test(code) ? code : null;
}

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function cfApi(env, method, path, body) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${env.CF_API_TOKEN}`,
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data || data.success === false) {
    const detail = data?.errors?.[0]?.message || `${response.status}`;
    throw new Error(`Cloudflare API ${method} ${path} failed: ${detail}`);
  }
  return data.result;
}

// The zone id is looked up once from the zone's name (the scoped token can
// list the zone it edits) and cached in KV forever.
async function zoneId(env) {
  const cached = await env.SESSIONS.get("zone-id");
  if (cached) return cached;
  const zones = await cfApi(env, "GET", `/zones?name=${env.ZONE_NAME}`);
  const id = Array.isArray(zones) ? zones[0]?.id : undefined;
  if (!id) throw new Error(`Zone ${env.ZONE_NAME} is not visible to the API token.`);
  await env.SESSIONS.put("zone-id", id);
  return id;
}

async function rateLimited(env, ip, kind = "ip", cap = CREATES_PER_DAY) {
  const key = `${kind}:${ip}:${new Date().toISOString().slice(0, 10)}`;
  const used = Number((await env.SESSIONS.get(key)) || "0");
  if (used >= cap) return true;
  await env.SESSIONS.put(key, String(used + 1), { expirationTtl: 86_400 });
  return false;
}

// ICE servers for mesh voice. Every response carries Cloudflare's free STUN;
// when a Realtime TURN key is configured (secrets TURN_KEY_ID and
// TURN_API_TOKEN), short-lived TURN credentials ride along so peers behind
// hostile NATs still connect. Relay traffic bills against the Realtime free
// tier, hence the tighter per-IP cap.
async function iceServers(env, request) {
  const stun = { urls: ["stun:stun.cloudflare.com:3478"] };
  if (!env.TURN_KEY_ID || !env.TURN_API_TOKEN) {
    return json({ iceServers: [stun] });
  }
  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  if (await rateLimited(env, ip, "turn", 50)) {
    return json({ iceServers: [stun] });
  }
  const response = await fetch(
    `https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_KEY_ID}/credentials/generate-ice-servers`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.TURN_API_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ ttl: 4 * 60 * 60 }),
    },
  );
  const body = await response.json().catch(() => null);
  if (!response.ok || !Array.isArray(body?.iceServers)) {
    return json({ iceServers: [stun] });
  }
  return json({ iceServers: [stun, ...body.iceServers] });
}

async function createSession(env, request) {
  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  if (await rateLimited(env, ip)) {
    return json({ error: "Too many sessions today. Try again tomorrow." }, 429);
  }
  const body = await request.json().catch(() => ({}));
  const port = parsePort(body?.port);
  if (!port) {
    return json({ error: "Send the local port your server listens on." }, 400);
  }

  const code = randomCode();
  const hostname = `${code.toLowerCase()}.play.${env.ZONE_NAME}`;
  const secret = [...crypto.getRandomValues(new Uint8Array(24))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

  const tunnel = await cfApi(env, "POST", `/accounts/${env.ACCOUNT_ID}/cfd_tunnel`, {
    name: `odm-${code}`,
    config_src: "cloudflare",
  });
  const tunnelToken = await cfApi(
    env,
    "GET",
    `/accounts/${env.ACCOUNT_ID}/cfd_tunnel/${tunnel.id}/token`,
  );
  await cfApi(env, "PUT", `/accounts/${env.ACCOUNT_ID}/cfd_tunnel/${tunnel.id}/configurations`, {
    config: {
      ingress: [
        { hostname, service: `http://127.0.0.1:${port}` },
        { service: "http_status:404" },
      ],
    },
  });
  const record = await cfApi(env, "POST", `/zones/${await zoneId(env)}/dns_records`, {
    type: "CNAME",
    name: hostname,
    content: `${tunnel.id}.cfargotunnel.com`,
    proxied: true,
  });

  await env.SESSIONS.put(
    `session:${code}`,
    JSON.stringify({
      tunnelId: tunnel.id,
      dnsRecordId: record.id,
      secretHash: await sha256Hex(secret),
      createdAt: Date.now(),
    }),
    { expirationTtl: (MAX_AGE_MS / 1000) * 2 },
  );

  return json({ code, hostname, url: `https://${hostname}`, tunnelToken, secret });
}

async function destroySession(env, code, session) {
  // Order matters: DNS first so the name dies even if tunnel cleanup fails.
  const zone = await zoneId(env).catch(() => null);
  if (zone) {
    await cfApi(env, "DELETE", `/zones/${zone}/dns_records/${session.dnsRecordId}`).catch(
      () => undefined,
    );
  }
  await cfApi(
    env,
    "DELETE",
    `/accounts/${env.ACCOUNT_ID}/cfd_tunnel/${session.tunnelId}/connections`,
  ).catch(() => undefined);
  await cfApi(env, "DELETE", `/accounts/${env.ACCOUNT_ID}/cfd_tunnel/${session.tunnelId}`).catch(
    () => undefined,
  );
  await env.SESSIONS.delete(`session:${code}`);
}

async function deleteSession(env, request, rawCode) {
  const code = parseCode(rawCode);
  if (!code) return json({ error: "Bad session code." }, 400);
  const stored = await env.SESSIONS.get(`session:${code}`);
  if (!stored) return json({ error: "No such session." }, 404);
  const session = JSON.parse(stored);
  const secret = request.headers.get("x-session-secret") || "";
  if ((await sha256Hex(secret)) !== session.secretHash) {
    return json({ error: "Wrong session secret." }, 403);
  }
  await destroySession(env, code, session);
  return json({ ok: true });
}

async function purgeExpired(env) {
  const list = await env.SESSIONS.list({ prefix: "session:" });
  for (const key of list.keys) {
    const stored = await env.SESSIONS.get(key.name);
    if (!stored) continue;
    const session = JSON.parse(stored);
    if (Date.now() - session.createdAt > MAX_AGE_MS) {
      await destroySession(env, key.name.slice("session:".length), session);
    }
  }
}

const worker = {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (request.method === "GET" && url.pathname === "/turn") {
        return await iceServers(env, request);
      }
      if (request.method === "POST" && url.pathname === "/session") {
        return await createSession(env, request);
      }
      const match = url.pathname.match(/^\/session\/([^/]+)$/);
      if (request.method === "DELETE" && match) {
        return await deleteSession(env, request, match[1]);
      }
    } catch (err) {
      console.error(err);
      return json({ error: "The broker hit a Cloudflare API error. Try again." }, 502);
    }
    return json({ error: "Not found." }, 404);
  },

  async scheduled(_event, env) {
    await purgeExpired(env);
  },
};

export default worker;
