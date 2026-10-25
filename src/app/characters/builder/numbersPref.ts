"use client";

import { useSyncExternalStore } from "react";

// "Show rules and numbers" (backlog F11): the class cards and the builder's
// header say a class's hit points in words ("High HP"), and a player who
// wants the hit die as well ("High HP, d10") turns this on once. It stays as
// they left it, on this device, like the hand's fold and the effects
// setting: a veteran is not asked again on every character, and a new player
// is never shown a die they did not ask for. localStorage can be missing or
// refused (a private window, an app shell that blocks it), so the choice
// then lasts as long as the page.

const KEY = "odm:builder-numbers";
const EVENT = "odm-builder-numbers";

function subscribe(callback: () => void) {
  window.addEventListener(EVENT, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}

// Kept for a refused storage, so the switch still moves for this page.
let fallback = false;

export function readNumbers(): boolean {
  try {
    const stored = window.localStorage.getItem(KEY);
    return stored === null ? fallback : stored === "1";
  } catch {
    return fallback;
  }
}

export function writeNumbers(on: boolean) {
  fallback = on;
  try {
    window.localStorage.setItem(KEY, on ? "1" : "0");
  } catch {
    // Storage can be denied; the choice then lasts as long as the page.
  }
  window.dispatchEvent(new Event(EVENT));
}

// Off on the server and on the first paint, then whatever the player set.
export function useShowNumbers(): boolean {
  return useSyncExternalStore(subscribe, readNumbers, () => false);
}
