"use client";

import { Coffee } from "lucide-react";
import { useEffect, useState } from "react";
import { SessionBanner, bannerButtonClass } from "@/app/campaigns/[campaignId]/SessionBanner";
import { breakElapsed, type TableBreak } from "@/lib/dm/table-break-logic";

// The Pause control the header (from sm up) and the phone's table menu
// carry. Absent where there is nothing to pause: a table not yet playing.
export type TableBreakControl = {
  paused: boolean;
  mayResume: boolean;
  onPause: () => void;
  onResume: () => void;
};

// A table break (src/lib/dm/table-break-logic.ts), shown to every seat. It
// is not the X-card: it names who paused, it covers nothing, and table talk
// goes on under it. It floats under the header rather than above the
// composer so a phone on the party or map tab sees it too. The clock counts
// up, never down: there is no timer, only the person who paused, the lead
// or the DM pressing Resume.
export function TableBreakBanner({
  tableBreak,
  meUserId,
  mayResume,
  onResume,
}: {
  tableBreak: TableBreak | null;
  meUserId: string;
  mayResume: boolean;
  onResume: () => Promise<void>;
}) {
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  // Under the session header, whatever its height: a fight's initiative
  // ribbon makes it taller, and a fixed offset laid the banner over the
  // ribbon's names. Measured while a break is up, and again when the header
  // or the window changes size.
  const [top, setTop] = useState<number | null>(null);
  const paused = tableBreak !== null;
  useEffect(() => {
    if (!paused) {
      return;
    }
    const header = document.querySelector<HTMLElement>(".session-header");
    if (!header) {
      return;
    }
    const place = () => setTop(Math.round(header.getBoundingClientRect().bottom) + 6);
    place();
    const observer = new ResizeObserver(place);
    observer.observe(header);
    window.addEventListener("resize", place);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", place);
    };
  }, [paused]);
  const pausedAt = tableBreak?.at ?? null;
  useEffect(() => {
    if (pausedAt === null) {
      return;
    }
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [pausedAt]);
  if (!tableBreak) {
    return null;
  }
  const mine = tableBreak.userId === meUserId;
  async function resume() {
    setBusy(true);
    try {
      await onResume();
    } finally {
      setBusy(false);
    }
  }
  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-[calc(4.25rem+env(safe-area-inset-top))] z-[51] flex justify-center px-3"
      style={top === null ? undefined : { top }}
    >
      <SessionBanner
        glyph="tab-timeline"
        lead={<Coffee aria-hidden="true" className="size-7 shrink-0 text-amber-300" />}
        title={mine ? "You paused the table" : `Paused by ${tableBreak.name}`}
        className="table-break-banner pointer-events-auto w-full max-w-xl shadow-elev-2"
        actions={
          mayResume ? (
            <button type="button" disabled={busy} onClick={() => void resume()} className={bannerButtonClass(true)}>
              Resume
            </button>
          ) : null
        }
      >
        <span role="status" className="text-sm text-stone-300">
          Paused for <span className="tabular-nums text-amber-100">{breakElapsed(tableBreak.at, now)}</span>. The story
          and its narration wait; OOC table talk still works.
        </span>
      </SessionBanner>
    </div>
  );
}
