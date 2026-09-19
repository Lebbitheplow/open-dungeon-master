"use client";

import type { CSSProperties } from "react";
import { cn } from "@/lib/cn";

// The kit's slider (docs/visual-overhaul-plan.md 8c.4): the native range
// input, which keeps its keyboard and screen-reader behaviour, dressed as a
// brass knob on a track whose filled part glows gold up to the knob. The
// fill is one custom property, so dragging costs no React work beyond the
// value itself. `bubble` floats the figure over the knob while it is held.
export function Slider({
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  label,
  disabled = false,
  bubble,
  className,
}: {
  value: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number;
  step?: number;
  label: string;
  disabled?: boolean;
  // What the floating figure reads, e.g. (v) => `${v}%`. Omit for none.
  bubble?: (value: number) => string;
  className?: string;
}) {
  const span = max - min || 1;
  const fill = Math.min(100, Math.max(0, ((value - min) / span) * 100));
  return (
    <span className={cn("kit-slider", className)} style={{ "--fill": `${fill}%` } as CSSProperties}>
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
        className="kit-slider-input"
      />
      {bubble ? (
        <span className="kit-slider-bubble" aria-hidden="true">
          {bubble(value)}
        </span>
      ) : null}
    </span>
  );
}
