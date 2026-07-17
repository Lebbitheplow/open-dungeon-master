import { getDatabase, nowIso, parseJson } from "@/lib/db/core";
import { allocateSeq } from "@/lib/db/campaigns";

type Subscriber = (chunk: string) => void;

// The bus must live on globalThis: in `next dev`, HMR re-evaluates modules
// and a module-scoped map would silently drop subscribers.
declare global {
  var __odmEventBus: Map<string, Set<Subscriber>> | undefined;
}

function bus() {
  return (globalThis.__odmEventBus ??= new Map<string, Set<Subscriber>>());
}

export function subscribe(campaignId: string, subscriber: Subscriber): () => void {
  let subscribers = bus().get(campaignId);
  if (!subscribers) {
    subscribers = new Set();
    bus().set(campaignId, subscribers);
  }
  subscribers.add(subscriber);
  return () => {
    subscribers.delete(subscriber);
    if (subscribers.size === 0) {
      bus().delete(campaignId);
    }
  };
}

export function sseChunk(type: string, payload: unknown, id?: number) {
  const idLine = id === undefined ? "" : `id: ${id}\n`;
  return `${idLine}event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;
}

function fanOut(campaignId: string, chunk: string) {
  const subscribers = bus().get(campaignId);
  if (!subscribers) {
    return;
  }
  for (const subscriber of subscribers) {
    try {
      subscriber(chunk);
    } catch {
      subscribers.delete(subscriber);
    }
  }
}

// Persisted events are replayable after reconnect and carry an SSE id (the
// campaign seq). Use publishWithSeq when the seq was already allocated so a
// row (e.g. a campaign message) can share it.
export function publishWithSeq(campaignId: string, seq: number, type: string, payload: unknown) {
  getDatabase()
    .prepare(
      `INSERT INTO campaign_events (campaign_id, seq, type, payload_json, created_at) VALUES (?, ?, ?, ?, ?)`,
    )
    .run(campaignId, seq, type, JSON.stringify(payload), nowIso());
  fanOut(campaignId, sseChunk(type, payload, seq));
  return seq;
}

export function publishPersisted(campaignId: string, type: string, payload: unknown) {
  return publishWithSeq(campaignId, allocateSeq(campaignId), type, payload);
}

// Ephemeral events (streaming deltas, DM status) skip persistence and carry
// no id, so EventSource reconnects do not replay them.
export function publishEphemeral(campaignId: string, type: string, payload: unknown) {
  fanOut(campaignId, sseChunk(type, payload));
}

export type StoredEvent = { seq: number; type: string; payload: unknown };

export function listEventsSince(campaignId: string, afterSeq: number, limit = 500): StoredEvent[] {
  const rows = getDatabase()
    .prepare(
      `
        SELECT seq, type, payload_json FROM campaign_events
        WHERE campaign_id = ? AND seq > ?
        ORDER BY seq ASC LIMIT ?
      `,
    )
    .all(campaignId, afterSeq, limit) as Array<{ seq: number; type: string; payload_json: string }>;
  return rows.map((row) => ({
    seq: row.seq,
    type: row.type,
    payload: parseJson<unknown>(row.payload_json, null),
  }));
}
