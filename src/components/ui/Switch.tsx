"use client";

import { cn } from "@/lib/cn";

// The kit's switch: a brass knob that springs across a dark track and lights
// the track gold when on (docs/visual-overhaul-plan.md 6). A real
// role="switch" button, so it reads and operates as one for a keyboard and a
// screen reader; the state is the knob's position and the track's colour,
// never a word that has to be read.
export function Switch({
  on,
  onChange,
  label,
  disabled = false,
  className,
}: {
  on: boolean;
  onChange: (next: boolean) => void;
  // The accessible name. Rendered by the caller beside the switch.
  label: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={cn("kit-switch", className)}
    >
      <span className="kit-switch-knob" aria-hidden="true" />
    </button>
  );
}
