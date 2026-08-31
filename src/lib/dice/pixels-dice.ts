"use client";

// Browser-side manager for Pixels Bluetooth dice (https://gamewithpixels.com).
// Wraps @systemic-games/pixels-web-connect, the same library Foundry VTT's
// module builds on. Everything here runs only in the browser and talks to the
// die over Web Bluetooth, which today means a Chromium browser (Chrome, Edge,
// Opera). The package is imported dynamically so it never lands in the server
// bundle or runs during SSR.
//
// A connected Pixel reports the face it lands on over BLE. That maps cleanly
// onto the app's existing physical-dice flow (PendingRollCard): instead of the
// player typing the number, the die fills it in. Source selection lives in
// dice-sources.ts; this file only owns the connections and the roll stream.

import type { Pixel } from "@systemic-games/pixels-web-connect";

// The die shapes the app's dice engine understands. Pixels also make d00
// (percentile tens) and a d6 fudge die, which have no single-die equivalent
// here, so they are left unsupported rather than mapped to a wrong face count.
const DIE_TYPE_FACES: Record<string, number> = {
  d4: 4,
  d6: 6,
  d6pipped: 6,
  d8: 8,
  d10: 10,
  d12: 12,
  d20: 20,
};

export type ConnectedPixel = {
  // Stable per-browser id, used to reconnect without a chooser prompt and to
  // pin a die to a source assignment.
  systemId: string;
  pixelId: number;
  name: string;
  // 4, 6, 8, 10, 12, or 20 - the "sides" a dice expression term uses.
  faceCount: number;
};

export type PixelRoll = {
  systemId: string;
  faceCount: number;
  // Final face value, already normalized to 1..faceCount (a Pixels d10 shows
  // 0-9; a landed 0 becomes 10 so it scores like a tabletop d10).
  value: number;
};

const connected = new Map<string, Pixel>();
const rollListeners = new Set<(roll: PixelRoll) => void>();
const changeListeners = new Set<() => void>();

// A cached, referentially-stable list so useSyncExternalStore consumers only
// re-render when the set of connected dice actually changes. A shared empty
// array serves as the server snapshot (no Bluetooth during SSR).
const EMPTY: ConnectedPixel[] = [];
let snapshot: ConnectedPixel[] = EMPTY;

function faceCountForDieType(dieType: string): number | null {
  return DIE_TYPE_FACES[dieType] ?? null;
}

function describe(pixel: Pixel): ConnectedPixel | null {
  const faceCount = faceCountForDieType(pixel.dieType);
  if (!faceCount) {
    return null;
  }
  return {
    systemId: pixel.systemId,
    pixelId: pixel.pixelId,
    name: pixel.name || `Pixel ${pixel.pixelId}`,
    faceCount,
  };
}

function notifyChange() {
  const next: ConnectedPixel[] = [];
  for (const pixel of connected.values()) {
    const info = describe(pixel);
    if (info) {
      next.push(info);
    }
  }
  snapshot = next.length ? next : EMPTY;
  for (const listener of changeListeners) {
    listener();
  }
}

async function loadModule() {
  return import("@systemic-games/pixels-web-connect");
}

// True only where the browser exposes Web Bluetooth. Callers use this to hide
// the Pixels affordances entirely on unsupported browsers (Safari, Firefox).
export function isWebBluetoothAvailable(): boolean {
  return (
    typeof navigator !== "undefined" &&
    !!(navigator as unknown as { bluetooth?: unknown }).bluetooth
  );
}

// Referentially-stable snapshot for useSyncExternalStore; identity changes
// only when the connected set changes. The server snapshot is always empty.
export function getConnectedPixels(): ConnectedPixel[] {
  return snapshot;
}

export function getConnectedPixelsServer(): ConnectedPixel[] {
  return EMPTY;
}

// Wires a freshly connected die into the roll stream and the connected map.
// Rejects die shapes the dice engine can't score so a bad assignment can never
// be made against them.
function register(pixel: Pixel): ConnectedPixel {
  const info = describe(pixel);
  if (!info) {
    void pixel.disconnect().catch(() => {});
    throw new Error("That die type isn't supported yet.");
  }
  connected.set(pixel.systemId, pixel);
  pixel.addEventListener("roll", (face: number) => {
    const value = face === 0 ? info.faceCount : face;
    for (const listener of rollListeners) {
      listener({ systemId: pixel.systemId, faceCount: info.faceCount, value });
    }
  });
  pixel.addEventListener("statusChanged", () => {
    // A dropped die is pruned so the UI stops offering it as a live source.
    if (pixel.status === "disconnected") {
      connected.delete(pixel.systemId);
    }
    notifyChange();
  });
  notifyChange();
  return info;
}

// Prompts the OS Bluetooth chooser and connects the die the user picks. Must be
// called from a user gesture (a click) per the Web Bluetooth security model.
export async function connectNewPixel(): Promise<ConnectedPixel> {
  const mod = await loadModule();
  const pixel = await mod.requestPixel();
  await mod.repeatConnect(pixel);
  return register(pixel);
}

// Silent reconnect to a die the browser already granted access to in a prior
// session. Returns null when the die is out of range or was never authorized.
export async function reconnectPixel(systemId: string): Promise<ConnectedPixel | null> {
  const existing = connected.get(systemId);
  if (existing) {
    return describe(existing);
  }
  const mod = await loadModule();
  const pixel = await mod.getPixel(systemId);
  if (!pixel) {
    return null;
  }
  await mod.repeatConnect(pixel);
  return register(pixel);
}

export async function disconnectPixel(systemId: string): Promise<void> {
  const pixel = connected.get(systemId);
  connected.delete(systemId);
  notifyChange();
  if (pixel) {
    await pixel.disconnect().catch(() => {});
  }
}

// Flashes the die's LEDs so the user can tell which physical die a row refers
// to while assigning sources. Best-effort; a die that ignores it is harmless.
export async function identifyPixel(systemId: string): Promise<void> {
  const pixel = connected.get(systemId);
  if (!pixel) {
    return;
  }
  const mod = await loadModule();
  try {
    await pixel.blink(mod.Color.brightGreen, { count: 2, duration: 1000 });
  } catch {
    // Ignore: identification is a courtesy, not a requirement.
  }
}

export function onPixelRoll(listener: (roll: PixelRoll) => void): () => void {
  rollListeners.add(listener);
  return () => rollListeners.delete(listener);
}

export function onPixelsChanged(listener: () => void): () => void {
  changeListeners.add(listener);
  return () => changeListeners.delete(listener);
}
