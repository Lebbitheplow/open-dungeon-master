"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { cn } from "@/lib/cn";
import { ExtrudedTitle } from "@/components/ui/GoldTitle";
import { prefersReducedMotion } from "@/lib/effects-mode";
import type { TitleCard } from "@/lib/scene/state";

// The title card (docs/vtt-parity-implementation-plan.md section 2.4): a
// chapter name, a fight's opening line or a dawn, in display type over a
// dark scrim with a rule in the card's tone. In over --dur-scene, held for
// --dur-linger, out over --dur-scene; on reduced motion a plain toast for
// the same span. Reports itself shown so the stream drops it.
//
// The entrance is the battle announce ("Rolls and Effects" mockup 5a): the
// title is carved (eight bronze layers under a gradient face), flies in from
// far away and below the plane on the spring, and a shock ring and sparks
// fire when it LANDS, not when it enters. The hairlines grow out from a
// diamond above it. All of it is CSS in src/app/styles/motion-app.css; low
// effects gets one layer, a plain fade and no loop.

const IN_MS = 900;
const HOLD_MS = 1600;
// An act's end or beginning is the story's biggest punctuation: it holds
// longer than a chapter card so the subtitle (the act's name) can be read.
const HOLD_ACT_MS = 2800;
const OUT_MS = 900;

// Eighteen sparks on a ring, fixed so every client draws the same burst.
const SPARKS = Array.from({ length: 18 }, (_, index) => {
  const angle = (index / 18) * Math.PI * 2;
  const distance = 90 + ((index * 37) % 70);
  const size = 3 + ((index * 13) % 4);
  return {
    "--tx": `${(Math.cos(angle) * distance).toFixed(0)}px`,
    "--ty": `${(Math.sin(angle) * distance).toFixed(0)}px`,
    width: `${size}px`,
    height: `${size}px`,
    animationDuration: `${700 + ((index * 53) % 400)}ms`,
  } as CSSProperties;
});

// Written as colours, not theme tokens: the card is a cinematic beat and its
// gold face needs the dark behind it on the parchment theme too.
const SCRIM: Record<TitleCard["tone"], string> = {
  gold: "bg-[rgba(10,8,23,0.74)]",
  ember: "bg-[rgba(30,8,4,0.72)]",
  dawn: "bg-[linear-gradient(180deg,rgba(40,28,60,0.75),rgba(212,140,110,0.55))]",
  plain: "bg-[rgba(12,10,9,0.74)]",
  act: "bg-[radial-gradient(ellipse_at_center,rgba(28,20,44,0.78),rgba(6,4,12,0.9))]",
};

export function SceneTitle({
  card,
  onShown,
}: {
  card: TitleCard | null;
  onShown: (id: string) => void;
}) {
  const [phase, setPhase] = useState<"in" | "hold" | "out" | null>(null);
  const [shownId, setShownId] = useState<string | null>(null);
  const reduced = prefersReducedMotion();

  // The latest callback without making it a reason to restart the card.
  const shown = useRef(onShown);
  useEffect(() => {
    shown.current = onShown;
  }, [onShown]);

  // Keyed on the card's id and stamp alone. It used to depend on shownId as
  // well, so marking the card shown re-ran the effect, whose cleanup cleared
  // the hold and out timers: the card arrived and never left.
  const cardId = card?.id ?? null;
  const cardAt = card?.at ?? 0;
  const holdMs = card?.tone === "act" ? HOLD_ACT_MS : HOLD_MS;
  useEffect(() => {
    if (!cardId) {
      return;
    }
    // Cards older than a minute are history, not a moment: a late joiner
    // reads them in the log rather than watching them play.
    if (Date.now() - cardAt > 60_000) {
      shown.current(cardId);
      return;
    }
    const timers: number[] = [];
    timers.push(window.setTimeout(() => setShownId(cardId), 0));
    timers.push(window.setTimeout(() => setPhase("in"), 0));
    timers.push(window.setTimeout(() => setPhase("hold"), reduced ? 10 : IN_MS));
    timers.push(window.setTimeout(() => setPhase("out"), IN_MS + holdMs));
    timers.push(
      window.setTimeout(
        () => {
          setPhase(null);
          shown.current(cardId);
        },
        IN_MS + holdMs + (reduced ? 10 : OUT_MS),
      ),
    );
    return () => {
      for (const timer of timers) {
        window.clearTimeout(timer);
      }
    };
  }, [cardId, cardAt, holdMs, reduced]);

  if (!card || !phase || card.id !== shownId) {
    return null;
  }

  if (reduced) {
    return (
      <div
        role="status"
        className="pointer-events-none fixed inset-x-0 top-16 z-[70] flex justify-center px-4"
      >
        <div className="rounded-lg border border-stone-700 bg-stone-950/95 px-4 py-2 text-center shadow-elev-2">
          <p className="font-display text-lg text-stone-100">{card.title}</p>
          {card.subtitle ? <p className="text-xs text-stone-400">{card.subtitle}</p> : null}
        </div>
      </div>
    );
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "pointer-events-none fixed inset-0 z-[70] flex items-center justify-center px-6",
        SCRIM[card.tone],
        phase === "out" ? "title-out" : "title-scrim-in",
      )}
      style={{ transition: `opacity ${OUT_MS}ms var(--ease-drift)`, opacity: phase === "out" ? 0 : 1 }}
    >
      <div className="announce relative max-w-3xl text-center" data-tone={card.tone}>
        <div className="announce-rules" aria-hidden="true">
          <span className="announce-rule" />
          <span className="announce-diamond" />
          <span className="announce-rule announce-rule-end" />
        </div>
        <div className="announce-fly">
          <div className="announce-breathe">
            <ExtrudedTitle tone={card.tone} className="text-4xl sm:text-6xl">
              {card.title}
            </ExtrudedTitle>
          </div>
        </div>
        {card.subtitle ? <p className="announce-sub mt-4 font-display text-[11px] sm:text-sm">{card.subtitle}</p> : null}
        <span className="announce-ring" aria-hidden="true" />
        {SPARKS.map((spark, index) => (
          <span key={index} aria-hidden="true" className={cn("announce-spark", index % 3 === 0 && "announce-spark-hot")} style={spark} />
        ))}
      </div>
    </div>
  );
}
