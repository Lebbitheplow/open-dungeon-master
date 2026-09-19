"use client";

import { useLayoutEffect, useRef } from "react";
import { GameIcon } from "@/components/ui/GameIcon";
import { cn } from "@/lib/cn";

// The reference page's category chips with one travelling mark under the
// chosen one: the IconRail pattern (src/components/ui/IconRail.tsx) for a row
// that wraps. The mark is placed from the DOM and written as CSS variables,
// so picking a category costs no extra render; it is measured again when the
// row re-wraps.

const CHIP =
  "inline-flex min-h-9 items-center gap-1.5 rounded-full border py-0.5 pl-1 pr-3 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/40";
const CHIP_ACTIVE = "border-amber-400/50 bg-amber-400/10 text-amber-100";
const CHIP_IDLE = "border-stone-700/70 text-stone-400 hover:border-amber-500/40 hover:text-stone-200";

export function CategoryRail<T extends string>({
  tabs,
  value,
  onChange,
  label,
  className,
}: {
  // `glyph` is a file name under public/assets/icons/glyph.
  tabs: ReadonlyArray<{ kind: T; label: string; glyph?: string }>;
  value: T;
  onChange: (kind: T) => void;
  label: string;
  className?: string;
}) {
  const railRef = useRef<HTMLDivElement | null>(null);
  const markRef = useRef<HTMLSpanElement | null>(null);

  useLayoutEffect(() => {
    const rail = railRef.current;
    const mark = markRef.current;
    if (!rail || !mark) return;
    const place = () => {
      const chip = rail.querySelector<HTMLElement>('[aria-selected="true"]');
      if (!chip) {
        mark.style.opacity = "0";
        return;
      }
      mark.style.opacity = "1";
      mark.style.setProperty("--ix", `${chip.offsetLeft}px`);
      mark.style.setProperty("--iy", `${chip.offsetTop}px`);
      mark.style.setProperty("--iw", `${chip.offsetWidth}px`);
      mark.style.setProperty("--ih", `${chip.offsetHeight}px`);
    };
    place();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(place);
    observer.observe(rail);
    return () => observer.disconnect();
  }, [value, tabs.length]);

  return (
    <div ref={railRef} className={cn("chip-rail flex flex-wrap gap-x-1.5 gap-y-2", className)} role="tablist" aria-label={label}>
      <span ref={markRef} aria-hidden="true" className="rail-mark rail-mark-h" />
      {tabs.map((tab) => (
        <button
          key={tab.kind}
          type="button"
          role="tab"
          aria-selected={value === tab.kind}
          onClick={() => onChange(tab.kind)}
          className={cn(CHIP, value === tab.kind ? CHIP_ACTIVE : CHIP_IDLE)}
        >
          {tab.glyph ? <GameIcon icon={{ kind: "glyph", key: tab.glyph }} size="size-7" /> : <span className="w-1.5" />}
          {tab.label}
        </button>
      ))}
    </div>
  );
}
