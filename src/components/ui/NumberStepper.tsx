"use client";

import { Minus, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { replayAnimation } from "@/lib/motion/replay";

// The kit's number field (docs/visual-overhaul-plan.md 8c.4): a real number
// input, so it can still be typed into, between a minus and a plus that step
// it. Holding a button repeats, faster the longer it is held; the figure pops
// each time it changes; a value at its limit greys the button that would pass
// it. Replaces the browser's spinner arrows.
//
// Typing is held as a draft until it makes a figure inside the limits: with a
// floor of 3, the "1" on the way to "15" is not a value yet, and clamping it
// to 3 would turn the 15 into 35. A figure inside the limits goes out at once;
// one outside them is brought to the nearest limit when the field is left (or
// on Enter), so the owner never hears a number it did not allow.
export function NumberStepper({
  value,
  onChange,
  min = Number.NEGATIVE_INFINITY,
  max = Number.POSITIVE_INFINITY,
  step = 1,
  label,
  disabled = false,
  size = "md",
  suffix,
  className,
}: {
  value: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number;
  step?: number;
  label: string;
  disabled?: boolean;
  size?: "sm" | "md";
  // A unit shown after the figure ("ft", "gp").
  suffix?: string;
  className?: string;
}) {
  const figure = useRef<HTMLInputElement | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const held = useRef<number | null>(null);
  const latest = useRef(value);
  useEffect(() => {
    latest.current = value;
  }, [value]);
  useEffect(
    () => () => {
      if (held.current) window.clearTimeout(held.current);
    },
    [],
  );

  const clamp = (next: number) => Math.min(max, Math.max(min, next));
  const bump = (direction: 1 | -1) => {
    // An unset field (NaN) has nothing to add to: the first press lands on the
    // floor when there is one, else on zero, and steps from there.
    const from = Number.isFinite(latest.current) ? latest.current : Number.isFinite(min) ? min - direction * step : -direction * step;
    const next = clamp(from + direction * step);
    setDraft(null);
    if (next === latest.current) return false;
    latest.current = next;
    onChange(next);
    if (figure.current) replayAnimation(figure.current, "count-pop 240ms var(--ease-spring)");
    return true;
  };
  const hold = (direction: 1 | -1) => {
    if (!bump(direction)) return;
    let wait = 360;
    const again = () => {
      if (!bump(direction)) return;
      wait = Math.max(45, wait * 0.78);
      held.current = window.setTimeout(again, wait);
    };
    held.current = window.setTimeout(again, wait);
  };
  const settle = () => {
    if (draft === null) return;
    const typed = Number(draft);
    setDraft(null);
    if (draft.trim() === "" || !Number.isFinite(typed)) return;
    const next = clamp(typed);
    if (next !== latest.current) {
      latest.current = next;
      onChange(next);
    }
  };
  const release = () => {
    if (held.current) window.clearTimeout(held.current);
    held.current = null;
  };

  return (
    <span className={cn("kit-stepper", size === "sm" && "kit-stepper-sm", className)} data-disabled={disabled ? "" : undefined}>
      <button
        type="button"
        aria-label={`Lower ${label}`}
        disabled={disabled || (Number.isFinite(value) && value <= min)}
        onPointerDown={() => hold(-1)}
        onPointerUp={release}
        onPointerLeave={release}
        onKeyDown={(event) => (event.key === "Enter" || event.key === " ") && bump(-1)}
        className="kit-stepper-btn"
      >
        <Minus className="size-3.5" aria-hidden="true" />
      </button>
      <input
        ref={figure}
        type="number"
        inputMode="numeric"
        aria-label={label}
        value={draft ?? (Number.isFinite(value) ? value : "")}
        min={Number.isFinite(min) ? min : undefined}
        max={Number.isFinite(max) ? max : undefined}
        step={step}
        disabled={disabled}
        onChange={(event) => {
          const text = event.target.value;
          setDraft(text);
          const next = Number(text);
          if (text !== "" && Number.isFinite(next) && next >= min && next <= max && next !== latest.current) {
            latest.current = next;
            onChange(next);
          }
        }}
        onBlur={settle}
        onKeyDown={(event) => event.key === "Enter" && settle()}
        className="kit-stepper-figure"
      />
      {suffix ? <span className="kit-stepper-suffix">{suffix}</span> : null}
      <button
        type="button"
        aria-label={`Raise ${label}`}
        disabled={disabled || (Number.isFinite(value) && value >= max)}
        onPointerDown={() => hold(1)}
        onPointerUp={release}
        onPointerLeave={release}
        onKeyDown={(event) => (event.key === "Enter" || event.key === " ") && bump(1)}
        className="kit-stepper-btn"
      >
        <Plus className="size-3.5" aria-hidden="true" />
      </button>
    </span>
  );
}
