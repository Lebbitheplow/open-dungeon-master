"use client";

import { cn } from "@/lib/cn";

// The stepper of a paced flow: one diamond per step joined by hairline rules.
// Completed diamonds are solid gold and can be tapped to go back; the current
// one glows and pings, and stays in the tab order so a keyboard or screen
// reader user can find where they are; the ones ahead are outlines and do
// nothing, because moving forward is the footer's job and that is where a
// step's gate lives.
// A flow that knows its gates can pass `reachable`: a step ahead it allows is
// tappable too, so a player who went back to fix one pick can return without
// pressing Continue through every step between. With `named`, each step's
// short name is printed under its diamond, so a first-timer can read the
// whole path without hovering.
// Styles are in src/app/styles/creator.css (docs/visual-overhaul-plan.md 7.1).
export type DiamondStep = { key: string; label: string };

export function DiamondStepper({
  steps,
  current,
  onSelect,
  reachable,
  named = false,
  className,
}: {
  steps: DiamondStep[];
  current: number;
  // Called with the index of a completed step. Omit to make the row a pure
  // indicator.
  onSelect?: (index: number) => void;
  // Whether a step ahead of the current one may be jumped to: every gate
  // before it passes. Omit to keep the steps ahead inert.
  reachable?: (index: number) => boolean;
  named?: boolean;
  className?: string;
}) {
  return (
    // A list, not a progressbar: a progressbar's children are presentational,
    // and these are buttons.
    // A named stepper keeps a row for the names under it, in rem as the
    // names are, so the step heading below stays clear at any text size.
    <ol className={cn("diamond-stepper", named && "pb-7", className)} data-named={named || undefined} aria-label="Steps">
      {steps.map((step, index) => {
        const state = index < current ? "done" : index === current ? "current" : "upcoming";
        const canGoBack = state === "done" && Boolean(onSelect);
        const canJump = state === "upcoming" && Boolean(onSelect) && Boolean(reachable?.(index));
        const canSelect = canGoBack || canJump;
        return (
          <li key={step.key} className="diamond-step" data-state={state} data-last={index === steps.length - 1 || undefined}>
            <span className="relative flex flex-none">
              <button
                type="button"
                className="diamond-button"
                onClick={canSelect ? () => onSelect?.(index) : undefined}
                // The current diamond is not a way anywhere, but it is where
                // the player is: it stays focusable, marked aria-current.
                disabled={!canSelect && state !== "current"}
                aria-current={state === "current" ? "step" : undefined}
                aria-label={
                  canGoBack
                    ? `Back to step ${index + 1}: ${step.label}`
                    : canJump
                      ? `Go to step ${index + 1}: ${step.label}`
                      : `Step ${index + 1}: ${step.label}`
                }
                title={step.label}
              >
                {state === "current" ? <span className="diamond-ping" aria-hidden="true" /> : null}
                <span className="diamond-core" aria-hidden="true" />
              </button>
              {named ? (
                // Printed for the eye; the button's own label already says it.
                // The end names hug the row's edges so a phone never clips them.
                <span
                  aria-hidden="true"
                  data-diamond-name=""
                  className={cn(
                    "pointer-events-none absolute top-full mt-2 whitespace-nowrap font-mono text-[0.6875rem] leading-none tracking-wide",
                    index === 0 ? "left-0" : index === steps.length - 1 ? "right-0" : "left-1/2 -translate-x-1/2",
                    state === "current" ? "text-amber-200" : state === "done" ? "text-amber-300/70" : "text-stone-400",
                  )}
                >
                  {step.label}
                </span>
              ) : null}
            </span>
            {index < steps.length - 1 ? <span className="diamond-rule" aria-hidden="true" /> : null}
          </li>
        );
      })}
    </ol>
  );
}
