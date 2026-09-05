import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

// Tiny uppercase badge that heads a section: "Only you" in gold, "Lead only"
// in ember. A hairline runs out to the right so it reads as a rule, not a pill.
//
//   <Ribbon tone="ember">Lead only</Ribbon>
export function Ribbon({
  tone = "gold",
  children,
  className,
}: {
  tone?: "gold" | "ember";
  children: ReactNode;
  className?: string;
}) {
  const ember = tone === "ember";
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <span
        className={cn(
          "eyebrow inline-flex items-center rounded-sm border px-1.5 py-0.5 text-[9px] leading-none",
          ember
            ? "border-ember-500/40 bg-ember-500/10 text-ember-300 shadow-glow-ember"
            : "border-amber-400/30 bg-amber-400/10 text-amber-300 shadow-glow-gold",
        )}
      >
        {children}
      </span>
      <span
        className={cn(
          "h-px flex-1 bg-gradient-to-r to-transparent",
          ember ? "from-ember-500/40" : "from-amber-400/30",
        )}
        aria-hidden="true"
      />
    </div>
  );
}
