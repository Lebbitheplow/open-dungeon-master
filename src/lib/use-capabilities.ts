"use client";

import { useEffect, useState } from "react";

// What this server can do, as the UI sees it. One fetch per page load is
// shared by every panel that asks (the campaign creator, the character
// builder, the NPC forge, the map panel, the DM console), so a page with
// six AI-aware controls costs one request, not six.
//
// null means "not answered yet or the endpoint failed", and every consumer
// treats null as "offer everything": a flaky capability check must never
// hide a working feature. Only a positive "not configured" hides a control.

export type ClientCapabilities = {
  story: { configured: boolean; reachable: boolean };
  utility: { configured: boolean };
  images: { configured: boolean; reachable: boolean; backend: string };
  tts: { configured: boolean; reachable: boolean };
  stt: { configured: boolean };
  voice: { enabled: boolean; mode: string };
};

let cached: ClientCapabilities | null = null;
let inflight: Promise<ClientCapabilities | null> | null = null;
const listeners = new Set<(value: ClientCapabilities | null) => void>();

// Probe results are cached server-side for 30 seconds; asking again sooner
// buys nothing, so the client keeps its answer at least that long.
const REFRESH_MS = 30_000;
let fetchedAt = 0;

function load(force = false): Promise<ClientCapabilities | null> {
  if (!force && cached && Date.now() - fetchedAt < REFRESH_MS) {
    return Promise.resolve(cached);
  }
  if (inflight) {
    return inflight;
  }
  inflight = fetch("/api/capabilities", { cache: "no-store" })
    .then((response) => (response.ok ? response.json() : null))
    .then((data: ClientCapabilities | null) => {
      if (data && typeof data === "object" && data.story && data.images) {
        cached = data;
        fetchedAt = Date.now();
        for (const listener of listeners) {
          listener(cached);
        }
      }
      return cached;
    })
    .catch(() => cached)
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

export function useCapabilities(): ClientCapabilities | null {
  const [value, setValue] = useState<ClientCapabilities | null>(cached);
  useEffect(() => {
    listeners.add(setValue);
    void load();
    return () => {
      listeners.delete(setValue);
    };
  }, []);
  return value;
}

// The two questions the builders ask. Both read "unknown" as "offered" so a
// paint button only disappears on a positive answer from the server.

// Is there an image backend to paint portraits, maps and scenes with?
export function offersImages(capabilities: ClientCapabilities | null): boolean {
  return capabilities === null || capabilities.images.configured;
}

// Is there a text model for suggestions, drafts and the AI storyteller?
export function offersStoryModel(capabilities: ClientCapabilities | null): boolean {
  return capabilities === null || capabilities.story.configured;
}
