"use client";

// Shake to roll: on a phone, a parked roll of the player's own is released
// by shaking the device instead of tapping. The preference is per device
// (a desktop cannot shake), stored in localStorage next to the dice
// sources; the "hold my rolls" member flag it implies is written to the
// campaign by the table while the preference is on (SessionView).
//
// The detector is a pure function of accelerometer samples so
// scripts/test-shake-to-roll.mjs can drive it; only the hooks below touch
// the window.

import { useSyncExternalStore } from "react";

export const SHAKE_KEY = "odm:shakeToRoll";
export const SHAKE_EVENT = "odm-shake-to-roll";

// A shake is a burst of hard direction changes: the jerk (change in
// acceleration between samples) crosses the threshold several times inside
// a short window. One hard knock or setting the phone down does not count;
// waving it does. After a shake fires the detector rests so one gesture
// never releases two rolls.
export type ShakeDetectorOptions = {
  // m/s² of jerk that counts as one hard move.
  threshold?: number;
  // Hard moves needed inside the window before a shake fires.
  moves?: number;
  windowMs?: number;
  cooldownMs?: number;
};

export type ShakeSample = { x: number; y: number; z: number; at: number };

export function createShakeDetector(options: ShakeDetectorOptions = {}) {
  const threshold = options.threshold ?? 18;
  const moves = options.moves ?? 3;
  const windowMs = options.windowMs ?? 700;
  const cooldownMs = options.cooldownMs ?? 1_500;
  let last: ShakeSample | null = null;
  let hits: number[] = [];
  let restingUntil = 0;

  // Feed one accelerometer sample; true exactly when a shake completes.
  return function feed(sample: ShakeSample): boolean {
    const previous = last;
    last = sample;
    if (!previous) {
      return false;
    }
    if (sample.at < restingUntil) {
      hits = [];
      return false;
    }
    const jerk = Math.hypot(sample.x - previous.x, sample.y - previous.y, sample.z - previous.z);
    if (jerk < threshold) {
      return false;
    }
    hits = hits.filter((at) => sample.at - at <= windowMs);
    hits.push(sample.at);
    if (hits.length < moves) {
      return false;
    }
    hits = [];
    restingUntil = sample.at + cooldownMs;
    return true;
  };
}

// True where a shake can be felt: the device reports motion and is held in
// the hand (a coarse pointer, i.e. a touch screen). A laptop with a motion
// sensor is not a thing anyone shakes at a table.
export function supportsShake(): boolean {
  if (typeof window === "undefined") return false;
  if (typeof DeviceMotionEvent === "undefined") return false;
  return window.matchMedia?.("(pointer: coarse)").matches ?? false;
}

export function readShakeToRoll(): boolean {
  try {
    return window.localStorage.getItem(SHAKE_KEY) === "on";
  } catch {
    return false;
  }
}

export function writeShakeToRoll(on: boolean) {
  try {
    window.localStorage.setItem(SHAKE_KEY, on ? "on" : "off");
  } catch {
    // Private browsing: this tab still hears the event.
  }
  window.dispatchEvent(new Event(SHAKE_EVENT));
}

function subscribe(listener: () => void) {
  window.addEventListener(SHAKE_EVENT, listener);
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener(SHAKE_EVENT, listener);
    window.removeEventListener("storage", listener);
  };
}

// The preference as this device holds it, live across tabs.
export function useShakeToRoll(): boolean {
  return useSyncExternalStore(subscribe, readShakeToRoll, () => false);
}

// iOS asks before it reports motion; Android and the apps do not. Resolves
// true when motion events will flow.
export async function requestMotionAccess(): Promise<boolean> {
  const Motion = (typeof DeviceMotionEvent !== "undefined" ? DeviceMotionEvent : null) as
    | (typeof DeviceMotionEvent & { requestPermission?: () => Promise<"granted" | "denied"> })
    | null;
  if (!Motion) return false;
  if (typeof Motion.requestPermission !== "function") return true;
  try {
    return (await Motion.requestPermission()) === "granted";
  } catch {
    return false;
  }
}

// Calls listener once per shake until the returned function is called.
export function onShake(listener: () => void, options?: ShakeDetectorOptions): () => void {
  const feed = createShakeDetector(options);
  const handle = (event: DeviceMotionEvent) => {
    const a = event.accelerationIncludingGravity ?? event.acceleration;
    if (!a || a.x === null || a.y === null || a.z === null) return;
    if (feed({ x: a.x, y: a.y, z: a.z, at: Date.now() })) {
      listener();
    }
  };
  window.addEventListener("devicemotion", handle);
  return () => window.removeEventListener("devicemotion", handle);
}

// A short buzz where the device can, so the shake is felt landing.
export function buzz() {
  try {
    navigator.vibrate?.(40);
  } catch {
    // Not every WebView allows it; the roll still goes.
  }
}
