"use client";

import type { TurnPip } from "@/lib/battlemap/hand-table";

// The Hand's turn pips, the engine's count (src/lib/battlemap/hand-table.ts
// turnPips), and the Flurry of Blows strikes bought and not yet made (the
// engine's flurryStrikes), played with the Unarmed strike card. Split from
// Hand.tsx.
//
// Each pip wears its cost's colour and shape, the same as the cost tag and
// the corner notch of every card it would pay for (issue 529, hand.css).
export function HandPips({
  pips,
  flurryStrikes,
}: {
  pips: TurnPip[];
  flurryStrikes?: number;
}) {
  return (
    <>
      {pips.map((pip) => (
        <span
          key={pip.label}
          data-cost={pip.cost}
          data-used={pip.used ? "true" : undefined}
          // The strike through a spent pip is drawn by hand-motion.css, which eases it in.
          className="hand-pip rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider"
          aria-label={`${pip.label} ${pip.used ? "spent" : "available"}`}
        >
          {pip.label}
        </span>
      ))}
      {flurryStrikes ? (
        <span
          key={`flurry-${flurryStrikes}`}
          className="hand-pip motion-pop rounded-full border border-amber-500/45 bg-amber-500/10 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-amber-200"
          aria-label={`${flurryStrikes} Flurry of Blows strikes left`}
        >
          Flurry {flurryStrikes}
        </span>
      ) : null}
    </>
  );
}
