"use client";

import { useCallback, useSyncExternalStore } from "react";
import {
  DEFAULT_PEER_VOLUME,
  DEFAULT_VOLUME_PREFS,
  MASTER_VOLUME_MAX,
  PEER_VOLUME_MAX,
  clampVolume,
  parseVolumePrefs,
  pruneVolumes,
  type PeerVolume,
  type VoiceVolumePrefs,
} from "@/lib/voice/volume";

// Everything the voice call remembers about the machine somebody is sitting
// at: which microphone, whether to hold a key, and how loud everyone else is.
// Deliberately localStorage rather than the account, because all of it is a
// property of the device and not of the person: a mic device id from one
// machine is meaningless on another, so unlike the narration and ambience
// prefs (src/lib/audio-prefs.ts) none of this syncs to the server. A player on their laptop and
// on their phone wants different answers, and "that player's mic is hot" is
// about their mic, not about which campaign you happen to be in, so the
// volumes are shared across campaigns rather than stored per campaign.

export type MicMode = "open" | "ptt";

const MIC_ID_KEY = "odm.voice.micId";
const MIC_MODE_KEY = "odm.voice.micMode";
// The key held to talk in push-to-talk mode. Backquote is out of the way of
// normal typing and does not fight the browser the way space does.
export const PTT_KEY = "Backquote";

export function readMicId(): string {
  return readPref(MIC_ID_KEY, "");
}

export function readMicMode(): MicMode {
  return readPref(MIC_MODE_KEY, "open") === "ptt" ? "ptt" : "open";
}

export function writeMicId(deviceId: string) {
  writePref(MIC_ID_KEY, deviceId);
}

export function writeMicMode(mode: MicMode) {
  writePref(MIC_MODE_KEY, mode);
}

function readPref(key: string, fallback: string): string {
  if (typeof window === "undefined") {
    return fallback;
  }
  try {
    return window.localStorage.getItem(key) ?? fallback;
  } catch {
    // Private browsing and similar; the default is fine.
    return fallback;
  }
}

// localStorage is an external store, so it is read through
// useSyncExternalStore rather than copied into state in an effect. That keeps
// the server render and the first client render agreeing (the server has no
// localStorage, so it gets the default) and re-renders on write. Same pattern
// as subscribeWide/readWide in SidePanel.tsx.
const prefListeners = new Set<() => void>();

export function subscribeMicPrefs(listener: () => void) {
  prefListeners.add(listener);
  return () => {
    prefListeners.delete(listener);
  };
}

function writePref(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Nothing to do: the preference simply does not persist.
  }
  for (const listener of prefListeners) {
    listener();
  }
}

// The volumes are their own store rather than more string keys, because they
// are one JSON blob and because they have a reader outside React (the consumer
// sync, which needs the current value at the moment an audio element is
// built). Follows src/lib/dice/dice-sources.ts, which also listens for the
// native storage event: VoicePanel is mounted twice at once (the lobby, and
// the always-mounted VoiceDock), and a second tab is common at a table, so a
// slider moved in one place has to reach the others.
const VOLUMES_KEY = "odm.voice.volumes.v1";
const VOLUMES_EVENT = "odm-voice-volumes";

// Cached on the raw stored string so getSnapshot returns a stable reference
// between reads; useSyncExternalStore loops forever otherwise.
let cachedRaw = "";
let cachedPrefs: VoiceVolumePrefs = DEFAULT_VOLUME_PREFS;

export function readVolumePrefs(): VoiceVolumePrefs {
  if (typeof window === "undefined") {
    return DEFAULT_VOLUME_PREFS;
  }
  let raw = "";
  try {
    raw = window.localStorage.getItem(VOLUMES_KEY) ?? "";
  } catch {
    return DEFAULT_VOLUME_PREFS;
  }
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedPrefs = parseVolumePrefs(raw);
  }
  return cachedPrefs;
}

function subscribeVolumes(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(VOLUMES_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(VOLUMES_EVENT, onChange);
  };
}

function writeVolumePrefs(next: VoiceVolumePrefs) {
  try {
    window.localStorage.setItem(VOLUMES_KEY, JSON.stringify(next));
  } catch {
    // Quota or private mode: the change still applies to this session's audio
    // through the event below, it just does not survive a reload.
    cachedRaw = "";
    cachedPrefs = next;
  }
  // The native storage event only reaches other tabs; a custom event carries
  // the change to this tab's own subscribers.
  window.dispatchEvent(new Event(VOLUMES_EVENT));
}

// `presentUserIds` is only used to decide who survives if the stored map ever
// has to be trimmed. Pass a stable array (useMemo) so the setters keep their
// identity between renders.
export function useVoiceVolumes(presentUserIds: readonly string[]) {
  const prefs = useSyncExternalStore(
    subscribeVolumes,
    readVolumePrefs,
    () => DEFAULT_VOLUME_PREFS,
  );

  // Every write goes through here, so pruning cannot be forgotten and no
  // setter is working from a stale render's copy.
  const update = useCallback(
    (mutate: (current: VoiceVolumePrefs) => VoiceVolumePrefs) => {
      const next = mutate(readVolumePrefs());
      writeVolumePrefs({ ...next, peers: pruneVolumes(next.peers, presentUserIds) });
    },
    [presentUserIds],
  );

  const peerVolume = useCallback(
    (userId: string): PeerVolume => prefs.peers[userId] ?? DEFAULT_PEER_VOLUME,
    [prefs],
  );

  const setPeerVolume = useCallback(
    (userId: string, volume: number) => {
      update((current) => ({
        ...current,
        peers: {
          ...current.peers,
          [userId]: {
            ...(current.peers[userId] ?? DEFAULT_PEER_VOLUME),
            volume: clampVolume(volume, PEER_VOLUME_MAX),
          },
        },
      }));
    },
    [update],
  );

  const togglePeerMute = useCallback(
    (userId: string) => {
      update((current) => {
        const entry = current.peers[userId] ?? DEFAULT_PEER_VOLUME;
        return {
          ...current,
          peers: { ...current.peers, [userId]: { ...entry, muted: !entry.muted } },
        };
      });
    },
    [update],
  );

  // Back to untouched. Pruning drops the entry on write, so "reset" and "never
  // adjusted" end up storing the same thing: nothing.
  const resetPeer = useCallback(
    (userId: string) => {
      update((current) => ({
        ...current,
        peers: { ...current.peers, [userId]: DEFAULT_PEER_VOLUME },
      }));
    },
    [update],
  );

  const setMaster = useCallback(
    (master: number) => {
      update((current) => ({ ...current, master: clampVolume(master, MASTER_VOLUME_MAX) }));
    },
    [update],
  );

  const toggleDeafen = useCallback(() => {
    update((current) => ({ ...current, deafened: !current.deafened }));
  }, [update]);

  return { prefs, peerVolume, setPeerVolume, togglePeerMute, resetPeer, setMaster, toggleDeafen };
}
