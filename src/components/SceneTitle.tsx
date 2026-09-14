"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { prefersReducedMotion } from "@/lib/effects-mode";
import type { TitleCard } from "@/lib/scene/state";

// The title card (docs/vtt-parity-implementation-plan.md section 2.4): a
// chapter name, a fight's opening line or a dawn, in display type over a
// dark scrim with a rule in the card's tone. In over --dur-scene, held for
// --dur-linger, out over --dur-scene; on reduced motion a plain toast for
// the same span. Reports itself shown so the stream drops it.

const IN_MS = 900;
const HOLD_MS = 1600;
const OUT_MS = 900;

const RULE: Record<TitleCard["tone"], string> = {
  gold: "bg-amber-400",
  ember: "bg-ember-500",
  dawn: "bg-amber-200",
  plain: "bg-stone-400",
};

const SCRIM: Record<TitleCard["tone"], string> = {
  gold: "bg-stone-950/70",
  ember: "bg-[rgba(30,8,4,0.72)]",
  dawn: "bg-[linear-gradient(180deg,rgba(40,28,60,0.75),rgba(212,140,110,0.55))]",
  plain: "bg-stone-950/70",
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

  useEffect(() => {
    if (!card || card.id === shownId) {
      return;
    }
    // Cards older than a minute are history, not a moment: a late joiner
    // reads them in the log rather than watching them play.
    if (Date.now() - card.at > 60_000) {
      onShown(card.id);
      return;
    }
    const timers: number[] = [];
    timers.push(window.setTimeout(() => setShownId(card.id), 0));
    timers.push(window.setTimeout(() => setPhase("in"), 0));
    timers.push(window.setTimeout(() => setPhase("hold"), reduced ? 10 : IN_MS));
    timers.push(window.setTimeout(() => setPhase("out"), IN_MS + HOLD_MS));
    timers.push(
      window.setTimeout(
        () => {
          setPhase(null);
          onShown(card.id);
        },
        IN_MS + HOLD_MS + (reduced ? 10 : OUT_MS),
      ),
    );
    return () => {
      for (const timer of timers) {
        window.clearTimeout(timer);
      }
    };
  }, [card, shownId, onShown, reduced]);

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
      <div className="max-w-3xl text-center">
        <h2
          className={cn(
            "title-in font-display text-4xl leading-tight text-stone-50 drop-shadow-[0_2px_18px_rgba(0,0,0,0.8)] sm:text-6xl",
          )}
        >
          {card.title}
        </h2>
        <div className={cn("title-rule mx-auto mt-4 h-px w-40", RULE[card.tone])} />
        {card.subtitle ? (
          <p
            className="title-in mt-3 text-sm uppercase tracking-[0.3em] text-stone-300"
            style={{ animationDelay: "180ms" }}
          >
            {card.subtitle}
          </p>
        ) : null}
      </div>
    </div>
  );
}
