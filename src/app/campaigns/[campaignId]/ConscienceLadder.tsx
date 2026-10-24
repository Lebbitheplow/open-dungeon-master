"use client";

import { cn } from "@/lib/cn";
import { CONSCIENCE_RUNGS, RUNG_LABEL, type ConscienceRung } from "@/lib/dm/conscience-logic";

// A lasting companion's conscience on its Bonds row (issue 503): the five
// rungs from content to the breaking point, with a marker that slides one
// rung (360 ms) when the server moves it, and the ultimatum it set, with the
// time left on the campaign's clock. Every move comes from a server outcome
// (a deed recorded, standing changed, a deadline passed), never from the
// narration. Reduced motion keeps the colour and the words and drops the
// slide (motion-app.css).

export type ConscienceView = {
  rung: ConscienceRung;
  ultimatum: { condition: string; due: string; left: string } | null;
};

// Calm to grave, in the palettes the day theme turns too (globals.css).
const MARKER: Record<ConscienceRung, string> = {
  content: "bg-emerald-500/80",
  uneasy: "bg-amber-400/80",
  warning: "bg-amber-600",
  ultimatum: "bg-rose-500",
  breaking: "bg-rose-700",
};

const WORD: Record<ConscienceRung, string> = {
  content: "text-emerald-300",
  uneasy: "text-amber-300",
  warning: "text-amber-200",
  ultimatum: "text-rose-300",
  breaking: "text-rose-200",
};

export function ConscienceLadder({ name, conscience }: { name: string; conscience: ConscienceView }) {
  const step = CONSCIENCE_RUNGS.indexOf(conscience.rung);
  return (
    <div className="mt-1.5" data-conscience-ladder={name} data-rung={conscience.rung}>
      <p className="flex items-baseline gap-1.5 text-[11px] leading-4">
        <span className="text-stone-400">Conscience</span>
        <span key={conscience.rung} className={cn("live-in font-medium", WORD[conscience.rung])}>
          {RUNG_LABEL[conscience.rung]}
        </span>
      </p>
      <span
        role="img"
        aria-label={`${name}'s conscience: ${RUNG_LABEL[conscience.rung]}, step ${step + 1} of ${CONSCIENCE_RUNGS.length}, from content to breaking point`}
        className="conscience-track relative mt-1 grid h-1.5 grid-cols-5 overflow-hidden rounded-full bg-stone-800"
      >
        {CONSCIENCE_RUNGS.map((rung, index) => (
          <span key={rung} className={cn("h-full", index ? "border-l border-stone-950/70" : "")} />
        ))}
        <span
          className={cn("conscience-marker absolute inset-y-0 left-0 w-1/5 rounded-full", MARKER[conscience.rung])}
          style={{ transform: `translateX(${step * 100}%)` }}
        />
      </span>
      {conscience.ultimatum ? (
        <p className="reveal mt-1 text-xs leading-5 text-stone-300" data-ultimatum>
          <span className="font-medium text-rose-300">Ultimatum:</span> {conscience.ultimatum.condition}
          <span className="text-stone-400">
            {" "}
            · by {conscience.ultimatum.due} · <span data-countdown>{conscience.ultimatum.left} left</span>
          </span>
        </p>
      ) : null}
    </div>
  );
}
