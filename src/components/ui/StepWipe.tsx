"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// The wipe between two steps of a paced flow: the pane dims, a gold beam
// streaks through a ring, and the step changes underneath while it is dark.
// About 700 ms end to end with the swap at 300 ms. Under reduced motion there
// is no wipe and the swap is immediate. Styles are in
// src/app/styles/creator.css (docs/visual-overhaul-plan.md 7.1).
export const STEP_WIPE_SWAP_MS = 300;
export const STEP_WIPE_TOTAL_MS = 720;

// The parent must be positioned and clip its overflow; the wipe fills it.
export function StepWipe({ active }: { active: boolean }) {
  if (!active) {
    return null;
  }
  return (
    <div className="step-wipe" aria-hidden="true">
      <div className="step-wipe-dim" />
      <div className="step-wipe-beam" />
      <div className="step-wipe-ring" />
    </div>
  );
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// Drives a StepWipe: `run(swap)` starts the wipe and calls `swap` once the
// pane is dark. A second call while one is in flight is dropped, so a double
// press on Continue cannot skip past a step whose gate was never looked at.
export function useStepWipe(enabled: boolean): { wiping: boolean; run: (swap: () => void) => void } {
  const [wiping, setWiping] = useState(false);
  const timers = useRef<number[]>([]);
  const busy = useRef(false);

  useEffect(
    () => () => {
      for (const id of timers.current) window.clearTimeout(id);
    },
    [],
  );

  const run = useCallback(
    (swap: () => void) => {
      if (!enabled || prefersReducedMotion()) {
        swap();
        return;
      }
      if (busy.current) {
        return;
      }
      busy.current = true;
      setWiping(true);
      timers.current = [
        window.setTimeout(swap, STEP_WIPE_SWAP_MS),
        window.setTimeout(() => {
          busy.current = false;
          setWiping(false);
        }, STEP_WIPE_TOTAL_MS),
      ];
    },
    [enabled],
  );

  return { wiping, run };
}
