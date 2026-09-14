"use client";

import { useEffect, useSyncExternalStore } from "react";

// Whether this device plays the decorative half of the board: particle
// bursts, auras breathing, the sky's rain, the slow drift on scene art. The
// engine-tied half (a hit flashes, a number rises, a ring recolours) always
// plays, because those are facts. Stored per device, like the microphone
// and dice preferences, with an automatic "low" on machines that report
// under 4 GB or that the app shell has flagged as a low device class.
//
// The root <html> carries data-effects="low" so CSS can drop the loops
// without every component asking (globals.css).

const KEY = "odm:effects";
const EVENT = "odm-effects-pref";

export type EffectsMode = "full" | "low";

declare global {
  interface Window {
    // Set by the desktop and Android shells before any page script runs.
    odm?: {
      deviceClass?: "low" | "standard";
      haptic?: (kind: string) => void;
      // The Android app opens a host document with the system viewer
      // (docs/vtt-parity-implementation-plan.md 18.2, phase 21).
      openDocument?: (path: string) => Promise<boolean>;
    };
  }
  interface Navigator {
    deviceMemory?: number;
  }
}

function autoMode(): EffectsMode {
  if (typeof window === "undefined") {
    return "full";
  }
  if (window.odm?.deviceClass === "low") {
    return "low";
  }
  const memory = navigator.deviceMemory;
  if (typeof memory === "number" && memory < 4) {
    return "low";
  }
  return "full";
}

export function readEffectsMode(): EffectsMode {
  if (typeof window === "undefined") {
    return "full";
  }
  const stored = window.localStorage.getItem(KEY);
  if (stored === "full" || stored === "low") {
    return stored;
  }
  return autoMode();
}

export function writeEffectsMode(mode: EffectsMode | "auto") {
  if (mode === "auto") {
    window.localStorage.removeItem(KEY);
  } else {
    window.localStorage.setItem(KEY, mode);
  }
  window.dispatchEvent(new Event(EVENT));
}

export function isEffectsAuto(): boolean {
  return typeof window !== "undefined" && window.localStorage.getItem(KEY) === null;
}

function subscribe(listener: () => void) {
  window.addEventListener(EVENT, listener);
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener(EVENT, listener);
    window.removeEventListener("storage", listener);
  };
}

export function useEffectsMode(): EffectsMode {
  return useSyncExternalStore(subscribe, readEffectsMode, () => "full");
}

export function useLowEffects(): boolean {
  return useEffectsMode() === "low";
}

// Mirrors the mode onto <html data-effects> so CSS-only consumers follow.
export function useEffectsRoot() {
  const mode = useEffectsMode();
  useEffect(() => {
    document.documentElement.dataset.effects = mode;
  }, [mode]);
}

// The your-turn chime: a short sting and a gold pulse on the composer when
// the initiative lands on you (docs/vtt-parity-implementation-plan.md
// section 4.3). On by default; a per-device preference like the rest.
const CHIME_KEY = "odm:turnChime";
const CHIME_EVENT = "odm-turn-chime-pref";

export function readTurnChime(): boolean {
  return typeof window === "undefined" ? true : window.localStorage.getItem(CHIME_KEY) !== "off";
}

export function writeTurnChime(on: boolean) {
  window.localStorage.setItem(CHIME_KEY, on ? "on" : "off");
  window.dispatchEvent(new Event(CHIME_EVENT));
}

export function useTurnChime(): boolean {
  return useSyncExternalStore(
    (listener) => {
      window.addEventListener(CHIME_EVENT, listener);
      window.addEventListener("storage", listener);
      return () => {
        window.removeEventListener(CHIME_EVENT, listener);
        window.removeEventListener("storage", listener);
      };
    },
    readTurnChime,
    () => true,
  );
}

// Reduced motion is the master switch: when the OS asks for it, the board
// plays captions and ring changes only, whatever the effects mode says.
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

// Haptics through the app shell when it offers them; a no-op on the web.
export function haptic(kind: "hit" | "crit" | "turn" | "tap") {
  try {
    window.odm?.haptic?.(kind);
  } catch {
    // The shell said it could and could not; nothing to do.
  }
}
