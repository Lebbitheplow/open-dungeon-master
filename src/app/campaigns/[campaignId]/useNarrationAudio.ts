"use client";

import { useCallback, useRef, useState, useSyncExternalStore } from "react";

// Plays DM narration audio (tts_ready events). Only events that arrive
// AFTER mount autoplay, and only the newest one; reconnect backlog never
// replays old narration. Mute and volume are per-user (localStorage),
// exposed through useSyncExternalStore so server render stays muted and
// the client snapshot takes over at hydration without a setState cascade.

const MUTED_KEY = "odm_tts_muted";
const VOLUME_KEY = "odm_tts_volume";
const PREFS_EVENT = "odm-tts-prefs";

function subscribePrefs(callback: () => void) {
  window.addEventListener(PREFS_EVENT, callback);
  return () => window.removeEventListener(PREFS_EVENT, callback);
}

function readMuted() {
  const stored = window.localStorage.getItem(MUTED_KEY);
  return stored === null ? false : stored === "1";
}

function readVolume() {
  const stored = Number(window.localStorage.getItem(VOLUME_KEY));
  return Number.isFinite(stored) && stored > 0 ? Math.min(1, stored) : 0.8;
}

export type NarrationAudio = {
  muted: boolean;
  volume: number;
  unlocked: boolean;
  setMuted: (muted: boolean) => void;
  setVolume: (volume: number) => void;
  unlock: () => void;
  play: (url: string) => void;
  audioByMessage: Map<string, string>;
  onTtsReady: (messageId: string, url: string, live: boolean) => void;
};

export function useNarrationAudio(): NarrationAudio {
  const muted = useSyncExternalStore(subscribePrefs, readMuted, () => true);
  const volume = useSyncExternalStore(subscribePrefs, readVolume, () => 0.8);
  const [unlocked, setUnlocked] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [audioByMessage] = useState(() => new Map<string, string>());
  const unlockedRef = useRef(false);

  const setMuted = useCallback((next: boolean) => {
    window.localStorage.setItem(MUTED_KEY, next ? "1" : "0");
    window.dispatchEvent(new Event(PREFS_EVENT));
    if (next) {
      audioRef.current?.pause();
    }
  }, []);

  const setVolume = useCallback((next: number) => {
    const clamped = Math.max(0, Math.min(1, next));
    window.localStorage.setItem(VOLUME_KEY, String(clamped));
    window.dispatchEvent(new Event(PREFS_EVENT));
    if (audioRef.current) {
      audioRef.current.volume = clamped;
    }
  }, []);

  const play = useCallback((url: string) => {
    if (!audioRef.current) {
      audioRef.current = new Audio();
    }
    const audio = audioRef.current;
    audio.src = url;
    audio.volume = readVolume();
    audio.play().catch(() => {
      // Autoplay blocked until a user gesture; the unlock button handles it.
    });
  }, []);

  // The browser requires a user gesture before audio can play; the header
  // speaker toggle doubles as that gesture.
  const unlock = useCallback(() => {
    setUnlocked(true);
    unlockedRef.current = true;
  }, []);

  const onTtsReady = useCallback(
    (messageId: string, url: string, live: boolean) => {
      audioByMessage.set(messageId, url);
      if (live && !readMuted() && unlockedRef.current) {
        play(url);
      }
    },
    [audioByMessage, play],
  );

  return { muted, volume, unlocked, setMuted, setVolume, unlock, play, audioByMessage, onTtsReady };
}
