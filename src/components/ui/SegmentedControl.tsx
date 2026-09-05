"use client";

import type { LucideIcon } from "lucide-react";
import type { KeyboardEvent, ReactNode } from "react";
import { cn } from "@/lib/cn";

// Segmented control: a row of options where the active one wears the gold
// foil of the primary button. Behaves as a radio group, so arrow keys move
// the selection.
//
//   <SegmentedControl
//     options={[{ value: "mine", label: "Mine" }, { value: "all", label: "All" }]}
//     value={filter}
//     onChange={setFilter}
//     size="sm"
//   />
export type SegmentedOption<T extends string> = {
  value: T;
  label: ReactNode;
  icon?: LucideIcon;
};

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  size = "md",
  label,
  className,
}: {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  size?: "sm" | "md";
  label?: string;
  className?: string;
}) {
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const dir = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    const i = options.findIndex((o) => o.value === value);
    const next = options[(i + dir + options.length) % options.length];
    if (next) onChange(next.value);
  };
  return (
    <div
      role="radiogroup"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={cn(
        "inline-flex max-w-full items-stretch rounded-lg border border-stone-700/70 bg-stone-950/70 p-0.5 shadow-[0_2px_6px_rgba(4,2,12,0.45)_inset]",
        className,
      )}
    >
      {options.map((o) => {
        const active = o.value === value;
        const Icon = o.icon;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(o.value)}
            className={cn(
              "inline-flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-display uppercase transition-all duration-150 ease-snap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/40",
              size === "sm" ? "h-7 px-2.5 text-[11px] tracking-[0.1em]" : "h-9 px-3.5 text-[13px] tracking-[0.14em]",
              active
                ? "bg-gradient-to-b from-amber-100 via-amber-200 to-amber-400 font-semibold text-amber-950 shadow-[0_1px_0_rgba(253,247,231,0.6)_inset,0_2px_8px_rgba(4,2,12,0.5)]"
                : "text-stone-400 hover:bg-stone-800/70 hover:text-amber-100",
            )}
          >
            {Icon ? <Icon className={size === "sm" ? "size-3.5" : "size-4"} aria-hidden="true" /> : null}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
