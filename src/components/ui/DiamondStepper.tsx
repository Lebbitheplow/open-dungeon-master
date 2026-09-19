"use client";

import { cn } from "@/lib/cn";

// The stepper of a paced flow: one diamond per step joined by hairline rules.
// Completed diamonds are solid gold and can be tapped to go back; the current
// one glows and pings; the ones ahead are outlines and do nothing, because
// moving forward is the footer's job and that is where a step's gate lives.
// Styles are in src/app/styles/creator.css (docs/visual-overhaul-plan.md 7.1).
export type DiamondStep = { key: string; label: string };

export function DiamondStepper({
  steps,
  current,
  onSelect,
  className,
}: {
  steps: DiamondStep[];
  current: number;
  // Called with the index of a completed step. Omit to make the row a pure
  // indicator.
  onSelect?: (index: number) => void;
  className?: string;
}) {
  return (
    // A list, not a progressbar: a progressbar's children are presentational,
    // and these are buttons.
    <ol className={cn("diamond-stepper", className)} aria-label="Steps">
      {steps.map((step, index) => {
        const state = index < current ? "done" : index === current ? "current" : "upcoming";
        const canGoBack = state === "done" && Boolean(onSelect);
        return (
          <li key={step.key} className="diamond-step" data-state={state} data-last={index === steps.length - 1 || undefined}>
            <button
              type="button"
              className="diamond-button"
              onClick={canGoBack ? () => onSelect?.(index) : undefined}
              disabled={!canGoBack}
              aria-current={state === "current" ? "step" : undefined}
              aria-label={
                canGoBack
                  ? `Back to step ${index + 1}: ${step.label}`
                  : `Step ${index + 1}: ${step.label}`
              }
              title={step.label}
            >
              {state === "current" ? <span className="diamond-ping" aria-hidden="true" /> : null}
              <span className="diamond-core" aria-hidden="true" />
            </button>
            {index < steps.length - 1 ? <span className="diamond-rule" aria-hidden="true" /> : null}
          </li>
        );
      })}
    </ol>
  );
}
