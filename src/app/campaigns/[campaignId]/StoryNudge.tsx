"use client";

import { BookMarked } from "lucide-react";
import { cn } from "@/lib/cn";
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
    <div
      className={cn(
        "mb-2 flex items-center justify-between gap-3 rounded-md border px-3 py-1.5 text-xs",
        overdue
          ? "border-amber-700/70 bg-amber-950/40 text-amber-100"
          : "border-stone-700/60 bg-stone-900/40 text-stone-400",
      )}
    >
      <span className="flex min-w-0 items-center gap-1.5">
        <BookMarked className="size-3.5 shrink-0" />
        <span className="truncate">
          {cadence.reason}
          {overdue ? " The chapter summaries and the recap are built from it." : ""}
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-3">
        <button
          type="button"
          onClick={onCapture}
          className={cn(
            "font-medium",
            overdue ? "text-amber-200 hover:text-amber-100" : "text-stone-300 hover:text-stone-100",
          )}
        >
          Write it down
        </button>
        <button
          type="button"
          onClick={onSnooze}
          className="text-stone-500 hover:text-stone-300"
        >
          Later
        </button>
      </span>
    </div>
  );
}
