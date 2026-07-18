"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Plays DM narration audio (tts_ready events). Only events that arrive
// AFTER mount autoplay, and only the newest one; reconnect backlog never
// replays old narration. Mute and volume are per-user (localStorage).

const MUTED_KEY = "odm_tts_muted";
const VOLUME_KEY = "odm_tts_volume";

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
  const [muted, setMutedState] = useState(true);
  const [volume, setVolumeState] = useState(0.8);
  const [unlocked, setUnlocked] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [audioByMessage] = useState(() => new Map<string, string>());
  const mutedRef = useRef(muted);
  const volumeRef = useRef(volume);
  const unlockedRef = useRef(false);

  useEffect(() => {
    const storedMuted = window.localStorage.getItem(MUTED_KEY);
    const storedVolume = Number(window.localStorage.getItem(VOLUME_KEY));
    if (storedMuted !== null) {
      setMutedState(storedMuted === "1");
      mutedRef.current = storedMuted === "1";
    } else {
      setMutedState(false);
      mutedRef.current = false;
    }
    if (Number.isFinite(storedVolume) && storedVolume > 0) {
      setVolumeState(storedVolume);
      volumeRef.current = storedVolume;
    }
  }, []);

  const setMuted = useCallback((next: boolean) => {
    setMutedState(next);
    mutedRef.current = next;
    window.localStorage.setItem(MUTED_KEY, next ? "1" : "0");
    if (next) {
      audioRef.current?.pause();
    }
  }, []);

  const setVolume = useCallback((next: number) => {
    const clamped = Math.max(0, Math.min(1, next));
    setVolumeState(clamped);
    volumeRef.current = clamped;
    window.localStorage.setItem(VOLUME_KEY, String(clamped));
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
    audio.volume = volumeRef.current;
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
      if (live && !mutedRef.current && unlockedRef.current) {
        play(url);
      }
    },
    [audioByMessage, play],
  );

  return { muted, volume, unlocked, setMuted, setVolume, unlock, play, audioByMessage, onTtsReady };
}
