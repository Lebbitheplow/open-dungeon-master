import type { ReactNode } from "react";
import { GameIcon } from "@/components/ui/GameIcon";
import { cn } from "@/lib/cn";

// The one section heading for the whole app: a painted glyph, a small-caps
// gold title, a rule that wipes in to the right, and room for a count or a
// control at the far end. The lobby, the character sheet and the creators
// each grew their own; every other screen uses this one so a heading reads
// the same everywhere (docs/visual-overhaul-plan.md 8c).
export function SectionHead({
  title,
  glyph,
  aside,
  level = "h3",
  className,
}: {
  title: ReactNode;
  // A file name under public/assets/icons/glyph, without the extension.
  glyph?: string;
  aside?: ReactNode;
  level?: "h2" | "h3" | "h4";
  className?: string;
}) {
  const Heading = level;
  return (
    <header className={cn("section-head", className)}>
      {glyph ? <GameIcon icon={{ kind: "glyph", key: glyph }} size="size-6" className="shrink-0" /> : null}
      <Heading className="section-head-title">{title}</Heading>
      <span className="section-head-rule motion-rule" aria-hidden="true" />
      {aside ? <span className="section-head-aside">{aside}</span> : null}
    </header>
  );
}
