"use client";

import { useSyncExternalStore } from "react";

// The two fastest-moving values on the table, kept outside the campaign
// reducer. A narration flush lands every 75 ms while the DM talks and the
// speaking indicator ticks for as long as anyone is on the call; routing
// either through the reducer repaints the whole table each time. Here only
// the draft bubble and the voice dock subscribe, so a flush repaints the
// draft text and nothing else.
//
// One store per value, module-scoped: a page holds one campaign stream at
// a time, and useCampaignStream resets both on mount so a table never
// inherits the last one's draft. Read with useSyncExternalStore, which
// preact/compat provides too (the apps bundle these pages with it).

export type ValueStore<T> = {
  get: () => T;
  set: (value: T) => void;
  subscribe: (listener: () => void) => () => void;
};

export function createValueStore<T>(initial: T): ValueStore<T> {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set: (next) => {
      if (Object.is(next, value)) {
        return;
      }
      value = next;
      for (const listener of listeners) {
        listener();
      }
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export type VoiceSpeaking = { userId: string; at: number } | null;

export const dmDraftStore = createValueStore("");
export const voiceSpeakingStore = createValueStore<VoiceSpeaking>(null);

export function appendDmDraft(text: string) {
  if (text) {
    dmDraftStore.set(dmDraftStore.get() + text);
  }
}

export function clearDmDraft() {
  dmDraftStore.set("");
}

export function setVoiceSpeaking(speaking: VoiceSpeaking) {
  voiceSpeakingStore.set(speaking);
}

export function resetLiveStores() {
  dmDraftStore.set("");
  voiceSpeakingStore.set(null);
}

const serverDraft = () => "";
const serverSpeaking = (): VoiceSpeaking => null;

// The DM's passage as it streams in. Empty between turns.
export function useDmDraft(): string {
  return useSyncExternalStore(dmDraftStore.subscribe, dmDraftStore.get, serverDraft);
}

// Who mediasoup's dominant-speaker detection last named, and when. The
// timestamp is what lets the indicator fade: the event says who started
// talking, never who stopped.
export function useVoiceSpeaking(): VoiceSpeaking {
  return useSyncExternalStore(
    voiceSpeakingStore.subscribe,
    voiceSpeakingStore.get,
    serverSpeaking,
  );
}
