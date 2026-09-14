"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// One save model for every editor (docs/vtt-parity-implementation-plan.md
// section 10.4), lifted from the plugin panel: a local draft, a debounced
// autosave 700 ms after the last keystroke, a status the header shows with
// aria-live, and a flush for closing. Explicit Save buttons stay only
// where a save is a semantic act.

export type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";

export const SAVE_DELAY_MS = 700;

export const SAVE_LABEL: Record<SaveState, string> = {
  idle: "",
  dirty: "unsaved",
  saving: "saving",
  saved: "saved",
  error: "not saved",
};

export function useAutosave<T>(
  value: T,
  options: {
    // Persist the value; resolve true when the server took it.
    save: (value: T) => Promise<boolean>;
    // Something that changes when a different document is edited, so a
    // fresh document is not "dirty" against the last one's saved copy.
    key: string;
    delayMs?: number;
    enabled?: boolean;
  },
) {
  const [state, setState] = useState<SaveState>("idle");
  const savedRef = useRef<{ key: string; json: string }>({ key: options.key, json: JSON.stringify(value) });
  const timerRef = useRef<number | null>(null);
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  });
  const valueRef = useRef(value);
  useEffect(() => {
    valueRef.current = value;
  });

  const flush = useCallback(async () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const json = JSON.stringify(valueRef.current);
    if (json === savedRef.current.json) {
      return true;
    }
    setState("saving");
    const ok = await optionsRef.current.save(valueRef.current);
    if (ok) {
      savedRef.current = { key: optionsRef.current.key, json };
      setState("saved");
    } else {
      setState("error");
    }
    return ok;
  }, []);

  useEffect(() => {
    if (options.enabled === false) {
      return;
    }
    if (savedRef.current.key !== options.key) {
      // A different document: what is on screen is what is saved.
      savedRef.current = { key: options.key, json: JSON.stringify(value) };
      const reset = window.setTimeout(() => setState("idle"), 0);
      return () => window.clearTimeout(reset);
    }
    const json = JSON.stringify(value);
    if (json === savedRef.current.json) {
      return;
    }
    const mark = window.setTimeout(() => setState("dirty"), 0);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      void flush();
    }, options.delayMs ?? SAVE_DELAY_MS);
    return () => {
      window.clearTimeout(mark);
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [value, options.key, options.delayMs, options.enabled, flush]);

  const dirty = state === "dirty" || state === "saving" || state === "error";
  return { state, dirty, flush };
}
