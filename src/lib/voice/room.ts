import type {
  ActiveSpeakerObserver,
  Consumer,
  Producer,
  Router,
  RouterRtpCodecCapability,
  WebRtcServer,
  WebRtcTransport,
  Worker,
} from "mediasoup/types";
import { publishEphemeral } from "@/lib/events";
import type { AudibilityMatrix, SayRange } from "@/lib/voice/audibility";
import { announcedAddressFor, networkSignature, voiceConfig } from "@/lib/voice/config";

// The SFU lives in this process, like the event bus and the media queue.
// docker-compose already pins the app to a single replica (the SQLite writer
// requires it), so in-memory media state is consistent with the deployment.
// A restart drops every call, which is the correct behaviour: a voice
// connection is not durable state and nothing should try to resume one.
//
// As with src/lib/events.ts, the registry must live on globalThis. In
// `next dev` HMR re-evaluates modules, and module-scoped state would silently
// strand a running worker while the next request built a second one.

// Breakout channels are a logical layer over ONE router per campaign, never a
// router each. Separate routers would isolate cleanly but moving a peer would
// mean rebuilding their transports and producer, which is a full renegotiation
// and an audible gap every time the DM pulls somebody aside. As a field on the
// peer it is one recompute instead (src/lib/voice/audibility.ts).
export const TABLE_CHANNEL_ID = "table";
export const TABLE_CHANNEL_NAME = "The Table";

// A side room the DM opened. Channels are in-memory like peers: a breakout is
// a thing that exists while people are in it, not durable campaign state.
export type VoiceChannel = {
  id: string;
  name: string;
};

export type VoicePeer = {
  userId: string;
  username: string;
  joinedAt: string;
  // Which breakout channel this peer is in. Phase 1 only ever sets the
  // default; the field exists now because retrofitting it through every
  // consumer path later is the expensive way to do it.
  channelId: string;
  // The peer's own mic switch. Muting pauses the producer server-side, so a
  // muted peer sends nothing rather than being filtered at the listeners.
  muted: boolean;
  // Silenced by the floor under strict turn enforcement
  // (src/lib/voice/turns.ts). Kept apart from `muted` so releasing the floor
  // does not un-mute somebody who had muted themselves.
  forceMuted: boolean;
  // When this peer asked for the floor, or null. Lets a player queue up
  // without talking over whoever currently holds it.
  handRaisedAt: string | null;
  // How far this peer's voice carries, when the say-range rule is on.
  sayRange: SayRange;
  sendTransport: WebRtcTransport | null;
  recvTransport: WebRtcTransport | null;
  producer: Producer | null;
  // Keyed by the producing peer's userId, so "am I already hearing them" is
  // a lookup rather than a scan.
  consumers: Map<string, Consumer>;
};

export type VoiceRoom = {
  campaignId: string;
  router: Router;
  peers: Map<string, VoicePeer>;
  // mediasoup's own dominant-speaker detection. This is the piece LiveKit
  // gives you for free and mediasoup makes you wire up: it watches the audio
  // levels of every producer added to it and names whoever is actually
  // talking, which is what drives the speaking indicator and makes a
  // turn-taking UI legible.
  speakerObserver: ActiveSpeakerObserver | null;
  // producerId -> userId, so a dominantspeaker event can be turned back into
  // a person. Producers are mediasoup's identifiers and mean nothing to a
  // client.
  producerOwners: Map<string, string>;
  // Breakout rooms the DM has opened, beyond the always-present table.
  channels: VoiceChannel[];
  // The audibility matrix currently applied to the consumers, so the next
  // recompute can issue only the difference (src/lib/voice/apply.ts).
  audibility: AudibilityMatrix;
  // Timer that publishes "nobody is talking". mediasoup's observer only ever
  // says who STARTED, never who stopped, so somebody has to draw the falling
  // edge. Doing it here rather than in the browser keeps the client purely
  // reactive: it renders the last thing it was told instead of running its own
  // clock, which is both simpler and impossible to get out of step.
  speakerTimer: ReturnType<typeof setTimeout> | null;
};

type VoiceRuntime = {
  worker: Worker;
  webRtcServer: WebRtcServer;
  // The network settings this worker bound with. An admin who changes the
  // port or announced address needs the socket rebuilt, or ICE candidates
  // would keep advertising the old address.
  signature: string;
};

type VoiceRegistry = {
  runtime: VoiceRuntime | null;
  // Guards concurrent first requests: without it, two simultaneous joins
  // would each spawn a worker and bind the same port, and the second would
  // throw EADDRINUSE.
  starting: Promise<VoiceRuntime> | null;
  rooms: Map<string, VoiceRoom>;
};

declare global {
  var __odmVoiceRegistry: VoiceRegistry | undefined;
}

function registry(): VoiceRegistry {
  return (globalThis.__odmVoiceRegistry ??= {
    runtime: null,
    starting: null,
    rooms: new Map(),
  });
}

// How long somebody stays lit after the observer names them. Long enough that
// the indicator tracks a conversation rather than strobing on each syllable.
const SPEAKING_HOLD_MS = 1400;

// Audio only. DTX stops sending during silence and inband FEC lets the
// decoder rebuild a lost packet from the next one, which together matter far
// more than bitrate for a table where most people are quiet most of the time.
const AUDIO_CODECS: RouterRtpCodecCapability[] = [
  {
    kind: "audio",
    mimeType: "audio/opus",
    clockRate: 48000,
    channels: 2,
    parameters: { useinbandfec: 1, usedtx: 1 },
  },
];

async function startRuntime(): Promise<VoiceRuntime> {
  const config = voiceConfig();
  // Imported lazily so the native worker binary is only resolved when voice
  // is actually used. An owner with VOICE_ENABLED=0 never loads it.
  const mediasoup = await import("mediasoup");
  const worker = await mediasoup.createWorker({
    logLevel: "warn",
    rtcMinPort: config.port,
    rtcMaxPort: config.port,
  });

  // One server, one port, every transport. See src/lib/voice/config.ts.
  const webRtcServer = await worker.createWebRtcServer({
    listenInfos: [
      {
        protocol: "udp",
        ip: config.listenIp,
        announcedAddress: announcedAddressFor(config),
        port: config.port,
      },
      {
        protocol: "tcp",
        ip: config.listenIp,
        announcedAddress: announcedAddressFor(config),
        port: config.port,
      },
    ],
  });

  // A dead worker takes every room with it. Clearing the registry means the
  // next request rebuilds from scratch instead of handing out handles to a
  // worker that is gone.
  worker.on("died", () => {
    const current = registry();
    current.runtime = null;
    current.starting = null;
    current.rooms.clear();
  });

  return { worker, webRtcServer, signature: networkSignature(config) };
}

// True when no table has anyone connected. Rebuilding the worker drops every
// call, so a settings change waits for a quiet moment rather than cutting
// people off mid-sentence.
function noActivePeers(current: VoiceRegistry): boolean {
  for (const room of current.rooms.values()) {
    if (room.peers.size > 0) {
      return false;
    }
  }
  return true;
}

export async function ensureVoiceRuntime(): Promise<VoiceRuntime> {
  const current = registry();
  if (current.runtime) {
    // Admin panel edits to the port or announced address take effect here,
    // so changing them needs no service restart. Deferred while anyone is on
    // a call: the next join after the last person hangs up picks it up.
    if (current.runtime.signature !== networkSignature(voiceConfig()) && noActivePeers(current)) {
      for (const room of current.rooms.values()) {
        room.router.close();
      }
      current.rooms.clear();
      current.runtime.worker.close();
      current.runtime = null;
    } else {
      return current.runtime;
    }
  }
  if (!current.starting) {
    current.starting = startRuntime()
      .then((runtime) => {
        current.runtime = runtime;
        return runtime;
      })
      .catch((error) => {
        // Let the next caller retry rather than caching the rejection.
        current.starting = null;
        throw error;
      });
  }
  return current.starting;
}

export async function getOrCreateRoom(campaignId: string): Promise<VoiceRoom> {
  const current = registry();
  const existing = current.rooms.get(campaignId);
  if (existing) {
    return existing;
  }
  const runtime = await ensureVoiceRuntime();
  const router = await runtime.worker.createRouter({ mediaCodecs: AUDIO_CODECS });
  // Another request may have created the room while we awaited the router.
  const raced = current.rooms.get(campaignId);
  if (raced) {
    router.close();
    return raced;
  }
  const room: VoiceRoom = {
    campaignId,
    router,
    peers: new Map(),
    speakerObserver: null,
    producerOwners: new Map(),
    speakerTimer: null,
    channels: [{ id: TABLE_CHANNEL_ID, name: TABLE_CHANNEL_NAME }],
    audibility: new Map(),
  };

  // 300ms is a deliberate compromise: fast enough that the indicator tracks
  // conversation, slow enough that it does not strobe on every syllable.
  try {
    const observer = await router.createActiveSpeakerObserver({ interval: 300 });
    observer.on("dominantspeaker", ({ producer }) => {
      const userId = room.producerOwners.get(producer.id);
      if (!userId) {
        return;
      }
      // Ephemeral by nature: who is talking right now is meaningless a
      // second later and must never be replayed to a reconnecting client.
      publishEphemeral(campaignId, "voice_speaking", { userId });
      if (room.speakerTimer) {
        clearTimeout(room.speakerTimer);
      }
      room.speakerTimer = setTimeout(() => {
        room.speakerTimer = null;
        publishEphemeral(campaignId, "voice_speaking", { userId: "" });
      }, SPEAKING_HOLD_MS);
    });
    room.speakerObserver = observer;
  } catch {
    // Speaker detection is a nicety. A room without it still carries audio,
    // so a failure here must not stop people talking.
  }

  current.rooms.set(campaignId, room);
  return room;
}

export function getRoom(campaignId: string): VoiceRoom | null {
  return registry().rooms.get(campaignId) ?? null;
}

export async function webRtcServerHandle(): Promise<WebRtcServer> {
  return (await ensureVoiceRuntime()).webRtcServer;
}

// Rooms are cheap but not free, and a router with no peers is pure overhead.
// Called after every departure.
export function closeRoomIfEmpty(campaignId: string) {
  const current = registry();
  const room = current.rooms.get(campaignId);
  if (!room || room.peers.size > 0) {
    return;
  }
  if (room.speakerTimer) {
    clearTimeout(room.speakerTimer);
    room.speakerTimer = null;
  }
  room.router.close();
  current.rooms.delete(campaignId);
}
