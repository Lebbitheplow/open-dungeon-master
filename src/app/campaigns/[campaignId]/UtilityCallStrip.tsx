"use client";

import { Loader2 } from "lucide-react";
import { memo, useEffect, useState } from "react";
import { describeCall, formatElapsed, type UtilityCall } from "@/lib/dm/call-tracker-logic";

// What the engine is doing between turns, as one chip per job.
//
// dm_status already covers the turn itself; this covers the work that runs
// outside one and that nothing previously surfaced: compaction, the chapter
// seal, the world tick, a lore check, an Ask. On a local 35B any of those is
// a minute of apparent nothing.
function UtilityCallStripInner({ calls }: { calls: UtilityCall[] }) {
  // One shared ticker for the whole strip rather than one per chip, and only
  // while something is actually running.
  const [now, setNow] = useState(() => Date.now());
  const running = calls.length > 0;

  useEffect(() => {
    if (!running) {
      return;
    }
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [running]);
  // No immediate tick: `now` may be stale from a previous idle stretch, which
  // makes the first frame's elapsed negative, and formatElapsed renders
  // nothing under its 3s floor anyway. The first interval fires well inside
  // that window.

  if (!running) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5 px-3 py-1.5">
      {calls.map((call) => {
        const elapsed = formatElapsed(call.startedAt, now);
        return (
          <span
            key={call.id}
            className="inline-flex items-center gap-1.5 rounded-full border border-stone-700/60 bg-stone-900/60 px-2 py-0.5 text-[11px] text-stone-400"
            // Announced politely: this is progress, not something to interrupt
            // a screen reader mid-sentence for.
            aria-live="polite"
          >
            <Loader2 className="size-3 animate-spin text-amber-400/70" />
            {describeCall(call.kind)}
            {elapsed ? (
              <span className="tabular-nums text-stone-600">{elapsed}</span>
            ) : null}
          </span>
        );
      })}
    </div>
  );
}

// Memoized: the strip re-renders once a second on its own ticker and must not
// drag the message list along with it.
export const UtilityCallStrip = memo(UtilityCallStripInner);
