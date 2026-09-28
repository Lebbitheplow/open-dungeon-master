import { getDatabase, nowIso, parseJson } from "@/lib/db/core";
import { allocateSeq } from "@/lib/db/campaigns";
import { isSeatOnly, payloadForViewer, tablePayload, viewerFor, type Viewer } from "@/lib/table-delivery";

type Subscriber = (chunk: string) => void;

// Who is listening, for the events that are not the same for every seat
// (src/lib/table-delivery.ts). Keyed by the listener itself so the bus can
// stay a plain set; a listener nobody vouched for is sent the table's view.
const listenerUserIds = new WeakMap<Subscriber, string>();

// The bus must live on globalThis: in `next dev`, HMR re-evaluates modules
// and a module-scoped map would silently drop subscribers.
declare global {
  var __odmEventBus: Map<string, Set<Subscriber>> | undefined;
  // Presence: who has the campaign open in a live tab, as connection counts
  // per user so a second tab does not read as a second person and closing
  // one of two tabs does not read as leaving. Distinct from the voice
  // roster, which is who is on the call.
  var __odmPresenceCounts: Map<string, Map<string, number>> | undefined;
  // Set by src/lib/voice/peers.ts the first time anything voice-related is
  // loaded. Undefined on a server where voice has never been used, in which
  // case the calls below are no-ops.
  var __odmVoiceEventHook: ((campaignId: string, type: string) => void) | undefined;
}

function bus() {
  return (globalThis.__odmEventBus ??= new Map<string, Set<Subscriber>>());
}

function presenceCounts() {
  return (globalThis.__odmPresenceCounts ??= new Map<string, Map<string, number>>());
}

export function onlineUserIds(campaignId: string): string[] {
  return Array.from(presenceCounts().get(campaignId)?.keys() ?? []);
}

// The whole online set each time, voice_roster style, so a dropped event
// self-heals on the next join or leave. Fanned out directly rather than via
// publishEphemeral because presence is not a game event and the voice layer
// keeps its own roster.
function announcePresence(campaignId: string) {
  fanOut(campaignId, sseChunk("presence", { online: onlineUserIds(campaignId) }));
}

// userId ties the connection to presence. It is passed by the events route,
// which has already authenticated the member; a subscriber without one does
// not count as anybody being online.
export function subscribe(
  campaignId: string,
  subscriber: Subscriber,
  userId?: string,
): () => void {
  let subscribers = bus().get(campaignId);
  if (!subscribers) {
    subscribers = new Set();
    bus().set(campaignId, subscribers);
  }
  subscribers.add(subscriber);
  if (userId) {
    listenerUserIds.set(subscriber, userId);
    let counts = presenceCounts().get(campaignId);
    if (!counts) {
      counts = new Map();
      presenceCounts().set(campaignId, counts);
    }
    const next = (counts.get(userId) ?? 0) + 1;
    counts.set(userId, next);
    // Announced after the subscriber is registered, so the joining tab hears
    // about its own arrival and needs no separate snapshot of the set.
    if (next === 1) {
      announcePresence(campaignId);
    }
  }
  // Guarded so a double-unsubscribe cannot drive a presence count negative.
  let released = false;
  return () => {
    if (released) {
      return;
    }
    released = true;
    subscribers.delete(subscriber);
    if (subscribers.size === 0) {
      bus().delete(campaignId);
    }
    if (userId) {
      const counts = presenceCounts().get(campaignId);
      if (counts) {
        const left = (counts.get(userId) ?? 0) - 1;
        if (left <= 0) {
          counts.delete(userId);
        } else {
          counts.set(userId, left);
        }
        if (counts.size === 0) {
          presenceCounts().delete(campaignId);
        }
        if (left <= 0) {
          announcePresence(campaignId);
        }
      }
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
  // The log holds what the whole table may read: every member can replay
  // it. What one seat is owed beyond that is added when it is sent.
  const stored = tablePayload(type, payload);
  getDatabase()
    .prepare(
      `INSERT INTO campaign_events (campaign_id, seq, type, payload_json, created_at) VALUES (?, ?, ?, ?, ?)`,
    )
    .run(campaignId, seq, type, JSON.stringify(stored), nowIso());
  if (stored === payload && !isSeatOnly(type, stored)) {
    fanOut(campaignId, sseChunk(type, stored, seq));
  } else {
    fanOutBySeat(campaignId, seq, type, stored, payload);
  }
  globalThis.__odmVoiceEventHook?.(campaignId, type);
  return seq;
}

// The slow path, for an event that differs by seat: each listener is sent
// its own view, and a listener owed nothing hears nothing.
function fanOutBySeat(
  campaignId: string,
  seq: number,
  type: string,
  stored: unknown,
  original: unknown,
) {
  const subscribers = bus().get(campaignId);
  if (!subscribers) {
    return;
  }
  const viewers = new Map<string, Viewer>();
  for (const subscriber of subscribers) {
    const userId = listenerUserIds.get(subscriber);
    let viewer: Viewer | null = null;
    if (userId) {
      viewer = viewers.get(userId) ?? viewerFor(campaignId, userId);
      viewers.set(userId, viewer);
    }
    try {
      const view = payloadForViewer(type, stored, viewer, original);
      if (view !== null) {
        subscriber(sseChunk(type, view, seq));
      }
    } catch {
      subscribers.delete(subscriber);
    }
  }
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

// The newest persisted event of any of the given types, or null. The
// snapshot route reads the handout, the X-card and the title card this way:
// they are persisted as events alone, and a client that loads fresh opens
// its stream at the snapshot's seq, so nothing before it is ever replayed.
export function latestEventOfType(campaignId: string, types: string[]): StoredEvent | null {
  if (!types.length) {
    return null;
  }
  const row = getDatabase()
    .prepare(
      `
        SELECT seq, type, payload_json FROM campaign_events
        WHERE campaign_id = ? AND type IN (${types.map(() => "?").join(", ")})
        ORDER BY seq DESC LIMIT 1
      `,
    )
    .get(campaignId, ...types) as { seq: number; type: string; payload_json: string } | undefined;
  return row
    ? { seq: row.seq, type: row.type, payload: parseJson<unknown>(row.payload_json, null) }
    : null;
}

// Every persisted event after `afterSeq`, oldest first, handed over one
// batch at a time until a short batch says there are no more. The events
// route replays with this so a long absence catches up whole instead of
// stopping at one batch and leaving a gap the seq guard cannot see. Returns
// how many were handed over.
//
// `viewerUserId` is the member the replay is for. Each event is handed over
// as that seat may read it, and an event meant for other seats is skipped
// (src/lib/table-delivery.ts); without one the replay is the table's view.
export function forEachEventSince(
  campaignId: string,
  afterSeq: number,
  each: (event: StoredEvent) => void,
  batch = 500,
  viewerUserId?: string,
): number {
  const viewer = viewerUserId ? viewerFor(campaignId, viewerUserId) : null;
  let cursor = afterSeq;
  let count = 0;
  for (;;) {
    // The batch is counted as stored, so a run of skipped events cannot be
    // mistaken for the end of the log.
    const events = readEventsSince(campaignId, cursor, batch);
    for (const event of events) {
      cursor = event.seq;
      const payload = payloadForViewer(event.type, event.payload, viewer);
      if (payload !== null) {
        each({ ...event, payload });
        count += 1;
      }
    }
    if (events.length < batch) {
      return count;
    }
  }
}

// The table's view of the log: what every member may read.
export function listEventsSince(campaignId: string, afterSeq: number, limit = 500): StoredEvent[] {
  return readEventsSince(campaignId, afterSeq, limit).filter(
    (event) => !isSeatOnly(event.type, event.payload),
  );
}

function readEventsSince(campaignId: string, afterSeq: number, limit: number): StoredEvent[] {
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
