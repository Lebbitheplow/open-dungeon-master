"use client";

import { ChevronLeft } from "lucide-react";
import { useState, type ReactNode } from "react";
import { DiamondStepper } from "@/components/ui/DiamondStepper";
import { GoldTitle } from "@/components/ui/GoldTitle";
import { StepWipe, useStepWipe } from "@/components/ui/StepWipe";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";

// Stepped wizard: gold progress bar, steps that slide sideways, Back in the
// header and Continue in the footer. Fills whatever holds it (a Dialog or a
// full-height page on a phone) and each step scrolls on its own.
//
//   <Wizard
//     title="New campaign"
//     steps={[
//       { key: "name", title: "Name it", content: <NameFields />, canContinue: !!name },
//       { key: "world", title: "Pick a world", blurb: "You can change this later.", content: <WorldPicker /> },
//     ]}
//     doneLabel="Create"
//     onDone={create}
//     onCancel={() => setOpen(false)}
//   />
//
// Step state is internal unless `step` and `onStepChange` are both passed.
//
// Three opt-in looks, all off by default so every existing wizard is
// unchanged: `variant="diamonds"` swaps the bar for the diamond stepper (tap a
// completed diamond to go back), `wipe` plays the gold step wipe instead of
// the sideways slide, and `goldTitles` sets each step title in GoldTitle.
// These need src/app/styles/creator.css.

export type WizardStep = {
  key: string;
  title: ReactNode;
  blurb?: ReactNode;
  content: ReactNode;
  canContinue?: boolean;
  // Short plain name for the diamond stepper and the header ("Ancestry").
  // Falls back to the title when that is a string.
  label?: string;
  // Replaces "Continue" on this step ("Continue as Half-Orc").
  continueLabel?: ReactNode;
};

export function Wizard({
  steps,
  title,
  onDone,
  doneLabel = "Done",
  onCancel,
  step: controlledStep,
  onStepChange,
  className,
  variant = "bar",
  wipe = false,
  goldTitles = false,
  aside,
}: {
  steps: WizardStep[];
  title: ReactNode;
  onDone: () => void;
  doneLabel?: ReactNode;
  onCancel?: () => void;
  step?: number;
  onStepChange?: (step: number) => void;
  className?: string;
  variant?: "bar" | "diamonds";
  wipe?: boolean;
  goldTitles?: boolean;
  // A quiet line at the right of the header (the character so far).
  aside?: ReactNode;
}) {
  const [internalStep, setInternalStep] = useState(0);
  const controlled = controlledStep !== undefined;
  const raw = controlled ? controlledStep : internalStep;
  // Clamp rather than trust the caller: a steps array that shrinks after a
  // choice on an earlier step would otherwise leave the track pointing at
  // nothing.
  const step = Math.min(Math.max(raw, 0), Math.max(steps.length - 1, 0));
  const total = steps.length;
  const last = step >= total - 1;
  const current = steps[step];
  const canContinue = current?.canContinue !== false;
  const { wiping, run } = useStepWipe(wipe);

  const labelOf = (s: WizardStep, index: number) =>
    s.label ?? (typeof s.title === "string" ? s.title : `Step ${index + 1}`);

  const go = (next: number) => {
    // With the wipe on, the step changes once the pane has gone dark.
    run(() => {
      if (!controlled) setInternalStep(next);
      onStepChange?.(next);
    });
  };
  const back = () => {
    if (step === 0) onCancel?.();
    else go(step - 1);
  };
  const forward = () => {
    if (!canContinue) return;
    if (last) onDone();
    else go(step + 1);
  };

  return (
    <div className={cn("flex h-full min-h-0 w-full flex-col", wipe && "relative", className)}>
      <header className="shrink-0">
        <div className="flex items-center gap-2">
          {step > 0 || onCancel ? (
            <button
              type="button"
              onClick={back}
              className="-ml-1.5 rounded-md p-1.5 text-stone-400 transition-colors hover:bg-stone-800 hover:text-stone-200"
              aria-label={step === 0 ? "Cancel" : "Back"}
            >
              <ChevronLeft className="size-4" />
            </button>
          ) : null}
          <h2 className="min-w-0 flex-1 truncate font-display text-lg tracking-wide text-amber-100">
            {title}
          </h2>
          {aside ? (
            <span className="mx-1 hidden min-w-0 shrink truncate font-mono text-[10px] text-stone-600 sm:inline">
              {aside}
            </span>
          ) : null}
          <span className="eyebrow shrink-0 text-[10px] text-stone-500" aria-live="polite">
            Step {step + 1} / {total}
            {variant === "diamonds" && current ? (
              // The gold step title sits right under the header on a phone,
              // so the name is only repeated where there is room for it.
              <span className="hidden text-amber-300 sm:inline"> · {labelOf(current, step)}</span>
            ) : null}
          </span>
        </div>
        {variant === "diamonds" ? (
          <DiamondStepper
            className="mt-3"
            steps={steps.map((s, i) => ({ key: s.key, label: labelOf(s, i) }))}
            current={step}
            onSelect={go}
          />
        ) : (
          <div
            className="mt-3 h-1 overflow-hidden rounded-full bg-stone-800/80"
            role="progressbar"
            aria-valuemin={1}
            aria-valuemax={total}
            aria-valuenow={step + 1}
          >
            <div
              className="h-full rounded-full bg-gradient-to-r from-amber-500 via-amber-300 to-amber-200 shadow-glow-gold transition-[width] duration-[380ms] ease-snap"
              style={{ width: `${total ? ((step + 1) / total) * 100 : 0}%` }}
            />
          </div>
        )}
      </header>

      {/* The track holds every step side by side and translates as a whole,
          so the outgoing and incoming step share one motion. Inactive steps
          are inert so tabbing cannot land on something off screen. Under the
          wipe the track jumps instead: the pane is dark while it happens. */}
      {/* Clip where the engine has it: a hidden-overflow box can still be
          scrolled by a scrollIntoView with an inline alignment, which would
          slide the neighbouring step into the pane. The class is the fallback. */}
      <div className="mt-4 min-h-0 flex-1 overflow-hidden" style={{ overflow: "clip" }}>
        <div
          className={cn("flex h-full", !wipe && "transition-transform duration-[380ms] ease-snap")}
          style={{ transform: `translateX(-${step * 100}%)` }}
        >
          {steps.map((s, i) => (
            <section
              key={s.key}
              className={cn("h-full w-full shrink-0 overflow-y-auto px-0.5", wipe && "wizard-step")}
              data-active={i === step || undefined}
              aria-hidden={i !== step}
              inert={i !== step}
            >
              {goldTitles ? (
                <GoldTitle as="h3" size="text-lg sm:text-xl" animate={false} className="wizard-step-title">
                  {s.title}
                </GoldTitle>
              ) : (
                <h3 className="font-display text-base tracking-wide text-amber-200">{s.title}</h3>
              )}
              {s.blurb ? (
                <p className={cn("mt-1 text-sm text-stone-400", goldTitles && "font-serif")}>{s.blurb}</p>
              ) : null}
              <div className="mt-3">{s.content}</div>
            </section>
          ))}
        </div>
      </div>

      <footer className="mt-4 flex shrink-0 items-center justify-end gap-2">
        {step > 0 ? (
          <button type="button" onClick={back} className={ui.btnSecondary}>
            Back
          </button>
        ) : null}
        <button type="button" onClick={forward} disabled={!canContinue} className={cn(ui.btnPrimary, "wizard-continue")}>
          {last ? doneLabel : (current?.continueLabel ?? "Continue")}
        </button>
      </footer>

      <StepWipe active={wiping} />
    </div>
  );
}
