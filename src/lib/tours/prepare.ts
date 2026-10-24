"use client";

import { useEffect } from "react";

// How a tour reaches into a panel it does not own. The page that runs a
// workshop tour knows nothing about the tables panel's editor sheet; the
// panel does. So the page broadcasts the step's prepare name on the window,
// and any panel that can answer it (open its editor, unfold its card)
// listens. Names are plain strings agreed between src/lib/tours/workshop.ts
// and the panels; a name nobody answers is harmless.
//
// A panel's handler returns true when the name was its own and it answered
// (its editor is open now), and the request returns whether any panel did,
// so a caller that asks again later (Create, while a lazy panel loads) can
// stop once one has: an editor the author has since closed stays closed.

const EVENT = "odm-tour-prepare";

export function requestTourPrepare(name: string): boolean {
  const event = new CustomEvent<string>(EVENT, { detail: name, cancelable: true });
  return !window.dispatchEvent(event);
}

export function useTourPrepare(handler: (name: string) => boolean | void): void {
  useEffect(() => {
    const listen = (event: Event) => {
      if (handler((event as CustomEvent<string>).detail) === true) event.preventDefault();
    };
    window.addEventListener(EVENT, listen);
    return () => window.removeEventListener(EVENT, listen);
  }, [handler]);
}
