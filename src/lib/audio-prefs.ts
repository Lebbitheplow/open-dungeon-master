"use client";

// Account-backed audio preferences (narration, ambience, chat chime).
//
// localStorage stays what the hooks actually read, because it answers
// synchronously, works offline, and survives the server being unreachable;
// the account copy only exists so a second browser starts where the first
// left off. So: hydrate localStorage from GET /api/profile once per page
// load, and write every change through to PATCH /api/profile on a debounce
// (volume sliders fire continuously). A failed fetch in either direction
// changes nothing the user can see.
//
// Voice prefs (mic id, push-to-talk, peer volumes) deliberately do NOT sync;
// see useVoicePrefs.ts for why they are per-machine.

export type AudioPrefField =
  | "narrationMuted"
  | "narrationVolume"
  | "ambienceMuted"
  | "ambienceVolume"
  | "chimeMuted";

// The localStorage keys and change events predate the account sync and are
// shared with the hooks (which import them from here), so an account value
// arriving after mount reaches already-rendered controls through the same
// path a local toggle does.
export const AUDIO_PREF_FIELDS: Record<AudioPrefField, { key: string; event: string }> = {
  narrationMuted: { key: "odm_tts_muted", event: "odm-tts-prefs" },
  narrationVolume: { key: "odm_tts_volume", event: "odm-tts-prefs" },
  ambienceMuted: { key: "odm_ambience_muted", event: "odm-ambience-prefs" },
  ambienceVolume: { key: "odm_ambience_volume", event: "odm-ambience-prefs" },
  chimeMuted: { key: "odm_chat_chime_muted", event: "odm-chime-prefs" },
};

const FLUSH_DELAY_MS = 1000;

// Changes not yet accepted by the server. Kept across a failed PATCH so the
// next local change retries them; overwritten entries always keep the newest
// value.
const pending = new Map<AudioPrefField, number | boolean>();
// Everything touched locally this page load. Hydration must not undo a
// change the user made while the profile fetch was in flight.
const locallyWritten = new Set<AudioPrefField>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let hydration: Promise<void> | null = null;

function store(field: AudioPrefField, value: number | boolean) {
  try {
    window.localStorage.setItem(
      AUDIO_PREF_FIELDS[field].key,
      typeof value === "boolean" ? (value ? "1" : "0") : String(value),
    );
  } catch {
    // Private browsing and similar: the change still reaches this tab's
    // subscribers through the event, it just does not persist.
  }
}

async function flush() {
  const entries = [...pending.entries()];
  if (!entries.length) {
    return;
  }
  pending.clear();
  try {
    const response = await fetch("/api/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ settings: Object.fromEntries(entries) }),
    });
    if (!response.ok) {
      throw new Error(String(response.status));
    }
  } catch {
    // Offline or rejected: put the batch back so a later change re-sends it,
    // unless a newer value for the field arrived meanwhile.
    for (const [field, value] of entries) {
      if (!pending.has(field)) {
        pending.set(field, value);
      }
    }
  }
}

// Local write plus debounced write-through. This is the only setter the
// hooks use, so the cache and the account can never be updated separately.
export function writeAudioPref(field: AudioPrefField, value: number | boolean) {
  store(field, value);
  locallyWritten.add(field);
  window.dispatchEvent(new Event(AUDIO_PREF_FIELDS[field].event));
  pending.set(field, value);
  if (flushTimer) {
    clearTimeout(flushTimer);
  }
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flush();
  }, FLUSH_DELAY_MS);
}

// Pulls the account copy into localStorage. Single-flight: the narration,
// ambience and chime hooks all mount together, and one profile fetch per
// page load serves them all.
export function hydrateAudioPrefs() {
  if (hydration) {
    return;
  }
  hydration = fetch("/api/profile")
    .then((response) => (response.ok ? response.json() : null))
    .then((data) => {
      const settings = data?.settings as Partial<Record<AudioPrefField, unknown>> | undefined;
      if (!settings) {
        return;
      }
      const changed = new Set<string>();
      for (const field of Object.keys(AUDIO_PREF_FIELDS) as AudioPrefField[]) {
        const value = settings[field];
        // The column is free-form JSON, so shape-check here even though the
        // PATCH route validates writes.
        const valid =
          field.endsWith("Muted")
            ? typeof value === "boolean"
            : typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
        if (!valid || locallyWritten.has(field)) {
          continue;
        }
        store(field, value as number | boolean);
        changed.add(AUDIO_PREF_FIELDS[field].event);
      }
      for (const event of changed) {
        window.dispatchEvent(new Event(event));
      }
    })
    .catch(() => {
      // The localStorage values stand; nothing to do.
    });
}
