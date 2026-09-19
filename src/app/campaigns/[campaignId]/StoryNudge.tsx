"use client";

import { SessionBanner, bannerButtonClass } from "@/app/campaigns/[campaignId]/SessionBanner";
import type { BeatCadence } from "@/lib/dm/beat-cadence";

// The reminder, above the composer and DM-only. It escalates from nothing to
// a quiet line to a lit banner, and it is never a modal: the remedy travels
// with the interruption, so the button that fixes it is right there.
export function StoryNudge({
  cadence,
  onCapture,
  onSnooze,
}: {
  cadence: BeatCadence;
  // Opens the DM console, where the beat composer lives.
  onCapture: () => void;
  onSnooze: () => void;
}) {
  if (cadence.level === "quiet") {
    return null;
  }
  const overdue = cadence.level === "overdue";
  return (
    <SessionBanner
      glyph="tab-log"
      tone={overdue ? "gold" : "quiet"}
      title={overdue ? "The story is waiting" : undefined}
      actions={
        <>
          <button type="button" onClick={onCapture} className={bannerButtonClass(overdue)}>
            Write it down
          </button>
          <button type="button" onClick={onSnooze} className={bannerButtonClass()}>
            Later
          </button>
        </>
      }
    >
      <span className="block sm:truncate">
        {cadence.reason}
        {overdue ? " The chapter summaries and the recap are built from it." : ""}
      </span>
    </SessionBanner>
  );
}
