"use client";

// Per-user, per-die-shape choice of how a physical roll gets fulfilled. This
// is the "unfulfilled rolls" idea from Foundry VTT: a player might own a Pixels
// d20 but no physical d6, so their d20 comes from the die while their d6 rolls
// digitally, all within one parked roll.
//
// The choice is a device-local preference (a die you own lives on the device in
// front of you), so it persists to localStorage rather than the server. On the
// wire, PendingRollCard submits typed and Pixels faces as plain numbers and a
// digital face as the literal "digital", which the server rolls itself: a
// browser-invented number would be the player's to predict.

import { useCallback, useSyncExternalStore } from "react";

// The die shapes a dice expression can contain. d4..d20 can be fulfilled by a
// Pixels die; d100 has no single physical Pixel, so it is manual-or-digital.
export const DIE_SIDES = [4, 6, 8, 10, 12, 20, 100] as const;
export type DieSides = (typeof DIE_SIDES)[number];

// A source is one of:
//   "manual"        - the player types the number from a tabletop die
//   "digital"       - the browser rolls it (an unfulfilled die falls back here)
//   "pixel:<id>"    - a specific connected Pixels die reports the face
export type DiceSourceMap = Record<number, string>;

const STORAGE_KEY = "odm.diceSources.v1";
const PIXEL_PREFIX = "pixel:";

export function defaultDiceSources(): DiceSourceMap {
  const map: DiceSourceMap = {};
  for (const sides of DIE_SIDES) {
    map[sides] = "manual";
  }
  return map;
}

// The systemId of the Pixel assigned to a source string, or null when the
// source is manual/digital.
export function pixelSystemId(source: string | undefined): string | null {
  return source && source.startsWith(PIXEL_PREFIX)
    ? source.slice(PIXEL_PREFIX.length)
    : null;
}

export function pixelSource(systemId: string): string {
  return `${PIXEL_PREFIX}${systemId}`;
}

// Shared reference returned whenever nothing is stored, so the client snapshot
// matches the server snapshot during hydration (no all-manual flicker).
const SERVER_SNAPSHOT = defaultDiceSources();

// Cache keyed on the raw stored string so getSnapshot returns a stable
// reference between reads (useSyncExternalStore requires this to avoid loops).
let cachedRaw = "";
let cachedMap: DiceSourceMap = SERVER_SNAPSHOT;

// Exported for scripts/test-dice-sources.mjs; the app reads it through
// useDiceSources.
export function parseStored(raw: string): DiceSourceMap {
  if (!raw) {
    return SERVER_SNAPSHOT;
  }
  const map = defaultDiceSources();
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    for (const sides of DIE_SIDES) {
      const value = parsed[String(sides)];
      if (typeof value === "string") {
        map[sides] = value;
      }
    }
  } catch {
    return SERVER_SNAPSHOT;
  }
  return map;
}

function getSnapshot(): DiceSourceMap {
  const raw =
    (typeof window !== "undefined" && window.localStorage.getItem(STORAGE_KEY)) || "";
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedMap = parseStored(raw);
  }
  return cachedMap;
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  window.addEventListener("odm-dice-sources", onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener("odm-dice-sources", onChange);
  };
}

function writeStored(map: DiceSourceMap) {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
    // The native storage event only reaches other tabs; a custom event carries
    // the change to this tab's own subscribers.
    window.dispatchEvent(new Event("odm-dice-sources"));
  } catch {
    // Ignore write failures (private mode, quota).
  }
}

// How a single die face gets its value in a parked roll, resolved from the
// player's per-shape preference against the dice actually connected.
export type FaceSource =
  | { kind: "manual" }
  | { kind: "digital" }
  | { kind: "pixel"; systemId: string; name: string };

// Pure so the degradation rules are testable: a preference naming a Pixel that
// is not connected (or whose face count does not match the die asked for)
// degrades to typing rather than blocking the roll, and the d100 never
// resolves to a Pixel because no single physical Pixel has one hundred faces.
export function resolveFaceSource(
  preference: string | undefined,
  sides: number,
  pixels: ReadonlyArray<{ systemId: string; faceCount: number; name: string }>,
): FaceSource {
  if (preference === "digital") {
    return { kind: "digital" };
  }
  const systemId = pixelSystemId(preference);
  if (systemId && sides !== 100) {
    const pixel = pixels.find(
      (entry) => entry.systemId === systemId && entry.faceCount === sides,
    );
    if (pixel) {
      return { kind: "pixel", systemId, name: pixel.name };
    }
  }
  return { kind: "manual" };
}

// The stored preference as an external store, synced across tabs and hook
// instances. Returns the map and a per-shape setter.
export function useDiceSources(): [
  DiceSourceMap,
  (sides: DieSides, source: string) => void,
] {
  const sources = useSyncExternalStore(subscribe, getSnapshot, () => SERVER_SNAPSHOT);

  const setSource = useCallback((sides: DieSides, source: string) => {
    writeStored({ ...getSnapshot(), [sides]: source });
  }, []);

  return [sources, setSource];
}
