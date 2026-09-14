"use client";

import { Check, CircleAlert, Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { SAVE_LABEL, type SaveState } from "@/lib/use-autosave";

// The save status every editor shows in its header, read aloud by screen
// readers as it changes (docs/vtt-parity-implementation-plan.md 10.4).
export function SaveBadge({ state, className }: { state: SaveState; className?: string }) {
  if (state === "idle") {
    return null;
  }
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-[11px]",
        state === "error" ? "text-red-300" : state === "saved" ? "text-emerald-400" : "text-stone-500",
        className,
      )}
      aria-live="polite"
    >
      {state === "saving" ? <Loader2 className="size-3 animate-spin" /> : null}
      {state === "saved" ? <Check className="size-3" /> : null}
      {state === "error" ? <CircleAlert className="size-3" /> : null}
      {SAVE_LABEL[state]}
    </span>
  );
}
