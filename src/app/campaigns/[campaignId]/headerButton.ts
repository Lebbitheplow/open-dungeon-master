import { cn } from "@/lib/cn";

// One icon button in the table header. Lit gold when its feature is on,
// quiet stone otherwise; the bigger padding below sm keeps it a finger-sized
// target on a phone. Shared by SessionHeader and VoiceDock, in its own file
// so neither has to import the other.
export function headerButtonClass(lit: boolean, className?: string) {
  return cn(
    "rounded-lg border p-2.5 transition-colors sm:p-1.5",
    lit
      ? "border-amber-500/40 bg-amber-400/10 text-amber-300 shadow-glow-gold"
      : "border-stone-700/70 text-stone-500 hover:border-stone-600 hover:text-stone-300",
    className,
  );
}
