import { getDatabase, nowIso, parseJson } from "@/lib/db/core";
import { allocateSeq } from "@/lib/db/campaigns";

type Subscriber = (chunk: string) => void;

// The bus must live on globalThis: in `next dev`, HMR re-evaluates modules
// and a module-scoped map would silently drop subscribers.
declare global {
  var __odmEventBus: Map<string, Set<Subscriber>> | undefined;
  // Set by src/lib/voice/peers.ts the first time anything voice-related is
  // loaded. Undefined on a server where voice has never been used, in which
  // case the calls below are no-ops.
  var __odmVoiceEventHook: ((campaignId: string, type: string) => void) | undefined;
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
  globalThis.__odmVoiceEventHook?.(campaignId, type);
  return seq;
}

export function publishPersisted(campaignId: string, type: string, payload: unknown) {
  return publishWithSeq(campaignId, allocateSeq(campaignId), type, payload);
}

// Ephemeral events (streaming deltas, DM status) skip persistence and carry
// no id, so EventSource reconnects do not replay them. Note: SSE offers no
// way to clear the browser's last-event-id buffer, so on the client these
// events still arrive with the previous persisted event's lastEventId; the
// stream hook must ignore lastEventId for ephemeral event types.
export function publishEphemeral(campaignId: string, type: string, payload: unknown) {
  fanOut(campaignId, sseChunk(type, payload));
  globalThis.__odmVoiceEventHook?.(campaignId, type);
}

// Voice reacts to things the rest of the app already announces: the floor
// changing decides who may speak, and a token moving or a fight starting
// decides who can hear whom. Those events are published from more than a dozen
// call sites between them, and these two functions are the only points they
// all pass through, so the hook lives here rather than at every site where the
// next one added would forget it.
//
// Registered through globalThis, and dispatched through a dynamic import on
// the voice side, so this low-level module imports nothing from the voice
// layer and there is no cycle.

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
