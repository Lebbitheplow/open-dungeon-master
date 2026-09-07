"use client";

import { ChevronRight, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { placeCard, resolveSteps, type ResolvedStep, type TourStep } from "@/lib/tours/logic";
import { ui } from "@/lib/ui";

// A spotlight walkthrough: dims the page, cuts a window around one control
// at a time, and explains it in a card beside it. Targets are elements
// carrying data-tour="name"; steps whose target is not on screen are
// skipped. The host decides when it opens (first visit, or Help) and does
// the side effects a step asks for (opening the right tab) through
// onPrepare. The pure decisions live in src/lib/tours/logic.ts.

const SPOT_PAD = 6;

// The first laid-out element carrying the anchor. The same control can
// exist twice (the desktop rail and the phone tab bar), one of them
// display: none; the one with a box is the one to light.
function findAnchor(anchor: string): HTMLElement | null {
  for (const node of document.querySelectorAll<HTMLElement>(`[data-tour="${anchor}"]`)) {
    if (node.getClientRects().length > 0) return node;
  }
  return null;
}

type Box = { top: number; left: number; width: number; height: number };

export function GuidedTour({
  open,
  steps,
  onPrepare,
  onClose,
}: {
  open: boolean;
  steps: readonly TourStep[];
  onPrepare?: (name: string) => void;
  onClose: () => void;
}) {
  const [resolved, setResolved] = useState<ResolvedStep[] | null>(null);
  const [index, setIndex] = useState(0);
  const [spot, setSpot] = useState<Box | null>(null);
  const [card, setCard] = useState<{ top: number; left: number }>({ top: -9999, left: -9999 });
  const cardRef = useRef<HTMLDivElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);

  // Which steps apply is decided against the page a moment after the tour
  // opens, once the table has laid itself out; before that the page may
  // still be settling and every anchor would look absent. The state lands
  // inside the timeout, which is the shape the effect lint asks for.
  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => {
      setResolved(resolveSteps(steps, (anchor) => findAnchor(anchor) !== null));
      setIndex(0);
    }, 150);
    return () => {
      clearTimeout(timer);
      setResolved(null);
    };
  }, [open, steps]);

  const current = open && resolved ? resolved[index] : undefined;
  const total = resolved?.length ?? 0;
  const last = index >= total - 1;

  // Lays the spotlight over the step's target and the card beside it.
  const position = useCallback(() => {
    if (!current) return;
    const target = current.anchor ? findAnchor(current.anchor) : null;
    const rect = target?.getBoundingClientRect() ?? null;
    setSpot(
      rect
        ? {
            top: rect.top - SPOT_PAD,
            left: rect.left - SPOT_PAD,
            width: rect.width + SPOT_PAD * 2,
            height: rect.height + SPOT_PAD * 2,
          }
        : null,
    );
    const size = cardRef.current;
    const placed = placeCard(
      rect ? { top: rect.top, left: rect.left, width: rect.width, height: rect.height } : null,
      { width: size?.offsetWidth ?? 352, height: size?.offsetHeight ?? 200 },
      { width: window.innerWidth, height: window.innerHeight },
    );
    setCard({ top: placed.top, left: placed.left });
  }, [current]);

  // The step's side effect, then the target into view, then measure.
  // Positioning is asynchronous (a tab switch renders on the next frame,
  // a phone column may slide), so a few staggered measurements follow.
  useEffect(() => {
    if (!current) return;
    if (current.step.prepare) onPrepare?.(current.step.prepare);
    const timers = [0, 80, 260, 600].map((delay) =>
      window.setTimeout(() => {
        if (delay === 80) {
          const target = current.anchor ? findAnchor(current.anchor) : null;
          target?.scrollIntoView({ block: "center", inline: "nearest" });
          nextRef.current?.focus({ preventScroll: true });
        }
        position();
      }, delay),
    );
    return () => timers.forEach((timer) => clearTimeout(timer));
  }, [current, onPrepare, position]);

  useEffect(() => {
    if (!current) return;
    const tick = () => position();
    const clock = window.setInterval(tick, 400);
    window.addEventListener("resize", tick);
    window.addEventListener("scroll", tick, true);
    return () => {
      clearInterval(clock);
      window.removeEventListener("resize", tick);
      window.removeEventListener("scroll", tick, true);
    };
  }, [current, position]);

  const step = useCallback(
    (delta: number) => {
      const next = index + delta;
      if (next >= total) {
        onClose();
        return;
      }
      setIndex(Math.max(0, next));
    },
    [index, total, onClose],
  );

  useEffect(() => {
    if (!current) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      } else if (event.key === "ArrowRight" || event.key === "Enter") {
        event.preventDefault();
        step(1);
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        step(-1);
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [current, step, onClose]);

  if (!current) return null;

  return (
    <>
      {/* data-guided-tour marks the tour's own surfaces so a modal sheet
          underneath (an editor a step opened) does not read a tap on the
          card as a tap outside itself and close. */}
      <div
        data-guided-tour
        className={cn("fixed inset-0 z-[80]", !spot && "bg-[#05030d]/75")}
        onClick={onClose}
        aria-hidden
      />
      {spot ? (
        <div
          aria-hidden
          className="pointer-events-none fixed z-[81] rounded-xl border border-amber-200/60 shadow-[0_0_0_9999px_rgba(5,3,13,0.76),0_0_24px_rgba(212,171,58,0.35)] transition-[top,left,width,height] duration-200 ease-snap motion-reduce:transition-none"
          style={{ top: spot.top, left: spot.left, width: spot.width, height: spot.height }}
        />
      ) : null}
      <div
        ref={cardRef}
        data-guided-tour
        role="dialog"
        aria-label="Guided tour"
        className="panel ornate texture-noise fixed z-[82] w-[min(22rem,calc(100vw-1.5rem))] rounded-xl p-4 shadow-elev-2 transition-[top,left] duration-200 ease-snap motion-reduce:transition-none"
        style={{ top: card.top, left: card.left }}
      >
        <div className="flex items-center justify-between gap-2">
          <span className={ui.sectionEyebrow}>
            {index + 1} of {total}
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="End the tour"
            className="rounded-md p-1 text-stone-500 transition-colors hover:bg-stone-800 hover:text-stone-200"
          >
            <X className="size-4" />
          </button>
        </div>
        <h3 className="mt-1.5 font-display text-base tracking-wide text-amber-50">{current.step.title}</h3>
        <p className="mt-1.5 text-sm leading-relaxed text-stone-300">{current.step.body}</p>
        <div className="mt-3 flex justify-end gap-2">
          {index > 0 ? (
            <button type="button" onClick={() => step(-1)} className={ui.btnSmall}>
              Back
            </button>
          ) : null}
          <button
            ref={nextRef}
            type="button"
            onClick={() => step(1)}
            className={cn(ui.btnPrimary, "h-9 px-3.5")}
          >
            {last ? "Done" : "Next"}
            {last ? null : <ChevronRight className="size-4" />}
          </button>
        </div>
      </div>
    </>
  );
}
