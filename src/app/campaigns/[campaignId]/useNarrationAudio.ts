"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

// Plays DM narration audio (tts_ready events). Only events that arrive
// AFTER mount autoplay; reconnect backlog never replays old narration.
// Narrations queue: a new one never interrupts the one playing, it waits
// its turn (manual replay is explicit intent and may interrupt). Mute and
// volume are per-user (localStorage), exposed through useSyncExternalStore
// so server render stays muted and the client snapshot takes over at
// hydration without a setState cascade.

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
  playingMessageId: string | null;
  setMuted: (muted: boolean) => void;
  setVolume: (volume: number) => void;
  unlock: () => void;
  play: (messageId: string, url: string) => void;
  audioByMessage: Map<string, string>;
  onTtsReady: (messageId: string, url: string, live: boolean) => void;
};

export function useNarrationAudio(): NarrationAudio {
  const muted = useSyncExternalStore(subscribePrefs, readMuted, () => true);
  const volume = useSyncExternalStore(subscribePrefs, readVolume, () => 0.8);
  const [unlocked, setUnlocked] = useState(false);
  const [playingMessageId, setPlayingMessageId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [audioByMessage] = useState(() => new Map<string, string>());
  const unlockedRef = useRef(false);
  const playingRef = useRef<string | null>(null);
  // Narrations wait for the current one instead of cutting it off.
  const queueRef = useRef<Array<{ messageId: string; url: string }>>([]);
  // Every messageId ever started or queued; guards against replays when the
  // same tts_ready re-enters through re-renders or reducer echoes.
  const handledRef = useRef(new Set<string>());

  const setMuted = useCallback((next: boolean) => {
    window.localStorage.setItem(MUTED_KEY, next ? "1" : "0");
    window.dispatchEvent(new Event(PREFS_EVENT));
    if (next) {
      audioRef.current?.pause();
      queueRef.current = [];
      playingRef.current = null;
      setPlayingMessageId(null);
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

  const startPlayback = useCallback((messageId: string, url: string) => {
    // Named plain function so playback can chain into the queued narration
    // when the current one ends.
    function run(id: string, src: string) {
      if (!audioRef.current) {
        audioRef.current = new Audio();
      }
      const audio = audioRef.current;
      const finish = () => {
        if (playingRef.current !== id) {
          return;
        }
        playingRef.current = null;
        setPlayingMessageId(null);
        const next = queueRef.current.shift();
        if (next && !readMuted()) {
          run(next.messageId, next.url);
        }
      };
      audio.onended = finish;
      audio.onerror = finish;
      playingRef.current = id;
      setPlayingMessageId(id);
      audio.src = src;
      audio.volume = readVolume();
      audio.play().catch(() => {
        // Autoplay blocked until a user gesture; the unlock handlers cover it.
        finish();
      });
    }
    run(messageId, url);
  }, []);

  // Explicit replay: interrupts whatever is playing and clears the queue.
  const play = useCallback(
    (messageId: string, url: string) => {
      queueRef.current = [];
      startPlayback(messageId, url);
    },
    [startPlayback],
  );

  // The browser requires a user gesture before audio can play; the header
  // speaker toggle doubles as that gesture.
  const unlock = useCallback(() => {
    setUnlocked(true);
    unlockedRef.current = true;
  }, []);

  // Any first interaction with the page (click, key press) also counts as
  // the unlock gesture, so narration autoplays without hunting for the
  // speaker button.
  useEffect(() => {
    if (unlocked) {
      return;
    }
    const handle = () => unlock();
    window.addEventListener("pointerdown", handle, { once: true });
    window.addEventListener("keydown", handle, { once: true });
    return () => {
      window.removeEventListener("pointerdown", handle);
      window.removeEventListener("keydown", handle);
    };
  }, [unlocked, unlock]);

  const onTtsReady = useCallback(
    (messageId: string, url: string, live: boolean) => {
      audioByMessage.set(messageId, url);
      if (!live || readMuted() || !unlockedRef.current || handledRef.current.has(messageId)) {
        return;
      }
      handledRef.current.add(messageId);
      if (playingRef.current) {
        queueRef.current.push({ messageId, url });
      } else {
        startPlayback(messageId, url);
      }
    },
    [audioByMessage, startPlayback],
  );

  return {
    muted,
    volume,
    unlocked,
    playingMessageId,
    setMuted,
    setVolume,
    unlock,
    play,
    audioByMessage,
    onTtsReady,
  };
}
