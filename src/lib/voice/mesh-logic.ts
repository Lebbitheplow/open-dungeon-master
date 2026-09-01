// Pure rules for mesh voice: no I/O, no globals, importable by tests and by
// the browser bundle. The side-effecting registry lives in mesh.ts.

import type { VoiceRosterEntry } from "@/lib/voice/types";

// Mesh has no breakout channels; everyone sits at the table. Mirrors
// TABLE_CHANNEL_ID in room.ts, restated here so the browser bundle never
// pulls that server module in.
export const MESH_CHANNEL_ID = "table";

// A peer that has not heartbeated for this long is treated as gone. The
// client heartbeats every HEARTBEAT_MS; the margin covers a laptop lid
// closing for a moment without dropping the seat.
export const MESH_STALE_MS = 30_000;
export const MESH_HEARTBEAT_MS = 10_000;

// Each peer's outstanding SDP/ICE notes; anything past this is a runaway
// client and gets dropped oldest-first.
export const MESH_MAILBOX_CAP = 64;

// One signal message must fit an SDP comfortably and nothing else.
export const MESH_SIGNAL_MAX_BYTES = 32_768;

export type MeshPeerState = {
  userId: string;
  username: string;
  muted: boolean;
  sayRange: "whisper" | "normal" | "shout";
  joinedAt: string;
  lastSeenAt: number;
};

// Perfect negotiation needs exactly one polite side per pair, agreed without
// talking. Lexicographic order of ids is stable and symmetric.
export function politeIn(myUserId: string, peerUserId: string): boolean {
  return myUserId > peerUserId;
}

export function stalePeerIds(
  peers: Iterable<Pick<MeshPeerState, "userId" | "lastSeenAt">>,
  now: number,
): string[] {
  const stale: string[] = [];
  for (const peer of peers) {
    if (now - peer.lastSeenAt > MESH_STALE_MS) {
      stale.push(peer.userId);
    }
  }
  return stale;
}

// The same roster shape the SFU publishes, so VoicePanel renders both modes
// identically. Mesh has no floor enforcement and no produce handshake, so
// forceMuted is always false and producing always true.
export function meshRosterEntries(peers: Iterable<MeshPeerState>): VoiceRosterEntry[] {
  return [...peers]
    .map((peer) => ({
      userId: peer.userId,
      username: peer.username,
      channelId: MESH_CHANNEL_ID,
      muted: peer.muted,
      forceMuted: false,
      handRaisedAt: null,
      sayRange: peer.sayRange,
      producing: true,
      joinedAt: peer.joinedAt,
    }))
    .sort((a, b) => a.joinedAt.localeCompare(b.joinedAt));
}
