"use client";

import type { ReactNode } from "react";
import { GameIcon } from "@/components/ui/GameIcon";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";

// One painted banner card for everything that interrupts the table above the
// composer: the floor, the story nudge, a new adventurer. A glyph leads, an
// optional small-caps title names it, and the remedy sits at the far end as
// real buttons, because a banner whose fix is a bare text link is easy to
// miss on a phone (src/app/styles/session.css).
export type BannerTone = "gold" | "ember" | "blood" | "quiet";

export function SessionBanner({
  glyph,
  tone = "gold",
  title,
  lead,
  actions,
  className,
  children,
}: {
  glyph: string;
  tone?: BannerTone;
  title?: ReactNode;
  // Replaces the glyph's slot when the banner has faces to show.
  lead?: ReactNode;
  actions?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div data-tone={tone} className={cn("session-banner reveal-banner", className)}>
      {lead ?? <GameIcon icon={{ kind: "glyph", key: glyph }} size="size-8" />}
      <div className="session-banner-body">
        {title ? <span className="session-banner-title">{title}</span> : null}
        {children}
      </div>
      {actions ? <div className="session-banner-actions">{actions}</div> : null}
    </div>
  );
}

// The banner's button: the kit's small button at banner scale. `primary`
// marks the one action the banner exists to offer.
export function bannerButtonClass(primary = false) {
  return cn(
    ui.btnSmall,
    "session-banner-btn",
    primary && "border-amber-500/50 bg-amber-500/10 text-amber-100",
  );
}
