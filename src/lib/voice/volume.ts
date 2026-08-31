// Per-listener volume for the voice call: how loud each other person is in
// this browser, and how loud the call is overall.
//
// Client-safe on purpose (no mediasoup, no DOM, no React), the same rule
// src/lib/voice/types.ts follows, which also lets scripts/test-voice-volume.mjs
// import it directly.
//
// This is comfort, never enforcement. Whether a voice reaches a listener at
// all is decided server-side by pausing the consumer (src/lib/voice/apply.ts);
// somebody muted here is still being received. That is also why the server's
// audibility gain multiplies in below rather than being replaced: turning a
// player up must never defeat a wall or a closed side room.

// Sliders attenuate only. Amplifying past 1 would mean routing every remote
// stream through an AudioContext, because HTMLMediaElement.volume is clamped
// to 0..1 by spec, and that path has a Chromium quirk where a WebRTC stream
// goes silent in a Web Audio graph unless a muted <audio> element is kept
// alive as a sink. Relative balance is the actual want, and attenuation gives
// it: to make one quiet player stand out, turn the others down. If boost is
// ever worth the graph, this constant and applyVolumes are what change.
export const PEER_VOLUME_MAX = 1;
export const MASTER_VOLUME_MAX = 1;
export const VOLUME_STEP = 0.05;

// A ceiling on the stored map, so a long-lived browser cannot grow it without
// bound. Well past any real table.
export const MAX_PEER_ENTRIES = 200;

export type PeerVolume = {
  volume: number;
  // A local mute: this listener does not want to hear them. Distinct from the
  // roster's `muted`, which is the speaker's own microphone.
  muted: boolean;
};

export type VoiceVolumePrefs = {
  master: number;
  // Deafen. Silences everyone without touching this listener's microphone.
  deafened: boolean;
  peers: Record<string, PeerVolume>;
};

export const DEFAULT_PEER_VOLUME: PeerVolume = { volume: 1, muted: false };
export const DEFAULT_VOLUME_PREFS: VoiceVolumePrefs = {
  master: 1,
  deafened: false,
  peers: {},
};

// Anything that is not a usable level becomes 1. Load-bearing: assigning NaN
// to HTMLMediaElement.volume throws a TypeError, which mid-call would surface
// as an exception inside the consumer sync rather than as a wrong volume.
export function clampVolume(value: unknown, max: number): number {
  const level = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(level)) {
    return 1;
  }
  return Math.min(max, Math.max(0, level));
}

// How loud this listener wants one speaker, before the master bus.
export function peerGain(audibility: number, peer: PeerVolume): number {
  if (peer.muted) {
    return 0;
  }
  return clampVolume(audibility, 1) * clampVolume(peer.volume, PEER_VOLUME_MAX);
}

export function masterGain(prefs: VoiceVolumePrefs): number {
  return prefs.deafened ? 0 : clampVolume(prefs.master, MASTER_VOLUME_MAX);
}

// The whole formula, in one place: server audibility, this listener's slider
// for that speaker, and the master bus, all multiplied.
export function effectiveVolume(
  audibility: number,
  peer: PeerVolume,
  prefs: VoiceVolumePrefs,
): number {
  return peerGain(audibility, peer) * masterGain(prefs);
}

// Deliberate silence, as opposed to a slider that happens to sit at zero.
export function silenced(peer: PeerVolume, deafened: boolean): boolean {
  return deafened || peer.muted;
}

export function isDefaultPeer(peer: PeerVolume): boolean {
  return peer.volume === 1 && !peer.muted;
}

export function parseVolumePrefs(raw: string): VoiceVolumePrefs {
  if (!raw) {
    return DEFAULT_VOLUME_PREFS;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return DEFAULT_VOLUME_PREFS;
  }
  if (!parsed || typeof parsed !== "object") {
    return DEFAULT_VOLUME_PREFS;
  }
  const stored = parsed as Record<string, unknown>;
  const peers: Record<string, PeerVolume> = {};
  if (stored.peers && typeof stored.peers === "object") {
    for (const [userId, value] of Object.entries(stored.peers as Record<string, unknown>)) {
      if (!value || typeof value !== "object") {
        continue;
      }
      const entry = value as Record<string, unknown>;
      // A volume that is not a finite number is corruption rather than a
      // preference, so the entry is dropped instead of being coerced to a
      // level nobody chose.
      if (typeof entry.volume !== "number" || !Number.isFinite(entry.volume)) {
        continue;
      }
      peers[userId] = {
        volume: clampVolume(entry.volume, PEER_VOLUME_MAX),
        muted: Boolean(entry.muted),
      };
    }
  }
  return {
    master: clampVolume(stored.master, MASTER_VOLUME_MAX),
    deafened: Boolean(stored.deafened),
    peers,
  };
}

// Run on every write, so forgetting it is not possible.
export function pruneVolumes(
  peers: Record<string, PeerVolume>,
  presentUserIds: readonly string[],
): Record<string, PeerVolume> {
  // A default entry says nothing, so it is never stored. That alone bounds the
  // map to people somebody actually adjusted, which for most browsers is the
  // whole of the growth control.
  const kept = Object.entries(peers).filter(([, peer]) => !isDefaultPeer(peer));
  if (kept.length <= MAX_PEER_ENTRIES) {
    return Object.fromEntries(kept);
  }
  // Over the cap: keep the call in front of you first, then the most recently
  // written of the rest. Object key order is insertion order for the id-shaped
  // keys used here, which is the eviction order wanted without paying for a
  // timestamp on every peer.
  const present = new Set(presentUserIds);
  const here = kept.filter(([userId]) => present.has(userId));
  const away = kept.filter(([userId]) => !present.has(userId));
  const room = Math.max(0, MAX_PEER_ENTRIES - here.length);
  return Object.fromEntries([
    ...here.slice(0, MAX_PEER_ENTRIES),
    ...(room ? away.slice(-room) : []),
  ]);
}
