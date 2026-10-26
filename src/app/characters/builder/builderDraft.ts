// An unfinished new character, kept on this device so a closed tab, a phone
// call or an Escape on the companion dialog costs nothing: the builder offers
// it back the next time it opens at the same door. Only new characters are
// kept; an edit of a stored one loses nothing by leaving. One draft per
// door, cleared when the character is saved. localStorage can be missing or
// full (a private window, an app shell that blocks it), so every call
// swallows its errors and the builder works without it.
import type { BuilderDraftFields } from "./useBuilderState";

const PREFIX = "odm:builder-draft:";
// Version 2 keeps the step by its key, not its place: the steps were put in
// a new order (backlog F4), and a place would resume a draft one step off.
const VERSION = 2;
// The steps in the order version 1 drafts counted them, before F4 put the
// class first and the name last.
const V1_STEPS = ["identity", "ancestry", "calling", "abilities", "spells-gear", "finish"];
// A draft this old is from another evening's plans, not this one's.
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export type BuilderDraft = { v: typeof VERSION; savedAt: number; step: string; fields: BuilderDraftFields };

// The step a stored draft was left on, by key, from either version. A
// version 1 draft left on its first step ("identity", then the name and
// background) had finished nothing yet, so it resumes on the new first step;
// its name and background are kept for the steps that now ask them. Pure,
// for scripts/test-builder-calling-first.mjs.
export function draftStepKey(stored: { v?: unknown; step?: unknown }): string | null {
  if (stored.v === VERSION) {
    return typeof stored.step === "string" ? stored.step : null;
  }
  if (stored.v === 1 && typeof stored.step === "number") {
    const key = V1_STEPS[Math.min(Math.max(0, Math.trunc(stored.step)), V1_STEPS.length - 1)];
    return key === "identity" ? "calling" : key;
  }
  return null;
}

// A draft saved before a race could offer more than one cantrip kept its
// pick as `racialCantrip`; it comes back as the one-name list the builder
// keeps now. Pure, for scripts/test-racial-cantrip-count.mjs.
export function migrateDraftFields(fields: BuilderDraftFields): BuilderDraftFields {
  const { racialCantrip, ...rest } = fields as BuilderDraftFields & { racialCantrip?: unknown };
  if (Array.isArray(rest.racialCantrips)) {
    return rest;
  }
  const one = typeof racialCantrip === "string" ? racialCantrip.trim() : "";
  return { ...rest, racialCantrips: one ? [one] : [] };
}

// The door a draft belongs to: the library's new character, a table's join
// page, or a table's companion dialog.
export function builderDraftKey(door: "library" | "table" | "companion", campaignId?: string): string {
  return door === "library" ? "library" : `${door}:${campaignId ?? ""}`;
}

export function readBuilderDraft(key: string): BuilderDraft | null {
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    if (!raw) {
      return null;
    }
    const stored = JSON.parse(raw) as { v?: unknown; savedAt?: number; step?: unknown; fields?: BuilderDraftFields };
    const step = stored ? draftStepKey(stored) : null;
    if (!step || !stored.fields || Date.now() - (stored.savedAt ?? 0) > MAX_AGE_MS) {
      window.localStorage.removeItem(PREFIX + key);
      return null;
    }
    return { v: VERSION, savedAt: stored.savedAt ?? 0, step, fields: migrateDraftFields(stored.fields) };
  } catch {
    return null;
  }
}

export function writeBuilderDraft(key: string, step: string, fields: BuilderDraftFields) {
  try {
    const draft: BuilderDraft = { v: VERSION, savedAt: Date.now(), step, fields };
    window.localStorage.setItem(PREFIX + key, JSON.stringify(draft));
  } catch {
    // Nothing kept; the builder still works.
  }
}

export function clearBuilderDraft(key: string) {
  try {
    window.localStorage.removeItem(PREFIX + key);
  } catch {
    // Nothing to clear.
  }
}
