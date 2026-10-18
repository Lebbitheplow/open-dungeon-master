"use client";

import { ChevronLeft, X } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
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
// These need src/app/styles/creator.css. Two more for long forms a player
// comes back to: `jumpAhead` lets a diamond ahead be tapped once every gate
// before it passes, and `finishFromAnyStep` offers the done button on every
// step once every gate passes (an edit of something already complete).
// `stepNames` prints each step's short label under its diamond.

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
  // Why Continue is held, shown beside it and read out as its description,
  // so the reason is never screens away from the button. With `onBlocked`
  // a tap on the held button (or on the message) goes to the missing pick.
  blocker?: string | null;
  onBlocked?: () => void;
  // A quieter way on from this step, beside Back ("Skip for now", "Save and
  // finish later"): the step decides what it saves, if anything.
  secondary?: { label: ReactNode; onClick: () => void; title?: string };
};

// Something the wizard should say above the steps until the player has seen
// it: a change on one step that set picks aside on another. "Show me" goes
// to `step` (when given), runs `onShow` once that step is the active one,
// and dismisses the notice; the X dismisses it unseen.
export type WizardNotice = {
  message: ReactNode;
  step?: number;
  onShow?: () => void;
  onDismiss: () => void;
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
  notice,
  jumpAhead = false,
  finishFromAnyStep = false,
  stepNames = false,
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
  notice?: WizardNotice;
  jumpAhead?: boolean;
  finishFromAnyStep?: boolean;
  stepNames?: boolean;
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
  const blocker = !canContinue && current?.blocker ? current.blocker : null;
  const blockerId = useId();
  // A step ahead is reachable when no gate from here to it holds.
  const reachable = (index: number) =>
    jumpAhead && index > step && steps.slice(step, index).every((s) => s.canContinue !== false);
  const finishEarly =
    finishFromAnyStep && !last && steps.every((s) => s.canContinue !== false);
  const { wiping, run } = useStepWipe(wipe);

  const labelOf = (s: WizardStep, index: number) =>
    s.label ?? (typeof s.title === "string" ? s.title : `Step ${index + 1}`);

  // The furthest step reached so far. The wipe marks progress: it plays on
  // Continue into a step not yet seen, and every other move (Back, a
  // diamond, "Show me", a second pass) changes step at once, so fixing a
  // pick never costs the ceremony twice.
  const reached = useRef(step);
  useEffect(() => {
    reached.current = Math.max(reached.current, step);
  }, [step]);
  const go = (next: number, progress = false) => {
    // With the wipe on, the step changes once the pane has gone dark.
    run(
      () => {
        if (!controlled) setInternalStep(next);
        onStepChange?.(next);
      },
      !(progress && next > reached.current),
    );
  };
  const back = () => {
    if (step === 0) onCancel?.();
    else go(step - 1);
  };
  const forward = () => {
    if (!canContinue) {
      current?.onBlocked?.();
      return;
    }
    if (last) onDone();
    else go(step + 1, true);
  };

  // The notice's "Show me" may have to change step first; what it then
  // does waits until that step has rendered as the active one, so a scroll
  // to a block on it finds the block. A ref, not state: nothing re-renders
  // for it, the step change already does.
  const afterStep = useRef<{ step: number; run: () => void } | null>(null);
  // A step change moves focus to the new step's title, so a keyboard or
  // screen reader user starts each step at its top and hears where they are;
  // focus otherwise stayed on Continue, below everything the step asks. Not
  // on the first render: opening the wizard leaves focus where it was. A
  // "Show me" that puts focus on a pick runs after this and keeps it.
  const track = useRef<HTMLDivElement>(null);
  const shownStep = useRef(step);
  useEffect(() => {
    if (shownStep.current !== step) {
      shownStep.current = step;
      track.current
        ?.querySelector<HTMLElement>("section[data-active] .wizard-step-heading")
        ?.focus({ preventScroll: true });
    }
    const pending = afterStep.current;
    if (pending && pending.step === step) {
      afterStep.current = null;
      pending.run();
    }
  }, [step]);
  const showNotice = () => {
    if (!notice) {
      return;
    }
    const target = Math.min(Math.max(notice.step ?? step, 0), Math.max(steps.length - 1, 0));
    const run = () => {
      notice.onShow?.();
      notice.onDismiss();
    };
    if (target === step) {
      run();
      return;
    }
    afterStep.current = { step: target, run };
    go(target);
  };

  return (
    <div className={cn("flex h-full min-h-0 w-full flex-col", wipe && "relative", className)}>
      <header className="shrink-0">
        <div className="flex items-center gap-2">
          {step > 0 || onCancel ? (
            <button
              type="button"
              onClick={back}
              // 44px to tap, drawn as before: the negative margin keeps the
              // header where it was.
              className="-my-2 -ml-3 flex size-11 shrink-0 items-center justify-center rounded-md text-stone-400 transition-colors hover:bg-stone-800 hover:text-stone-200"
              aria-label={step === 0 ? "Cancel" : "Back"}
            >
              <ChevronLeft className="size-4" />
            </button>
          ) : null}
          <h2 className="min-w-0 flex-1 truncate font-display text-lg tracking-wide text-amber-100">
            {title}
          </h2>
          {aside ? (
            <span className="mx-1 hidden min-w-0 shrink truncate font-mono text-xs text-stone-400 sm:inline">
              {aside}
            </span>
          ) : null}
          <span className="eyebrow shrink-0 text-xs text-stone-400" aria-live="polite">
            Step {step + 1} / {total}
            {variant === "diamonds" && current ? (
              // The gold step title sits right under the header on a phone,
              // so the name is only shown where there is room for it; a
              // screen reader hears it at every width.
              <span className="sr-only text-amber-300 sm:not-sr-only sm:inline"> · {labelOf(current, step)}</span>
            ) : null}
          </span>
        </div>
        {variant === "diamonds" ? (
          <DiamondStepper
            className="mt-3"
            steps={steps.map((s, i) => ({ key: s.key, label: labelOf(s, i) }))}
            current={step}
            onSelect={go}
            reachable={jumpAhead ? reachable : undefined}
            named={stepNames}
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
        {notice ? (
          <div
            role="status"
            className="wizard-notice reveal mt-3 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-950/20 px-3 py-2 text-xs text-amber-100"
          >
            <span className="min-w-0 flex-1">{notice.message}</span>
            {notice.onShow || notice.step !== undefined ? (
              <button
                type="button"
                onClick={showNotice}
                className="-my-2 min-h-11 shrink-0 whitespace-nowrap px-1 font-mono text-xs text-amber-300 underline-offset-2 hover:text-amber-200 hover:underline"
              >
                Show me
              </button>
            ) : null}
            <button
              type="button"
              onClick={notice.onDismiss}
              aria-label="Dismiss"
              className="-my-2 -mr-3 flex size-11 shrink-0 items-center justify-center rounded text-stone-400 transition-colors hover:text-stone-200"
            >
              <X className="size-3.5" />
            </button>
          </div>
        ) : null}
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
          ref={track}
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
                <GoldTitle
                  as="h3"
                  size="text-lg sm:text-xl"
                  animate={false}
                  tabIndex={-1}
                  className="wizard-step-title wizard-step-heading outline-none"
                >
                  {s.title}
                </GoldTitle>
              ) : (
                <h3 tabIndex={-1} className="wizard-step-heading font-display text-base tracking-wide text-amber-200 outline-none">
                  {s.title}
                </h3>
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
        {blocker ? (
          // The reason Continue is held, right next to it. A button when the
          // step can take the player to the pick, a plain line otherwise.
          current?.onBlocked ? (
            <button
              type="button"
              id={blockerId}
              onClick={current.onBlocked}
              className="wizard-blocker reveal min-w-0 flex-1 text-left text-xs text-amber-300/90 underline-offset-2 hover:text-amber-200 hover:underline"
            >
              <span role="status">{blocker}</span>
              <span className="ml-1 whitespace-nowrap font-mono text-xs text-stone-400">Show me</span>
            </button>
          ) : (
            <p id={blockerId} role="status" className="wizard-blocker reveal min-w-0 flex-1 text-xs text-amber-300/90">
              {blocker}
            </p>
          )
        ) : null}
        {current?.secondary ? (
          <button
            type="button"
            onClick={current.secondary.onClick}
            title={current.secondary.title}
            data-wizard-secondary=""
            className={cn(
              "motion-press min-h-11 shrink-0 px-2 text-xs text-stone-400 underline-offset-2 transition-colors hover:text-amber-200 hover:underline",
              !blocker && "mr-auto",
            )}
          >
            {current.secondary.label}
          </button>
        ) : null}
        {step > 0 ? (
          <button type="button" onClick={back} className={ui.btnSecondary}>
            Back
          </button>
        ) : null}
        {/* Held with aria-disabled rather than disabled when there is a
            reason to show: a disabled button swallows the tap and cannot be
            described, so nothing told the player why (issue #117). */}
        <button
          type="button"
          onClick={forward}
          disabled={!canContinue && !blocker}
          aria-disabled={!canContinue || undefined}
          aria-describedby={blocker ? blockerId : undefined}
          title={blocker ?? undefined}
          className={cn(
            finishEarly ? ui.btnSecondary : ui.btnPrimary,
            "wizard-continue",
            blocker && "wizard-continue-held",
          )}
        >
          {last ? doneLabel : (current?.continueLabel ?? "Continue")}
        </button>
        {finishEarly ? (
          <button type="button" onClick={onDone} className={ui.btnPrimary}>
            {doneLabel}
          </button>
        ) : null}
      </footer>

      <StepWipe active={wiping} />
    </div>
  );
}
