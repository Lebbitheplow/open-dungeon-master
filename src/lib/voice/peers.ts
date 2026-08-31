import type { DtlsParameters, RtpCapabilities, RtpParameters } from "mediasoup/types";
import type { WebRtcTransport } from "mediasoup/types";
import {
  closeRoomIfEmpty,
  getOrCreateRoom,
  getRoom,
  TABLE_CHANNEL_ID,
  webRtcServerHandle,
  type VoicePeer,
  type VoiceRoom,
} from "@/lib/voice/room";
import type { VoiceRosterEntry } from "@/lib/voice/types";
import type { SayRange } from "@/lib/voice/audibility";
import { mayHear } from "@/lib/voice/apply";
import { publishEphemeral } from "@/lib/events";

// Events that change who can HEAR whom: a token moved, a fight started or
// ended, or a character dropped to 0 hit points.
const AUDIBILITY_EVENTS = new Set([
  "battle_map_updated",
  "encounter_updated",
  "sheet_updated",
  "campaign_updated",
]);

// Registered at module load. Every voice route imports this module, so the
// hook exists from the first voice request onward; before that there are no
// peers and nothing to enforce. That ordering is sufficient, not merely
// harmless: rooms and peers only ever come to exist through joinRoom below,
// the registry is in-memory so a process restart empties it, and the hook
// body no-ops at zero peers, so no floor or audibility event can have
// anything to act on before this module has loaded and registered. Moving
// registration to a startup entry point (instrumentation) was considered
// and rejected: it would load the voice graph in every process, including
// VOICE_ENABLED=0 installs, for no observable gain. The imports are dynamic
// because both targets import this module back, and deferring them to call
// time keeps that from being a static cycle.
globalThis.__odmVoiceEventHook = (campaignId: string, type: string) => {
  // Nothing to recompute when nobody is on a call, which is the common case.
  if (!getRoom(campaignId)?.peers.size) {
    return;
  }
  // A campaign event must never fail because voice is unhappy, so both of
  // these swallow their errors.
  if (type === "floor_changed") {
    void import("@/lib/voice/turns")
      .then((module) => module.applyVoiceFloor(campaignId))
      .catch(() => {});
  }
  if (AUDIBILITY_EVENTS.has(type)) {
    void import("@/lib/voice/apply")
      .then((module) => module.applyAudibility(campaignId))
      .catch(() => {});
  }
};

export function roster(room: VoiceRoom | null): VoiceRosterEntry[] {
  if (!room) {
    return [];
  }
  return [...room.peers.values()]
    .map((peer) => ({
      userId: peer.userId,
      username: peer.username,
      channelId: peer.channelId,
      muted: peer.muted,
      forceMuted: peer.forceMuted,
      handRaisedAt: peer.handRaisedAt,
      sayRange: peer.sayRange,
      producing: Boolean(peer.producer && !peer.producer.closed),
      joinedAt: peer.joinedAt,
    }))
    .sort((a, b) => a.joinedAt.localeCompare(b.joinedAt));
}

// The roster is small, identical for every seat and holds nothing private, so
// unlike the fogged battle map it rides the stream directly instead of pinging
// clients to fetch their own copy. Ephemeral: who is on a call right now is
// worthless after the fact and must never be replayed to a reconnecting client.
//
// Lives here rather than in gate.ts because the ICE reaper below has to call
// it, and gate.ts already imports this module.
export function publishRoster(campaignId: string) {
  publishEphemeral(campaignId, "voice_roster", { peers: roster(getRoom(campaignId)) });
}

// The client needs these to build its own transport. Everything else about a
// WebRtcTransport stays on the server.
export type TransportParams = {
  id: string;
  iceParameters: unknown;
  iceCandidates: unknown;
  dtlsParameters: unknown;
};

function transportParams(transport: WebRtcTransport): TransportParams {
  return {
    id: transport.id,
    iceParameters: transport.iceParameters,
    iceCandidates: transport.iceCandidates,
    dtlsParameters: transport.dtlsParameters,
  };
}

async function createTransport(room: VoiceRoom): Promise<WebRtcTransport> {
  const webRtcServer = await webRtcServerHandle();
  // enableTcp defaults true when a webRtcServer is given, which is the
  // fallback path for networks that block outbound UDP. preferUdp keeps the
  // normal case on UDP.
  return room.router.createWebRtcTransport({
    webRtcServer,
    enableUdp: true,
    enableTcp: true,
    preferUdp: true,
  });
}

// One peer per user per campaign. A second tab replaces the first rather than
// running two mics for one person: the old peer is torn down, which also
// releases its transports.
export async function joinRoom(
  campaignId: string,
  userId: string,
  username: string,
): Promise<{ peer: VoicePeer; send: TransportParams; recv: TransportParams }> {
  const room = await getOrCreateRoom(campaignId);
  const existing = room.peers.get(userId);
  if (existing) {
    destroyPeer(room, existing);
  }

  const peer: VoicePeer = {
    userId,
    username,
    joinedAt: new Date().toISOString(),
    channelId: TABLE_CHANNEL_ID,
    muted: false,
    forceMuted: false,
    handRaisedAt: null,
    sayRange: "normal",
    sendTransport: null,
    recvTransport: null,
    producer: null,
    consumers: new Map(),
  };

  const [sendTransport, recvTransport] = await Promise.all([
    createTransport(room),
    createTransport(room),
  ]);
  peer.sendTransport = sendTransport;
  peer.recvTransport = recvTransport;

  // HTTP has no connection lifetime, so a browser that closes without saying
  // goodbye has to be noticed here. ICE consent expires ~30s after the client
  // stops answering, which is what makes this fire; the sendBeacon on unload
  // is the fast path, not the reliable one.
  for (const transport of [sendTransport, recvTransport]) {
    const reap = () => {
      // Announce it: without this a peer whose browser vanished stays on
      // everyone else's roster until some unrelated event republishes it.
      if (leaveRoom(campaignId, userId)) {
        publishRoster(campaignId);
      }
    };
    transport.on("dtlsstatechange", (state) => {
      if (state === "closed" || state === "failed") {
        reap();
      }
    });
    transport.on("icestatechange", (state) => {
      if (state === "disconnected" || state === "closed") {
        reap();
      }
    });
  }

  room.peers.set(userId, peer);
  return { peer, send: transportParams(sendTransport), recv: transportParams(recvTransport) };
}

export function findPeer(campaignId: string, userId: string): VoicePeer | null {
  return getRoom(campaignId)?.peers.get(userId) ?? null;
}

function peerTransport(peer: VoicePeer, transportId: string): WebRtcTransport | null {
  if (peer.sendTransport?.id === transportId) {
    return peer.sendTransport;
  }
  if (peer.recvTransport?.id === transportId) {
    return peer.recvTransport;
  }
  return null;
}

export async function connectTransport(
  peer: VoicePeer,
  transportId: string,
  dtlsParameters: DtlsParameters,
): Promise<boolean> {
  const transport = peerTransport(peer, transportId);
  if (!transport) {
    return false;
  }
  await transport.connect({ dtlsParameters });
  return true;
}

// Renegotiates the candidate pair on an existing transport, keeping the
// producer, the consumers and the peer's seat in the room. The peer's own two
// transports are the only ones reachable by id here, so nobody can restart
// somebody else's.
export async function restartIce(peer: VoicePeer, transportId: string) {
  const transport = peerTransport(peer, transportId);
  if (!transport) {
    return null;
  }
  return transport.restartIce();
}

export async function produceAudio(
  campaignId: string,
  peer: VoicePeer,
  transportId: string,
  rtpParameters: RtpParameters,
): Promise<string | null> {
  if (peer.sendTransport?.id !== transportId) {
    return null;
  }
  // A rejoin without a full teardown would otherwise leak the old producer.
  if (peer.producer && !peer.producer.closed) {
    peer.producer.close();
  }
  const producer = await peer.sendTransport.produce({ kind: "audio", rtpParameters });
  peer.producer = producer;
  // Register with the room's speaker detection, and remember whose producer
  // this is so a dominantspeaker event can name a person.
  const room = getRoom(campaignId);
  if (room) {
    room.producerOwners.set(producer.id, peer.userId);
    producer.on("@close", () => {
      room.producerOwners.delete(producer.id);
    });
    if (room.speakerObserver) {
      // Never fatal: losing the indicator is better than losing the voice.
      await room.speakerObserver.addProducer({ producerId: producer.id }).catch(() => {});
    }
  }
  // Honour a mute chosen before the mic finished publishing, which is easy to
  // hit because the browser's permission prompt can outlast the click. Also
  // catches somebody who joined while the DM was holding the floor.
  await syncProducer(peer);
  return producer.id;
}

export type ConsumerParams = {
  id: string;
  producerId: string;
  producerUserId: string;
  kind: string;
  rtpParameters: unknown;
};

// Creates a consumer for every peer this one is not already hearing. Called on
// join and whenever somebody new starts producing, so it has to be idempotent.
//
// Consumers are created paused and resumed once the client has handled them
// (see resumeConsumers). That is standard mediasoup practice: resuming before
// the client side exists drops the first packets of speech.
export async function consumeOthers(
  campaignId: string,
  peer: VoicePeer,
  rtpCapabilities: RtpCapabilities,
): Promise<ConsumerParams[]> {
  const room = getRoom(campaignId);
  if (!room || !peer.recvTransport) {
    return [];
  }
  const created: ConsumerParams[] = [];
  for (const other of room.peers.values()) {
    if (other.userId === peer.userId || !other.producer || other.producer.closed) {
      continue;
    }
    const already = peer.consumers.get(other.userId);
    if (already && !already.closed) {
      continue;
    }
    if (!room.router.canConsume({ producerId: other.producer.id, rtpCapabilities })) {
      continue;
    }
    const consumer = await peer.recvTransport.consume({
      producerId: other.producer.id,
      rtpCapabilities,
      paused: true,
    });
    const producerUserId = other.userId;
    consumer.on("producerclose", () => {
      peer.consumers.delete(producerUserId);
    });
    peer.consumers.set(producerUserId, consumer);
    created.push({
      id: consumer.id,
      producerId: other.producer.id,
      producerUserId,
      kind: consumer.kind,
      rtpParameters: consumer.rtpParameters,
    });
  }
  return created;
}

// The client resumes the consumers it has finished building. That must not
// override the audibility rules: somebody out of earshot, or in another
// breakout room, stays paused however eagerly their listener asks.
export async function resumeConsumers(
  campaignId: string,
  peer: VoicePeer,
  consumerIds: string[],
) {
  const wanted = new Set(consumerIds);
  for (const [speakerId, consumer] of peer.consumers) {
    if (!wanted.has(consumer.id) || consumer.closed) {
      continue;
    }
    if (!mayHear(campaignId, peer.userId, speakerId)) {
      continue;
    }
    await consumer.resume();
  }
}

// A peer transmits only when nothing is silencing them. Two independent
// switches, deliberately: their own mute, and the floor under strict turn
// enforcement. Releasing the floor must not un-mute somebody who muted
// themselves, and muting yourself must not clear a force-mute.
export function transmitting(peer: VoicePeer): boolean {
  return !peer.muted && !peer.forceMuted;
}

// Brings the producer in line with those two switches. Pausing server-side is
// what makes a mute real: doing it client-side only would still ship the audio
// to the server and on to everyone else.
export async function syncProducer(peer: VoicePeer) {
  const producer = peer.producer;
  if (!producer || producer.closed) {
    return;
  }
  const wanted = transmitting(peer);
  if (wanted && producer.paused) {
    await producer.resume();
  } else if (!wanted && !producer.paused) {
    await producer.pause();
  }
}

export async function setMuted(peer: VoicePeer, muted: boolean) {
  peer.muted = muted;
  await syncProducer(peer);
}

// Asking for the floor without talking over whoever holds it. The timestamp
// orders the queue (src/lib/voice/turn-logic.ts).
export function setHandRaised(peer: VoicePeer, raised: boolean) {
  peer.handRaisedAt = raised ? (peer.handRaisedAt ?? new Date().toISOString()) : null;
}

// How far this peer's voice carries. Speaker-side on purpose: shouting is
// something you do, not something done to you.
export function setSayRange(peer: VoicePeer, sayRange: SayRange) {
  peer.sayRange = sayRange;
}

// Moves a peer to a breakout channel. Just a field: because channels are a
// layer over one router rather than a router each, this takes effect on the
// next audibility recompute with no renegotiation and no gap in audio.
export function setChannel(peer: VoicePeer, channelId: string) {
  peer.channelId = channelId;
}

function destroyPeer(room: VoiceRoom, peer: VoicePeer) {
  // Closing a transport closes every producer and consumer on it, so those do
  // not need closing individually. The consumer map is cleared anyway because
  // other peers hold no reference to it.
  peer.sendTransport?.close();
  peer.recvTransport?.close();
  peer.consumers.clear();
  room.peers.delete(peer.userId);
}

// Idempotent: the unload beacon and the ICE timeout both call this, and for a
// clean disconnect they race.
export function leaveRoom(campaignId: string, userId: string): boolean {
  const room = getRoom(campaignId);
  const peer = room?.peers.get(userId);
  if (!room || !peer) {
    return false;
  }
  destroyPeer(room, peer);
  closeRoomIfEmpty(campaignId);
  return true;
}
