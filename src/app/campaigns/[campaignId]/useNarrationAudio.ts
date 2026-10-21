"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { registerOutput, releaseOutput } from "@/lib/audio-devices";
import { AUDIO_PREF_FIELDS, hydrateAudioPrefs, writeAudioPref } from "@/lib/audio-prefs";

// Plays DM narration audio (tts_ready events). Only events that arrive
// AFTER mount autoplay; reconnect backlog never replays old narration.
// Narrations queue: a new one never interrupts the one playing, it waits
// its turn (manual replay is explicit intent and may interrupt). Mute and
// volume are per-user (localStorage), exposed through useSyncExternalStore
// so server render stays muted and the client snapshot takes over at
// hydration without a setState cascade. The account keeps a copy so another
// browser starts the same way; audio-prefs.ts owns that sync.
//
// Playback that fails is never dropped in silence (issue 88): a browser that
// refuses to autoplay hands the narration back to wait for the next gesture,
// and an audio file that will not load or decode is named in playbackFailure
// so the passage can say so.
//
// A table break (src/lib/dm/table-break.ts) holds narration on every screen:
// `onBreak` stops whatever is being read (it goes back to the front of the
// line, to be heard whole), nothing new starts, and what lands meanwhile
// queues. Resume plays the line in order, each passage from its finished
// file when that is ready, since a live stream may be gone by then. A replay
// pressed during the break is the listener's own choice and still plays.

const MUTED_KEY = AUDIO_PREF_FIELDS.narrationMuted.key;
const VOLUME_KEY = AUDIO_PREF_FIELDS.narrationVolume.key;
const PREFS_EVENT = AUDIO_PREF_FIELDS.narrationMuted.event;

function subscribePrefs(callback: () => void) {
  window.addEventListener(PREFS_EVENT, callback);
  return () => window.removeEventListener(PREFS_EVENT, callback);
}

function readMuted() {
  const stored = window.localStorage.getItem(MUTED_KEY);
  return stored === null ? false : stored === "1";
}

export function readVolume() {
  const stored = window.localStorage.getItem(VOLUME_KEY);
  if (stored === null) {
    return 0.8;
  }
  const value = Number(stored);
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0.8;
}

export type NarrationAudio = {
  muted: boolean;
  volume: number;
  unlocked: boolean;
  playingMessageId: string | null;
  // How many narrations the browser is holding back until a gesture on this
  // page (pendingRef's length). The table says so above the composer and on
  // the header's narration icon, because a struck-through icon alone was
  // easy to miss for someone watching an AI party play without clicking.
  held: number;
  // The message whose audio this device last failed to play, if any.
  playbackFailure: string | null;
  setMuted: (muted: boolean) => void;
  setVolume: (volume: number) => void;
  unlock: () => void;
  play: (messageId: string, url: string) => void;
  audioByMessage: Map<string, string>;
  onTtsReady: (messageId: string, url: string, live: boolean) => void;
};

export function useNarrationAudio(onBreak = false): NarrationAudio {
  const muted = useSyncExternalStore(subscribePrefs, readMuted, () => true);
  const volume = useSyncExternalStore(subscribePrefs, readVolume, () => 0.8);
  const [unlocked, setUnlocked] = useState(false);
  const [playingMessageId, setPlayingMessageId] = useState<string | null>(null);
  const [playbackFailure, setPlaybackFailure] = useState<string | null>(null);
  const [held, setHeld] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [audioByMessage] = useState(() => new Map<string, string>());
  const unlockedRef = useRef(false);
  const playingRef = useRef<string | null>(null);
  // Narrations wait for the current one instead of cutting it off.
  const queueRef = useRef<Array<{ messageId: string; url: string }>>([]);
  // Every messageId ever started or queued; guards against replays when the
  // same tts_ready re-enters through re-renders or reducer echoes.
  const handledRef = useRef(new Set<string>());
  // Narration that landed before the first user gesture. SessionView hands
  // each message over exactly once, so they wait here, oldest first, and
  // unlock() plays the newest; the rest keep their transcript replay.
  const pendingRef = useRef<Array<{ messageId: string; url: string }>>([]);
  // Every change to pendingRef goes through here so `held` follows it.
  const setPending = useCallback((next: Array<{ messageId: string; url: string }>) => {
    pendingRef.current = next;
    setHeld(next.length);
  }, []);
  // A table break is on: nothing starts by itself.
  const breakRef = useRef(onBreak);

  // The account copy of the prefs, applied over localStorage unless the
  // user touched a control first.
  useEffect(() => {
    hydrateAudioPrefs();
  }, []);

  // Unmount: the one element this hook owns stops and leaves the output
  // router, which otherwise keeps it for the life of the page.
  useEffect(() => {
    return () => {
      const audio = audioRef.current;
      if (audio) {
        audio.pause();
        audio.src = "";
        releaseOutput(audio);
        audioRef.current = null;
      }
    };
  }, []);

  const setMuted = useCallback((next: boolean) => {
    writeAudioPref("narrationMuted", next);
    if (next) {
      audioRef.current?.pause();
      queueRef.current = [];
      setPending([]);
      playingRef.current = null;
      setPlayingMessageId(null);
    }
  }, [setPending]);

  const setVolume = useCallback((next: number) => {
    const clamped = Math.max(0, Math.min(1, next));
    writeAudioPref("narrationVolume", clamped);
    if (audioRef.current) {
      audioRef.current.volume = clamped;
    }
  }, []);

  const startPlayback = useCallback((messageId: string, url: string) => {
    // Named plain function so playback can chain into the queued narration
    // when the current one ends.
    function run(id: string, src: string) {
      if (!audioRef.current) {
        audioRef.current = registerOutput(new Audio());
      }
      const audio = audioRef.current;
      const finish = () => {
        if (playingRef.current !== id) {
          return;
        }
        playingRef.current = null;
        setPlayingMessageId(null);
        if (breakRef.current) {
          return;
        }
        const next = queueRef.current.shift();
        if (next && !readMuted()) {
          run(next.messageId, next.url);
        }
      };
      const fail = () => {
        if (playingRef.current === id) {
          setPlaybackFailure(id);
        }
        finish();
      };
      audio.onended = finish;
      audio.onerror = fail;
      playingRef.current = id;
      setPlayingMessageId(id);
      setPlaybackFailure((current) => (current === id ? null : current));
      audio.src = src;
      audio.volume = readVolume();
      audio.play().catch((error: unknown) => {
        if (playingRef.current !== id) {
          return;
        }
        if (error instanceof DOMException && error.name === "NotAllowedError") {
          // The browser wants a gesture first (a tab that was never
          // touched, or one that sat idle). This narration is offered only
          // once, so it goes back to wait, along with whatever queued
          // behind it, and the header shows the "enable audio" state again.
          // Oldest first, so the next unlock() plays only the newest of them
          // and leaves the rest to their replay buttons, as at first load.
          setPending([{ messageId: id, url: src }, ...queueRef.current, ...pendingRef.current]);
          queueRef.current = [];
          playingRef.current = null;
          setPlayingMessageId(null);
          unlockedRef.current = false;
          setUnlocked(false);
          return;
        }
        // A pause() that interrupts a play() rejects with AbortError: that
        // is this hook stopping it, not a failure.
        if (error instanceof DOMException && error.name === "AbortError") {
          finish();
          return;
        }
        fail();
      });
    }
    run(messageId, url);
  }, [setPending]);

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
    // Only the newest passage that arrived before this gesture plays, on the
    // same "never interrupt what is playing" rule as live narration. A tab
    // watched for an hour can hold ten minutes of narration, and playing it
    // all back to back would bury the live scene under stale passages (the
    // server skips narration that fell behind on the same rule). The older
    // ones keep their replay buttons in the transcript (audioByMessage).
    const waiting = pendingRef.current;
    if (waiting.length) {
      setPending([]);
    }
    const newest = waiting[waiting.length - 1];
    if (!newest || readMuted()) {
      return;
    }
    if (playingRef.current || breakRef.current) {
      queueRef.current.push(newest);
      return;
    }
    startPlayback(newest.messageId, newest.url);
  }, [setPending, startPlayback]);

  // The break begins: the passage being read stops and waits at the front
  // of the line. It ends: the line plays, oldest first.
  useEffect(() => {
    breakRef.current = onBreak;
    if (onBreak) {
      const current = playingRef.current;
      if (!current) {
        return;
      }
      const audio = audioRef.current;
      playingRef.current = null;
      setPlayingMessageId(null);
      if (audio) {
        audio.onended = null;
        audio.onerror = null;
        audio.pause();
      }
      queueRef.current.unshift({ messageId: current, url: audioByMessage.get(current) ?? audio?.src ?? "" });
      return;
    }
    if (playingRef.current || !unlockedRef.current || readMuted()) {
      return;
    }
    const next = queueRef.current.shift();
    if (next) {
      startPlayback(next.messageId, audioByMessage.get(next.messageId) ?? next.url);
    }
  }, [onBreak, audioByMessage, startPlayback]);

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
      if (!live || readMuted() || handledRef.current.has(messageId)) {
        return;
      }
      handledRef.current.add(messageId);
      // The browser refuses to play before a user gesture, so hold rather
      // than drop: this narration is never offered a second time.
      if (!unlockedRef.current) {
        setPending([...pendingRef.current, { messageId, url }]);
        return;
      }
      if (playingRef.current || breakRef.current) {
        queueRef.current.push({ messageId, url });
      } else {
        startPlayback(messageId, url);
      }
    },
    [audioByMessage, setPending, startPlayback],
  );

  // One object per real change, so the memoized header and the chat column
  // are not handed a new narration prop on every table render.
  return useMemo(
    () => ({
      muted,
      volume,
      unlocked,
      playingMessageId,
      held,
      playbackFailure,
      setMuted,
      setVolume,
      unlock,
      play,
      audioByMessage,
      onTtsReady,
    }),
    [muted, volume, unlocked, playingMessageId, held, playbackFailure, setMuted, setVolume, unlock, play, audioByMessage, onTtsReady],
  );
}
