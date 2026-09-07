// The guided tours' pure half: what a step is, which steps a screen can
// show, where the explaining card sits beside its target, and the
// once-only flag. GuidedTour.tsx owns the DOM; this file owns the
// decisions, so scripts/test-tours.mjs can drive them without a browser.
// No "@/" imports here: the test runner loads it straight from disk.

export interface TourStep {
  id: string;
  title: string;
  body: string;
  // data-tour values to point at, best first. An empty list is a centred
  // card with no spotlight (a welcome or a closing word).
  anchors: string[];
  // A named side effect the host performs before the step shows (open a
  // panel tab, switch the phone to the panel view). The host maps names to
  // actions; the tour itself only carries the name.
  prepare?: string;
  // The target only exists once prepare has run (an editor sheet the step
  // opens), so the step is kept even when nothing carries its anchor at
  // the moment the tour starts. A lazy step whose target never appears
  // shows as a centred card.
  lazy?: boolean;
}

export interface ResolvedStep {
  step: TourStep;
  // The anchor that was found, "" for a centred card.
  anchor: string;
}

// Keeps the steps whose target exists (or that need none), each with the
// anchor that will be lit. A step none of whose anchors exist is skipped
// rather than shown pointing at nothing.
export function resolveSteps(
  steps: readonly TourStep[],
  present: (anchor: string) => boolean,
): ResolvedStep[] {
  const out: ResolvedStep[] = [];
  for (const step of steps) {
    if (step.anchors.length === 0) {
      out.push({ step, anchor: "" });
      continue;
    }
    const anchor = step.anchors.find(present);
    if (anchor) {
      out.push({ step, anchor });
    } else if (step.lazy) {
      out.push({ step, anchor: step.anchors[0] });
    }
  }
  return out;
}

export interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface Placement {
  top: number;
  left: number;
  side: "below" | "above" | "right" | "left" | "center";
}

// The card goes under the target when there is room, above it otherwise,
// beside it on a wide screen when neither fits, and centred when there is
// no target at all. Always clamped to the viewport with a margin.
export function placeCard(
  target: Rect | null,
  card: { width: number; height: number },
  viewport: { width: number; height: number },
  gap = 14,
  margin = 12,
): Placement {
  const clampLeft = (left: number) =>
    Math.max(margin, Math.min(left, viewport.width - card.width - margin));
  const clampTop = (top: number) =>
    Math.max(margin, Math.min(top, viewport.height - card.height - margin));
  if (!target) {
    return {
      top: clampTop((viewport.height - card.height) / 2),
      left: clampLeft((viewport.width - card.width) / 2),
      side: "center",
    };
  }
  const centredLeft = clampLeft(target.left + target.width / 2 - card.width / 2);
  const below = target.top + target.height + gap;
  if (below + card.height + margin <= viewport.height) {
    return { top: below, left: centredLeft, side: "below" };
  }
  const above = target.top - gap - card.height;
  if (above >= margin) {
    return { top: above, left: centredLeft, side: "above" };
  }
  const centredTop = clampTop(target.top + target.height / 2 - card.height / 2);
  const right = target.left + target.width + gap;
  if (right + card.width + margin <= viewport.width) {
    return { top: centredTop, left: right, side: "right" };
  }
  const left = target.left - gap - card.width;
  if (left >= margin) {
    return { top: centredTop, left, side: "left" };
  }
  return {
    top: clampTop(target.top + target.height - card.height - margin),
    left: centredLeft,
    side: "below",
  };
}

// The once-only flag, in whatever store the caller hands over (the page
// passes localStorage; the tests pass a Map).
export interface TourStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function tourKey(tourId: string): string {
  return `odm:tour:${tourId}`;
}

export function tourSeen(store: TourStore, tourId: string): boolean {
  try {
    return store.getItem(tourKey(tourId)) === "done";
  } catch {
    return true;
  }
}

export function markTourSeen(store: TourStore, tourId: string): void {
  try {
    store.setItem(tourKey(tourId), "done");
  } catch {
    // Storage can be denied; the tour then simply shows again next visit.
  }
}
