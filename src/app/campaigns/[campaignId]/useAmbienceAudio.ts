"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { cueById } from "@/lib/ambience/catalog";
import type { AmbienceState } from "@/lib/ambience/logic";

// Plays what the table is hearing, in this browser, at this listener's own
// volume.
//
// The server decides WHAT plays and every seat gets the same answer; how
// loud it is, and whether it plays at all, is nobody's business but the
// person wearing the headphones. So the cue rides the campaign stream and
// the volume lives in localStorage, exactly the split narration audio uses
// (useNarrationAudio.ts), read through useSyncExternalStore so the server
// render starts muted and the client snapshot takes over at hydration.
//
// Two looping layers and a one-shot. A layer changing cue crossfades rather
// than cutting, because a hard cut is the thing that makes people reach for
// the mute button.

const MUTED_KEY = "odm_ambience_muted";
const VOLUME_KEY = "odm_ambience_volume";
const PREFS_EVENT = "odm-ambience-prefs";

const CROSSFADE_MS = 1200;
const FADE_TICK_MS = 50;
// How far ambience drops while the DM's narration is being read aloud. Not
// silence: the room should still be there behind the voice.
const DUCK = 0.3;

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
  return Number.isFinite(stored) && stored > 0 ? Math.min(1, stored) : 0.6;
}

type Layer = {
  cueId: string | null;
  audio: HTMLAudioElement | null;
  // Set while the current element is fading in; the volume effect leaves a
  // fading layer alone rather than fighting the ramp.
  fade: ReturnType<typeof setInterval> | null;
};

function emptyLayer(): Layer {
  return { cueId: null, audio: null, fade: null };
}

// Ramps `audio` from where it is to `target()` (read live, so a listener
// dragging the slider mid-fade is obeyed) and calls done() at the end.
function ramp(
  audio: HTMLAudioElement,
  from: number,
  target: () => number,
  done?: () => void,
): ReturnType<typeof setInterval> {
  const steps = Math.max(1, Math.round(CROSSFADE_MS / FADE_TICK_MS));
  let step = 0;
  const timer = setInterval(() => {
    step += 1;
    const progress = Math.min(1, step / steps);
    audio.volume = Math.max(0, Math.min(1, from + (target() - from) * progress));
    if (progress >= 1) {
      clearInterval(timer);
      done?.();
    }
  }, FADE_TICK_MS);
  return timer;
}

export type AmbienceAudio = {
  muted: boolean;
  volume: number;
  unlocked: boolean;
  // True once the manifest says this install has at least one file. False
  // means nobody has run scripts/fetch-ambience.mjs, and the control hides
  // rather than offering a volume slider for silence.
  installed: boolean;
  setMuted: (muted: boolean) => void;
  setVolume: (volume: number) => void;
  unlock: () => void;
  // Held down while narration is speaking.
  setDucked: (ducked: boolean) => void;
};

export function useAmbienceAudio(
  ambience: AmbienceState,
  sting: { cue: string; at: number } | null,
  enabled: boolean,
): AmbienceAudio {
  const muted = useSyncExternalStore(subscribePrefs, readMuted, () => true);
  const volume = useSyncExternalStore(subscribePrefs, readVolume, () => 0.6);
  const [unlocked, setUnlocked] = useState(false);
  const [urls, setUrls] = useState<Record<string, string> | null>(null);
  const duckedRef = useRef(false);
  const layersRef = useRef<{ bed: Layer; music: Layer }>({
    bed: emptyLayer(),
    music: emptyLayer(),
  });
  // The last sting timestamp acted on, so a re-render never sounds it twice.
  const stingAtRef = useRef(0);

  // What one layer should be playing at right now, before any fade.
  const targetVolume = useCallback(
    (cueId: string | null) => {
      const gain = cueId ? (cueById(cueId)?.gain ?? 0.5) : 0;
      return muted ? 0 : volume * gain * (duckedRef.current ? DUCK : 1);
    },
    [muted, volume],
  );

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
          setUrls(data.tracks ?? {});
        }
      })
      .catch(() => {
        if (!cancelled) {
          setUrls({});
        }
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  const setMuted = useCallback((next: boolean) => {
    window.localStorage.setItem(MUTED_KEY, next ? "1" : "0");
    window.dispatchEvent(new Event(PREFS_EVENT));
  }, []);

  const setVolume = useCallback((next: number) => {
    const clamped = Math.max(0, Math.min(1, next));
    window.localStorage.setItem(VOLUME_KEY, String(clamped));
    window.dispatchEvent(new Event(PREFS_EVENT));
  }, []);

  const unlock = useCallback(() => setUnlocked(true), []);

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

  // The one place a looping layer starts, stops or changes cue.
  useEffect(() => {
    if (!urls) {
      return;
    }
    const layers = layersRef.current;
    for (const name of ["bed", "music"] as const) {
      const layer = layers[name];
      const wanted = !enabled || muted || !unlocked ? null : ambience[name];
      const url = wanted ? urls[wanted] : undefined;
      // A cue with no file on this install is silence, not an error: the
      // library is fetched separately and may be partial.
      const cueId = url ? wanted : null;
      if (cueId === layer.cueId) {
        continue;
      }

      if (layer.fade) {
        clearInterval(layer.fade);
        layer.fade = null;
      }
      const outgoing = layer.audio;
      if (outgoing) {
        ramp(outgoing, outgoing.volume, () => 0, () => {
          outgoing.pause();
          outgoing.src = "";
        });
      }
      layer.cueId = cueId;
      layer.audio = null;
      if (!cueId || !url) {
        continue;
      }
      const audio = new Audio(url);
      audio.loop = true;
      audio.volume = 0;
      layer.audio = audio;
      layer.fade = ramp(audio, 0, () => targetVolume(cueId), () => {
        layer.fade = null;
      });
      audio.play().catch(() => {
        // Autoplay still blocked, or the file went missing. Drop the layer
        // rather than leaving a silent element claiming to be playing; the
        // next unlock or cue change tries again.
        if (layer.audio === audio) {
          if (layer.fade) {
            clearInterval(layer.fade);
            layer.fade = null;
          }
          layer.cueId = null;
          layer.audio = null;
        }
      });
    }
  }, [ambience, urls, enabled, muted, unlocked, targetVolume]);

  // Volume, mute and ducking retarget what is already playing. A layer
  // mid-crossfade is skipped: its ramp reads targetVolume live and lands on
  // the new number by itself.
  const applyVolumes = useCallback(() => {
    for (const name of ["bed", "music"] as const) {
      const layer = layersRef.current[name];
      if (layer.audio && !layer.fade) {
        layer.audio.volume = targetVolume(layer.cueId);
      }
    }
  }, [targetVolume]);

  useEffect(() => {
    applyVolumes();
  }, [applyVolumes]);

  const setDucked = useCallback(
    (ducked: boolean) => {
      if (duckedRef.current === ducked) {
        return;
      }
      duckedRef.current = ducked;
      applyVolumes();
    },
    [applyVolumes],
  );

  // A sting plays over whatever is running and is never queued: if two land
  // together the second one is simply the one you hear.
  useEffect(() => {
    if (!sting || !urls || !enabled || muted || !unlocked) {
      return;
    }
    if (sting.at <= stingAtRef.current) {
      return;
    }
    stingAtRef.current = sting.at;
    const url = urls[sting.cue];
    if (!url) {
      return;
    }
    const audio = new Audio(url);
    audio.volume = Math.min(1, volume * (cueById(sting.cue)?.gain ?? 0.7));
    void audio.play().catch(() => {});
  }, [sting, urls, enabled, muted, unlocked, volume]);

  // Unmount: stop everything this hook started. Nothing here is shared, so
  // a torn-down session never leaves a loop running behind the lobby.
  useEffect(() => {
    const layers = layersRef.current;
    return () => {
      for (const name of ["bed", "music"] as const) {
        const layer = layers[name];
        if (layer.fade) {
          clearInterval(layer.fade);
        }
        layer.audio?.pause();
        layer.cueId = null;
        layer.audio = null;
        layer.fade = null;
      }
    };
  }, []);

  return {
    muted,
    volume,
    unlocked,
    installed: Boolean(urls && Object.keys(urls).length),
    setMuted,
    setVolume,
    unlock,
    setDucked,
  };
}
