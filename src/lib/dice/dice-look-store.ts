"use client";

// The account's dice look, cached on this device. Same shape as the audio
// preferences (src/lib/audio-prefs.ts): localStorage is what the tray
// reads, synchronously and offline; the account copy exists so a second
// device shows the same dice. Hydrate once per page load, write every
// change through on a short debounce (colour pickers fire continuously),
// and let a failed fetch in either direction change nothing visible.

import { useSyncExternalStore } from "react";
import {
  DEFAULT_DICE_LOOK,
  parseDiceLook,
  sameDiceLook,
  type DiceLook,
} from "@/lib/dice/dice-look";

export const DICE_LOOK_KEY = "odm:diceLook";
export const DICE_LOOK_EVENT = "odm-dice-look";

const FLUSH_DELAY_MS = 600;

let cached: DiceLook | null = null;
let cachedRaw: string | null = null;
let pending: DiceLook | null = null;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let hydration: Promise<void> | null = null;
let locallyWritten = false;

// Parsed once per distinct stored string so useSyncExternalStore sees a
// stable object between changes.
export function readDiceLook(): DiceLook {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(DICE_LOOK_KEY);
  } catch {
    // Storage unavailable: the default stands.
  }
  if (raw === cachedRaw && cached) {
    return cached;
  }
  cachedRaw = raw;
  cached = raw ? parseDiceLook(safeJson(raw)) : DEFAULT_DICE_LOOK;
  return cached;
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function store(look: DiceLook) {
  try {
    window.localStorage.setItem(DICE_LOOK_KEY, JSON.stringify(look));
  } catch {
    // Private browsing: the event still reaches this tab's subscribers.
  }
  window.dispatchEvent(new Event(DICE_LOOK_EVENT));
}

async function flush() {
  const look = pending;
  if (!look) {
    return;
  }
  pending = null;
  try {
    const response = await fetch("/api/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ settings: { diceLook: look } }),
    });
    if (!response.ok) {
      throw new Error(String(response.status));
    }
  } catch {
    // Offline or rejected: keep it for the next change to resend, unless a
    // newer look arrived meanwhile.
    if (!pending) {
      pending = look;
    }
  }
}

// Local write plus debounced write-through: the only setter, so the cache
// and the account can never drift apart on purpose.
export function writeDiceLook(look: DiceLook) {
  if (sameDiceLook(look, readDiceLook())) {
    return;
  }
  locallyWritten = true;
  store(look);
  pending = look;
  if (flushTimer) {
    clearTimeout(flushTimer);
  }
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flush();
  }, FLUSH_DELAY_MS);
}

// Pulls the account copy into localStorage once per page load. A look
// changed here while the fetch was in flight wins over the account's.
export function hydrateDiceLook() {
  if (hydration) {
    return;
  }
  hydration = fetch("/api/profile")
    .then((response) => (response.ok ? response.json() : null))
    .then((data) => {
      const remote = data?.settings?.diceLook;
      if (!remote || locallyWritten) {
        return;
      }
      const look = parseDiceLook(remote);
      if (!sameDiceLook(look, readDiceLook())) {
        store(look);
      }
    })
    .catch(() => {
      // The local copy stands.
    });
}

function subscribe(listener: () => void) {
  window.addEventListener(DICE_LOOK_EVENT, listener);
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener(DICE_LOOK_EVENT, listener);
    window.removeEventListener("storage", listener);
  };
}

// The look as this device holds it, live across tabs and after hydration.
export function useDiceLook(): DiceLook {
  return useSyncExternalStore(subscribe, readDiceLook, () => DEFAULT_DICE_LOOK);
}
