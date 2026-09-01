import { getCampaignById } from "@/lib/db/campaigns";
import { publishEphemeral } from "@/lib/events";
import { serverEnv } from "@/lib/server-env";
import { buildSeats } from "@/lib/voice/apply";
import {
  computeAudibility,
  diffAudibility,
  type AudibilityMatrix,
} from "@/lib/voice/audibility";
import {
  MESH_CHANNEL_ID,
  MESH_MAILBOX_CAP,
  meshRosterEntries,
  stalePeerIds,
  type MeshPeerState,
} from "@/lib/voice/mesh-logic";
import type { VoiceRosterEntry } from "@/lib/voice/types";

// Mesh voice: the server relays signaling and keeps the roster, and the audio
// itself flows browser-to-browser. Nothing here touches mediasoup, a media
// port, or raw UDP, which is the whole point: it works when the server is
// reachable only through an HTTP tunnel.
//
// Presence is heartbeat-based (the SFU gets liveness from ICE state; mesh has
// no server-side transport to watch). Audibility gains reuse the same pure
// rules and the same contentless-event-plus-private-GET pattern as the SFU.
// One honest limitation, unlike the SFU: audio streams reach every peer and
// gains are applied client-side, so "cannot hear them" is a courtesy rather
// than an enforcement. Small tables of friends, not tournaments.

type MeshSignal = { from: string; data: unknown };

type MeshPeer = MeshPeerState & { mailbox: MeshSignal[] };

type MeshRoom = {
  peers: Map<string, MeshPeer>;
  audibility: AudibilityMatrix;
};

// Survives dev-server module reloads the same way the SFU registry does.
function registry(): Map<string, MeshRoom> {
  const holder = globalThis as { __odmMeshRegistry?: Map<string, MeshRoom> };
  holder.__odmMeshRegistry ??= new Map();
  return holder.__odmMeshRegistry;
}

function getMeshRoom(campaignId: string): MeshRoom | null {
  return registry().get(campaignId) ?? null;
}

function ensureMeshRoom(campaignId: string): MeshRoom {
  const rooms = registry();
  let room = rooms.get(campaignId);
  if (!room) {
    room = { peers: new Map(), audibility: new Map() };
    rooms.set(campaignId, room);
  }
  return room;
}

export function meshRosterFor(campaignId: string): VoiceRosterEntry[] {
  const room = getMeshRoom(campaignId);
  return room ? meshRosterEntries(room.peers.values()) : [];
}

export function meshJoined(campaignId: string, userId: string): boolean {
  return Boolean(getMeshRoom(campaignId)?.peers.has(userId));
}

function publishMeshRoster(campaignId: string): void {
  publishEphemeral(campaignId, "voice_roster", { peers: meshRosterFor(campaignId) });
}

// Drops peers whose heartbeats stopped (crashed tab, dead laptop). Runs on
// every touch of a room rather than on a timer, so an idle server keeps no
// clocks running.
function reap(campaignId: string): void {
  const room = getMeshRoom(campaignId);
  if (!room) {
    return;
  }
  const stale = stalePeerIds(room.peers.values(), Date.now());
  if (stale.length === 0) {
    return;
  }
  for (const userId of stale) {
    room.peers.delete(userId);
  }
  if (room.peers.size === 0) {
    registry().delete(campaignId);
  }
  publishMeshRoster(campaignId);
  applyMeshAudibility(campaignId);
}

export function meshJoin(campaignId: string, userId: string, username: string): VoiceRosterEntry[] {
  reap(campaignId);
  const room = ensureMeshRoom(campaignId);
  // One seat per user: a second tab replaces the first, same as the SFU.
  room.peers.set(userId, {
    userId,
    username,
    muted: false,
    sayRange: "normal",
    joinedAt: new Date().toISOString(),
    lastSeenAt: Date.now(),
    mailbox: [],
  });
  publishMeshRoster(campaignId);
  applyMeshAudibility(campaignId);
  return meshRosterFor(campaignId);
}

export function meshLeave(campaignId: string, userId: string): void {
  const room = getMeshRoom(campaignId);
  if (!room || !room.peers.delete(userId)) {
    return;
  }
  if (room.peers.size === 0) {
    registry().delete(campaignId);
  }
  publishMeshRoster(campaignId);
  applyMeshAudibility(campaignId);
}

// Heartbeat doubles as the signal drain: liveness and mail in one round trip.
export function meshHeartbeat(campaignId: string, userId: string): MeshSignal[] | null {
  reap(campaignId);
  const peer = getMeshRoom(campaignId)?.peers.get(userId);
  if (!peer) {
    return null;
  }
  peer.lastSeenAt = Date.now();
  const signals = peer.mailbox;
  peer.mailbox = [];
  return signals;
}

export function meshSignal(
  campaignId: string,
  fromUserId: string,
  toUserId: string,
  data: unknown,
): boolean {
  const room = getMeshRoom(campaignId);
  const target = room?.peers.get(toUserId);
  if (!room || !target || !room.peers.has(fromUserId)) {
    return false;
  }
  target.mailbox.push({ from: fromUserId, data });
  if (target.mailbox.length > MESH_MAILBOX_CAP) {
    target.mailbox.splice(0, target.mailbox.length - MESH_MAILBOX_CAP);
  }
  // Contentless nudge: only `to` rides the shared stream, the payload waits
  // in the mailbox for its owner's authenticated drain.
  publishEphemeral(campaignId, "voice_mesh_signal", { to: toUserId });
  return true;
}

export function meshSetState(
  campaignId: string,
  userId: string,
  state: { muted?: boolean; sayRange?: "whisper" | "normal" | "shout" },
): boolean {
  const peer = getMeshRoom(campaignId)?.peers.get(userId);
  if (!peer) {
    return false;
  }
  if (typeof state.muted === "boolean") {
    peer.muted = state.muted;
  }
  if (state.sayRange) {
    peer.sayRange = state.sayRange;
  }
  peer.lastSeenAt = Date.now();
  publishMeshRoster(campaignId);
  if (state.sayRange) {
    applyMeshAudibility(campaignId);
  }
  return true;
}

// Same rules, same privacy pattern as the SFU's applyAudibility; the only
// difference is that the matrix drives client-side gains instead of consumer
// pauses.
export function applyMeshAudibility(campaignId: string): void {
  const room = getMeshRoom(campaignId);
  if (!room || room.peers.size === 0) {
    return;
  }
  const campaign = getCampaignById(campaignId);
  if (!campaign) {
    return;
  }
  const peers = [...room.peers.values()].map((peer) => ({
    userId: peer.userId,
    channelId: MESH_CHANNEL_ID,
    sayRange: peer.sayRange,
  }));
  const { seats, blocked } = buildSeats(campaignId, peers);
  const next = computeAudibility(seats, campaign.gameSettings.voice.rules, { blocked });
  const diff = diffAudibility(room.audibility, next);
  room.audibility = next;
  if (diff.pause.size || diff.resume.size || diff.gains.size) {
    publishEphemeral(campaignId, "voice_audibility_changed", {});
  }
}

export function meshGainsFor(campaignId: string, userId: string): Record<string, number> {
  const heard = getMeshRoom(campaignId)?.audibility.get(userId);
  return heard ? Object.fromEntries(heard) : {};
}

// The map moved, a fight started, somebody went down: recompute gains. Chains
// any hook the SFU installed so whichever transport is live reacts.
{
  const holder = globalThis as {
    __odmVoiceEventHook?: (campaignId: string, type: string) => void;
    __odmMeshHooked?: boolean;
  };
  if (!holder.__odmMeshHooked) {
    holder.__odmMeshHooked = true;
    const previous = holder.__odmVoiceEventHook;
    holder.__odmVoiceEventHook = (campaignId, type) => {
      previous?.(campaignId, type);
      if (
        type === "battle_map_updated" ||
        type === "encounter_updated" ||
        type === "sheet_updated" ||
        type === "campaign_updated"
      ) {
        applyMeshAudibility(campaignId);
      }
    };
  }
}

// ICE servers for the peers: Cloudflare's free STUN always, plus short-lived
// TURN credentials when the broker has a Realtime key configured. Cached so a
// table joining together costs one broker call, refreshed well inside the
// credential TTL.
const ICE_CACHE_MS = 30 * 60 * 1000;
const FALLBACK_ICE: unknown[] = [
  { urls: ["stun:stun.cloudflare.com:3478", "stun:stun.l.google.com:19302"] },
];
let iceCache: { at: number; servers: unknown[] } | null = null;

export async function meshIceServers(): Promise<unknown[]> {
  if (iceCache && Date.now() - iceCache.at < ICE_CACHE_MS) {
    return iceCache.servers;
  }
  // "off" opts a self-hosted server out of the phone-home entirely: mesh
  // then runs on public STUN alone, which still connects most tables.
  const broker = serverEnv(
    "ODM_ICE_BROKER_URL",
    "https://odm-tunnel-broker.tunnel-broker.workers.dev",
  );
  if (!broker || broker === "off") {
    return FALLBACK_ICE;
  }
  try {
    const response = await fetch(`${broker}/turn`, { signal: AbortSignal.timeout(5000) });
    const body = (await response.json()) as { iceServers?: unknown[] };
    if (response.ok && Array.isArray(body.iceServers) && body.iceServers.length > 0) {
      iceCache = { at: Date.now(), servers: body.iceServers };
      return body.iceServers;
    }
  } catch {
    // Broker unreachable; STUN-only still connects most tables.
  }
  return FALLBACK_ICE;
}
