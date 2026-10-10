"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { AmbienceState } from "@/lib/ambience/logic";
import { AmbiencePlayer, type AmbienceLayerName, type PlayerSnapshot } from "@/lib/ambience/player";
import { registerOutput, releaseOutput } from "@/lib/audio-devices";
import { AUDIO_PREF_FIELDS, hydrateAudioPrefs, writeAudioPref, type AudioPrefField } from "@/lib/audio-prefs";

// Plays what the table is hearing, in this browser, at this listener's own
// volume.
//
// The server decides WHAT plays and every seat gets the same answer; how
// loud it is, and whether it plays at all, is nobody's business but the
// person wearing the headphones. So the cue rides the campaign stream and
// the volumes live in localStorage, exactly the split narration audio uses
// (useNarrationAudio.ts), read through useSyncExternalStore so the server
// render starts muted and the client snapshot takes over at hydration.
//
// How the sound is actually made is src/lib/ambience/player.ts; this hook
// feeds it the stream, the prefs and the clock, and reads it back for the
// sound panel.

const PREFS_EVENT = AUDIO_PREF_FIELDS.ambienceMuted.event;
const TICK_MS = 50;

function subscribePrefs(callback: () => void) {
  window.addEventListener(PREFS_EVENT, callback);
  return () => window.removeEventListener(PREFS_EVENT, callback);
}

function readFlag(field: AudioPrefField) {
  const stored = window.localStorage.getItem(AUDIO_PREF_FIELDS[field].key);
  return stored === null ? false : stored === "1";
}

function readLevel(field: AudioPrefField, fallback: number) {
  const stored = window.localStorage.getItem(AUDIO_PREF_FIELDS[field].key);
  if (stored === null) {
    return fallback;
  }
  const value = Number(stored);
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : fallback;
}

const readMuted = () => readFlag("ambienceMuted");
const readVolume = () => readLevel("ambienceVolume", 0.6);
const readBedLevel = () => readLevel("ambienceBedLevel", 1);
const readMusicLevel = () => readLevel("ambienceMusicLevel", 1);

export type AmbienceTracks = Record<string, Array<{ url: string; title: string }>>;

export type AmbienceCounts = Record<"bed" | "music" | "sting", { installed: number; total: number; files: number }>;

export type AmbienceAudio = {
  muted: boolean;
  // The listener's master, and how the room and the music sit against it.
  volume: number;
  bedLevel: number;
  musicLevel: number;
  unlocked: boolean;
  // True once the library has at least one file. False means nobody has
  // installed the sound library, and the control says so rather than
  // offering a volume slider for silence.
  installed: boolean;
  // Which cues this install can play, with every take's title, and how much
  // of each layer that covers.
  tracks: AmbienceTracks;
  counts: AmbienceCounts | null;
  // What the server says is playing, held layers included.
  state: AmbienceState;
  // What this browser is actually doing with it.
  playing: PlayerSnapshot;
  setMuted: (muted: boolean) => void;
  setVolume: (volume: number) => void;
  setBedLevel: (level: number) => void;
  setMusicLevel: (level: number) => void;
  unlock: () => void;
  // The next take of a layer, now.
  skip: (layer: AmbienceLayerName) => void;
  // Held down while narration is speaking.
  setDucked: (ducked: boolean) => void;
};

const SILENT: PlayerSnapshot = {
  bed: { cueId: null, take: 0, takes: 0, playing: false },
  music: { cueId: null, take: 0, takes: 0, playing: false },
  blocked: false,
};

export function useAmbienceAudio(
  ambience: AmbienceState,
  sting: { cue: string; at: number } | null,
  enabled: boolean,
): AmbienceAudio {
  const muted = useSyncExternalStore(subscribePrefs, readMuted, () => true);
  const volume = useSyncExternalStore(subscribePrefs, readVolume, () => 0.6);
  const bedLevel = useSyncExternalStore(subscribePrefs, readBedLevel, () => 1);
  const musicLevel = useSyncExternalStore(subscribePrefs, readMusicLevel, () => 1);
  const [unlocked, setUnlocked] = useState(false);
  const [tracks, setTracks] = useState<AmbienceTracks | null>(null);
  const [counts, setCounts] = useState<AmbienceCounts | null>(null);
  const [playing, setPlaying] = useState<PlayerSnapshot>(SILENT);
  const playerRef = useRef<AmbiencePlayer | null>(null);
  // The last sting timestamp acted on, so a re-render never sounds it twice.
  const stingAtRef = useRef(0);

  // One player per mount, ticking while mounted, gone at unmount.
  useEffect(() => {
    const player = new AmbiencePlayer({
      create: (url) => registerOutput(new Audio(url)),
      release: (audio) => releaseOutput(audio as HTMLAudioElement),
      now: () => performance.now(),
    });
    playerRef.current = player;
    const unsubscribe = player.onChange(() => setPlaying(player.snapshot()));
    const timer = window.setInterval(() => player.tick(), TICK_MS);
    return () => {
      window.clearInterval(timer);
      unsubscribe();
      player.dispose();
      playerRef.current = null;
    };
  }, []);

  // Which cues this install can actually play. One fetch per mount; a table
  // with no library gets an empty map and the whole hook goes quiet.
  useEffect(() => {
    if (!enabled) {
      return;
    }
    let cancelled = false;
    fetch("/api/ambience")
      .then((response) => (response.ok ? response.json() : { tracks: {} }))
      .then((data) => {
        if (!cancelled) {
          setTracks(data.tracks ?? {});
          setCounts(data.counts ?? null);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setTracks({});
        }
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  // The account copy of the prefs, applied over localStorage unless the
  // user touched a control first (src/lib/audio-prefs.ts).
  useEffect(() => {
    hydrateAudioPrefs();
  }, []);

  useEffect(() => {
    const urls: Record<string, string[]> = {};
    for (const [cueId, takes] of Object.entries(tracks ?? {})) {
      urls[cueId] = takes.map((take) => take.url);
    }
    playerRef.current?.setTracks(urls);
  }, [tracks]);

  useEffect(() => {
    playerRef.current?.setScene(enabled ? ambience.bed : null, enabled ? ambience.music : null);
  }, [ambience.bed, ambience.music, enabled]);

  useEffect(() => {
    playerRef.current?.setLevels({ master: volume, bed: bedLevel, music: musicLevel, muted });
  }, [volume, bedLevel, musicLevel, muted]);

  useEffect(() => {
    playerRef.current?.setUnlocked(unlocked && enabled);
  }, [unlocked, enabled]);

  const setMuted = useCallback((next: boolean) => writeAudioPref("ambienceMuted", next), []);
  const setVolume = useCallback((next: number) => writeAudioPref("ambienceVolume", Math.max(0, Math.min(1, next))), []);
  const setBedLevel = useCallback((next: number) => writeAudioPref("ambienceBedLevel", Math.max(0, Math.min(1, next))), []);
  const setMusicLevel = useCallback((next: number) => writeAudioPref("ambienceMusicLevel", Math.max(0, Math.min(1, next))), []);
  const unlock = useCallback(() => setUnlocked(true), []);
  const skip = useCallback((layer: AmbienceLayerName) => playerRef.current?.skip(layer), []);
  const setDucked = useCallback((ducked: boolean) => playerRef.current?.setLevels({ ducked }), []);

  // The browser refuses audio before a user gesture, so any first
  // interaction with the page counts, exactly as it does for narration.
  useEffect(() => {
    if (unlocked || !enabled) {
      return;
    }
    const handle = () => setUnlocked(true);
    window.addEventListener("pointerdown", handle, { once: true });
    window.addEventListener("keydown", handle, { once: true });
    return () => {
      window.removeEventListener("pointerdown", handle);
      window.removeEventListener("keydown", handle);
    };
  }, [unlocked, enabled]);

  useEffect(() => {
    if (!sting || sting.at <= stingAtRef.current) {
      return;
    }
    stingAtRef.current = sting.at;
    if (enabled) {
      playerRef.current?.sting(sting.cue);
    }
  }, [sting, enabled]);

  const installed = Boolean(tracks && Object.keys(tracks).length);
  // One object per real change, so the memoized header is not handed a new
  // ambience prop on every table render.
  return useMemo(
    () => ({
      muted,
      volume,
      bedLevel,
      musicLevel,
      unlocked,
      installed,
      tracks: tracks ?? {},
      counts,
      state: ambience,
      playing,
      setMuted,
      setVolume,
      setBedLevel,
      setMusicLevel,
      unlock,
      skip,
      setDucked,
    }),
    [muted, volume, bedLevel, musicLevel, unlocked, installed, tracks, counts, ambience, playing, setMuted, setVolume, setBedLevel, setMusicLevel, unlock, skip, setDucked],
  );
}
