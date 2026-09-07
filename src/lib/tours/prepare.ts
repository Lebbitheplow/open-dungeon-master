"use client";

import { useEffect } from "react";

// How a tour reaches into a panel it does not own. The page that runs a
// workshop tour knows nothing about the tables panel's editor sheet; the
// panel does. So the page broadcasts the step's prepare name on the window,
// and any panel that can answer it (open its editor, unfold its card)
// listens. Names are plain strings agreed between src/lib/tours/workshop.ts
// and the panels; a name nobody answers is harmless.

const EVENT = "odm-tour-prepare";

export function requestTourPrepare(name: string): void {
  window.dispatchEvent(new CustomEvent<string>(EVENT, { detail: name }));
}

export function useTourPrepare(handler: (name: string) => void): void {
  useEffect(() => {
    const listen = (event: Event) => handler((event as CustomEvent<string>).detail);
    window.addEventListener(EVENT, listen);
    return () => window.removeEventListener(EVENT, listen);
  }, [handler]);
}
