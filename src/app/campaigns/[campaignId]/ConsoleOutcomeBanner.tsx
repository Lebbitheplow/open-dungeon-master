"use client";

import { X } from "lucide-react";
import { useEffect, useSyncExternalStore } from "react";
import { cn } from "@/lib/cn";
import type { ResultLine } from "@/lib/dm/catalog-result";

// What the DM console's "Start a fight" said (the ambush's surprise rolls,
// who is placed where), kept for the Battle tab. Starting a fight moves the
// panel to the board, which took the console and its result off screen
// before anyone could read it; the result now waits on the board until it
// is dismissed.

// `encounterId`: the fight it started, bound the first time it shows beside
// one. It goes when that fight is over: kept until dismissed by hand, fight
// one's surprise rolls sat on top of fight two when the AI or prep started
// that one.
type Held = { campaignId: string; title: string; lines: ResultLine[]; seq: number; encounterId?: string };

let held: Held | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function holdConsoleOutcome(campaignId: string, title: string, lines: ResultLine[]) {
  held = { campaignId, title, lines, seq: (held?.seq ?? 0) + 1 };
  for (const listener of listeners) listener();
}

function dismiss() {
  held = null;
  for (const listener of listeners) listener();
}

export function ConsoleOutcomeBanner({ campaignId, encounterId = null }: { campaignId: string; encounterId?: string | null }) {
  const shown = useSyncExternalStore(subscribe, () => held, () => null);
  useEffect(() => {
    if (!shown || shown.campaignId !== campaignId) return;
    if (!shown.encounterId && encounterId) {
      held = { ...shown, encounterId };
      for (const listener of listeners) listener();
    } else if (shown.encounterId && shown.encounterId !== encounterId) {
      dismiss();
    }
  }, [shown, campaignId, encounterId]);
  if (!shown || shown.campaignId !== campaignId || !shown.lines.length) return null;
  return (
    <div
      key={shown.seq}
      role="status"
      className="reveal-banner mb-2 rounded-lg border border-amber-500/30 bg-stone-950/80 px-3 py-2 text-xs"
    >
      <div className="flex items-center justify-between gap-2">
        <p className="gold-title font-display text-[11px] uppercase tracking-[0.18em]">{shown.title}</p>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss the result"
          className="motion-press flex size-7 items-center justify-center rounded-md text-stone-500 hover:text-amber-200"
        >
          <X className="size-3.5" />
        </button>
      </div>
      <ul className="stagger mt-1 space-y-0.5">
        {shown.lines.map((line, index) => (
          <li
            key={`${index}-${line.text}`}
            className={cn(
              line.tone === "bad" ? "text-ember-300" : line.tone === "good" ? "text-emerald-300" : "text-stone-200",
            )}
          >
            {line.text}
          </li>
        ))}
      </ul>
    </div>
  );
}
