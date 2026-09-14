"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Undo everywhere (docs/vtt-parity-implementation-plan.md section 10.3).
// A ring of the full objects the server returned after each change; undo
// sends the previous one back whole through the caller's replace function.
// Keyed so a different document starts a fresh ring, capped at `size`.
// Ctrl+Z and Ctrl+Shift+Z (or Ctrl+Y) are wired when `hotkeys` is on and
// the focus is not in a text field.

export function useUndoRing<T>(
  key: string,
  options: {
    size?: number;
    // Re-sends an earlier object as a full replacement; resolves to the
    // object the server now holds, or null when it refused.
    replace: (previous: T) => Promise<T | null>;
    hotkeys?: boolean;
  },
) {
  const size = options.size ?? 20;
  const ringRef = useRef<{ key: string; past: T[]; future: T[] }>({ key, past: [], future: [] });
  const [counts, setCounts] = useState({ past: 0, future: 0 });
  const busyRef = useRef(false);
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  });

  const sync = useCallback(() => {
    if (ringRef.current.key !== key) {
      ringRef.current = { key, past: [], future: [] };
    }
    setCounts({ past: ringRef.current.past.length, future: ringRef.current.future.length });
  }, [key]);

  useEffect(() => {
    sync();
  }, [sync]);

  // Call with the object as it was BEFORE a change was applied.
  const remember = useCallback(
    (before: T) => {
      if (ringRef.current.key !== key) {
        ringRef.current = { key, past: [], future: [] };
      }
      ringRef.current.past = [...ringRef.current.past, before].slice(-size);
      ringRef.current.future = [];
      sync();
    },
    [key, size, sync],
  );

  const step = useCallback(
    async (direction: "undo" | "redo", current: T) => {
      if (busyRef.current) {
        return;
      }
      const ring = ringRef.current;
      const source = direction === "undo" ? ring.past : ring.future;
      const target = direction === "undo" ? ring.future : ring.past;
      const previous = source[source.length - 1];
      if (previous === undefined) {
        return;
      }
      busyRef.current = true;
      try {
        const applied = await optionsRef.current.replace(previous);
        if (applied !== null) {
          source.pop();
          target.push(current);
          sync();
        }
      } finally {
        busyRef.current = false;
      }
    },
    [sync],
  );

  const currentRef = useRef<T | null>(null);
  const track = useCallback((current: T) => {
    currentRef.current = current;
  }, []);

  useEffect(() => {
    if (!options.hotkeys) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
        return;
      }
      if (!(event.ctrlKey || event.metaKey)) {
        return;
      }
      const current = currentRef.current;
      if (current === null) {
        return;
      }
      if (event.key.toLowerCase() === "z" && !event.shiftKey) {
        event.preventDefault();
        void step("undo", current);
      } else if ((event.key.toLowerCase() === "z" && event.shiftKey) || event.key.toLowerCase() === "y") {
        event.preventDefault();
        void step("redo", current);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [options.hotkeys, step]);

  return {
    remember,
    track,
    undo: (current: T) => step("undo", current),
    redo: (current: T) => step("redo", current),
    canUndo: counts.past > 0,
    canRedo: counts.future > 0,
  };
}
