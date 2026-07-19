"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";

// Chimes when the private-chat unread total (player side chats plus DM
// whispers) grows. The mute preference is per-user localStorage exposed via
// useSyncExternalStore, same pattern as useNarrationAudio: server render is
// muted and the client snapshot takes over at hydration.

const MUTED_KEY = "odm_chat_chime_muted";
const PREFS_EVENT = "odm-chime-prefs";

function subscribePrefs(callback: () => void) {
  window.addEventListener(PREFS_EVENT, callback);
  return () => window.removeEventListener(PREFS_EVENT, callback);
}

function readMuted() {
  return window.localStorage.getItem(MUTED_KEY) === "1";
}

export function setChimeMuted(muted: boolean) {
  window.localStorage.setItem(MUTED_KEY, muted ? "1" : "0");
  window.dispatchEvent(new Event(PREFS_EVENT));
}

export function useChimeMuted(): boolean {
  return useSyncExternalStore(subscribePrefs, readMuted, () => true);
}

// Two short rising sine notes, synthesized so no audio asset ships.
let chimeContext: AudioContext | null = null;

function playChime() {
  try {
    if (!chimeContext) {
      chimeContext = new AudioContext();
    }
    const ctx = chimeContext;
    if (ctx.state === "suspended") {
      void ctx.resume();
    }
    const now = ctx.currentTime;
    for (const note of [
      { frequency: 880, at: 0 },
      { frequency: 1318.5, at: 0.13 },
    ]) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = note.frequency;
      gain.gain.setValueAtTime(0.15, now + note.at);
      gain.gain.exponentialRampToValueAtTime(0.001, now + note.at + 0.25);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + note.at);
      osc.stop(now + note.at + 0.3);
    }
  } catch {
    // No usable audio output; the visual indicators still cover it.
  }
}

// `loaded` gates the baseline: the first observed total after load counts
// as backlog and stays silent; only later increases chime.
export function useChatChime(totalUnread: number, loaded: boolean) {
  const muted = useChimeMuted();
  const previousRef = useRef<number | null>(null);
  const unlockedRef = useRef(false);

  // Browsers block audio before a user gesture; the first interaction with
  // the page unlocks the chime, matching useNarrationAudio.
  useEffect(() => {
    const handle = () => {
      unlockedRef.current = true;
    };
    window.addEventListener("pointerdown", handle, { once: true });
    window.addEventListener("keydown", handle, { once: true });
    return () => {
      window.removeEventListener("pointerdown", handle);
      window.removeEventListener("keydown", handle);
    };
  }, []);

  useEffect(() => {
    if (!loaded) {
      return;
    }
    if (previousRef.current === null) {
      previousRef.current = totalUnread;
      return;
    }
    if (totalUnread > previousRef.current && !muted && unlockedRef.current) {
      playChime();
    }
    previousRef.current = totalUnread;
  }, [totalUnread, loaded, muted]);
}
