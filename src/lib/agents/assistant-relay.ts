// Assistant links: the address a cloud assistant (ChatGPT, Claude, Grok,
// Meta Muse) saves for this world's MCP endpoint. Those assistants call from
// their own servers, months after the link was made, while a device world
// answers at a new tunnel hostname every share session. The tunnel broker
// keeps the join (workers/tunnel-broker/src/worlds.js): this world tells it
// "world K is at <publicUrl> now" whenever the address its app publishes
// changes, and the broker's relay forwards <relayUrl>/<token> to /api/mcp
// wherever the world is.
//
// Only device worlds take part. A server with an address of its own is
// reachable directly; the relay exists for the addresses that move, and
// every call through it counts against the broker's free plan.

import { randomBytes } from "node:crypto";
import { getAppSetting, getGlobalConfig, getInstanceId, setAppSetting } from "@/lib/db/app-settings";
import { isDeviceWorld, serverEnv } from "@/lib/server-env";

const STATE_KEY = "assistant_relay";
// The broker's row is refreshed once a day while the address stays put, so
// a world that has been shared for a long stretch is never forgotten.
const REFRESH_MS = 24 * 60 * 60 * 1000;
// A broker that could not be reached is asked again this much later, not
// every job tick: each attempt is a request against its daily allowance.
const RETRY_MS = 10 * 60 * 1000;
const TIMEOUT_MS = 8_000;

export type RelayState = {
  // 128 random bits naming this world at the broker; shown only inside its
  // players' assistant links.
  key: string;
  // Claims the key at the broker. Never leaves this server.
  secret: string;
  // The address the broker last took, "" when it holds none.
  url: string;
  // What every assistant link here starts with, as the broker said.
  relayUrl: string;
  at: number;
};

export type RelayStep = { kind: "register"; url: string } | { kind: "drop" } | { kind: "none" };

// The address worth registering: the world's public address when it is a
// public https one (the shells publish the tunnel's while sharing and the
// Wi-Fi address, plain http, while sharing in the room only).
export function relayTarget(publicUrl: string | null | undefined): string {
  try {
    const url = new URL((publicUrl ?? "").trim());
    return url.protocol === "https:" ? url.origin : "";
  } catch {
    return "";
  }
}

// What one pass should do, given what the broker last heard. Pure, for tests.
export function relayStep(state: Pick<RelayState, "url" | "at">, publicUrl: string | null | undefined, now: number): RelayStep {
  const target = relayTarget(publicUrl);
  if (target) {
    return state.url !== target || now - state.at >= REFRESH_MS ? { kind: "register", url: target } : { kind: "none" };
  }
  return state.url ? { kind: "drop" } : { kind: "none" };
}

function readState(): RelayState | null {
  const stored = getAppSetting<Partial<RelayState> | null>(STATE_KEY, null);
  if (typeof stored?.key !== "string" || typeof stored?.secret !== "string") return null;
  return {
    key: stored.key,
    secret: stored.secret,
    url: typeof stored.url === "string" ? stored.url : "",
    relayUrl: typeof stored.relayUrl === "string" ? stored.relayUrl : "",
    at: Number(stored.at) || 0,
  };
}

function loadState(): RelayState {
  const existing = readState();
  if (existing) return existing;
  const minted: RelayState = {
    key: randomBytes(16).toString("hex"),
    secret: randomBytes(24).toString("hex"),
    url: "",
    relayUrl: "",
    at: 0,
  };
  setAppSetting(STATE_KEY, minted);
  return minted;
}

// What this world's assistant links start with, or "" where there are none:
// not a device world, or never yet registered while shared online.
export function assistantRelayUrl(): string {
  return isDeviceWorld() ? (readState()?.relayUrl ?? "") : "";
}

function brokerBase(): string {
  // The broker the voice mesh already asks for ICE servers (src/lib/voice/mesh.ts).
  return serverEnv("ODM_ICE_BROKER_URL", "https://broker.opendungeonmaster.com").replace(/\/+$/, "");
}

declare global {
  var __odmAssistantRelay: { running: boolean; failedAt: number } | undefined;
}

// One pass, from the job loop every minute. Costs nothing over the network
// unless the address moved, a day went by, or sharing stopped.
export async function syncAssistantRelay(
  now = Date.now(),
  fetchImpl: typeof fetch = fetch,
): Promise<RelayStep["kind"] | "skipped" | "failed"> {
  if (!isDeviceWorld()) return "skipped";
  const gate = (globalThis.__odmAssistantRelay ??= { running: false, failedAt: 0 });
  if (gate.running || (gate.failedAt && now - gate.failedAt < RETRY_MS)) return "skipped";
  const state = loadState();
  const step = relayStep(state, getGlobalConfig().publicUrl, now);
  if (step.kind === "none") return "none";
  gate.running = true;
  try {
    const endpoint = `${brokerBase()}/world/${state.key}`;
    const response =
      step.kind === "register"
        ? await fetchImpl(endpoint, {
            method: "PUT",
            headers: { "content-type": "application/json", "x-world-secret": state.secret },
            body: JSON.stringify({ url: step.url, instanceId: getInstanceId() }),
            signal: AbortSignal.timeout(TIMEOUT_MS),
          })
        : await fetchImpl(endpoint, {
            method: "DELETE",
            headers: { "x-world-secret": state.secret },
            signal: AbortSignal.timeout(TIMEOUT_MS),
          });
    if (!response.ok) {
      gate.failedAt = now;
      return "failed";
    }
    if (step.kind === "register") {
      const body = (await response.json().catch(() => null)) as { relayUrl?: unknown } | null;
      const relayUrl =
        typeof body?.relayUrl === "string" && body.relayUrl.startsWith("https://") ? body.relayUrl : state.relayUrl;
      setAppSetting(STATE_KEY, { ...state, url: step.url, relayUrl, at: now });
    } else {
      setAppSetting(STATE_KEY, { ...state, url: "", at: now });
    }
    gate.failedAt = 0;
    return step.kind;
  } catch {
    gate.failedAt = now;
    return "failed";
  } finally {
    gate.running = false;
  }
}
