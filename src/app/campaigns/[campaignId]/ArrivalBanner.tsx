"use client";

import { useCallback, useEffect, useState } from "react";
import { PortraitMedallion } from "@/components/sheet/SheetParts";
import { Face, useEscapeToSkip } from "@/app/campaigns/[campaignId]/moment-parts";
import {
  ARRIVAL_MS,
  arrivalDetail,
  arrivalLine,
  arrivalStays,
  dismissArrival,
  seeSheets,
  startArrivals,
  type Arrival,
} from "@/app/campaigns/[campaignId]/arrival";
import { prefersReducedMotion, useLowEffects } from "@/lib/effects-mode";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// The arrival banner (backlog F27): when a player seats a character while
// the lobby is open, everyone in it sees "Thornwick takes a seat" with the
// face, ancestry and class, as a light banner over the top of the lobby that
// blocks nothing. It leaves on its own after a few seconds; under reduced
// motion or low effects it holds still and waits for its Dismiss, and a
// pointer or focus resting on it holds it too. Escape skips it. The line is
// heard once, from a polite region that is always there. Styles:
// styles/moments.css, "arrival banner".
export function ArrivalBanner({ sheets }: { sheets: CharacterSheet[] }) {
  const [arrivals, setArrivals] = useState(() => startArrivals(sheets));
  const seen = seeSheets(arrivals, sheets);
  if (seen !== arrivals) {
    setArrivals(seen);
  }

  const lowEffects = useLowEffects();
  const current = arrivals.queue[0] ?? null;
  const [held, setHeld] = useState(false);
  const still = arrivalStays({ lowEffects, reducedMotion: prefersReducedMotion() });
  const skip = useCallback(() => {
    setHeld(false);
    setArrivals(dismissArrival);
  }, []);
  useEffect(() => {
    if (!current || still || held) return;
    const timer = window.setTimeout(skip, ARRIVAL_MS);
    return () => window.clearTimeout(timer);
  }, [current, still, held, skip]);
  useEscapeToSkip(Boolean(current), skip);

  return (
    <>
      <p role="status" className="sr-only">
        {current ? `${arrivalLine(current)}: ${arrivalDetail(current)}` : ""}
      </p>
      {current ? (
        <ArrivalCard
          key={current.id}
          arrival={current}
          still={still}
          onDismiss={skip}
          onHold={setHeld}
        />
      ) : null}
    </>
  );
}

// The banner itself: the face, the line and the ancestry and class. Its
// words are already in the status region above, so here they are only seen.
// It takes no focus; under a still device it carries the Dismiss.
export function ArrivalCard({
  arrival,
  still,
  onDismiss,
  onHold,
}: {
  arrival: Arrival;
  still: boolean;
  onDismiss: () => void;
  onHold: (held: boolean) => void;
}) {
  return (
    <div
      className="moment-arrival"
      data-still={still || undefined}
      onPointerEnter={() => onHold(true)}
      onPointerLeave={() => onHold(false)}
      onFocus={() => onHold(true)}
      onBlur={() => onHold(false)}
    >
      <PortraitMedallion classId={arrival.class} className="moment-arrival-medallion">
        <Face sheet={arrival} />
      </PortraitMedallion>
      <span className="min-w-0 flex-1" aria-hidden="true">
        <span className="gold-title moment-arrival-name">{arrivalLine(arrival)}</span>
        <span className="moment-arrival-detail">{arrivalDetail(arrival)}</span>
      </span>
      {still ? (
        <button type="button" className="moment-arrival-dismiss" onClick={onDismiss}>
          Dismiss
        </button>
      ) : null}
    </div>
  );
}
