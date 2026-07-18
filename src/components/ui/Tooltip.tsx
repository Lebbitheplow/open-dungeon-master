"use client";

import * as RadixTooltip from "@radix-ui/react-tooltip";
import type { ReactNode } from "react";

// Shared hover tooltip styled to match the dropdown/dialog surfaces. Wraps a
// single interactive child (asChild), opens on hover and keyboard focus.
// Radix tooltips do not open on touch taps, so icon-only triggers should keep
// an aria-label and the Help dialog covers the long-form explanations.
export function Tooltip({
  content,
  side = "top",
  children,
}: {
  content: ReactNode;
  side?: "top" | "bottom" | "left" | "right";
  children: ReactNode;
}) {
  return (
    <RadixTooltip.Provider delayDuration={300}>
      <RadixTooltip.Root>
        <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
        <RadixTooltip.Portal>
          <RadixTooltip.Content
            side={side}
            sideOffset={6}
            collisionPadding={8}
            className="z-50 max-w-60 rounded-md border border-stone-600/60 bg-stone-950 px-2.5 py-1.5 text-xs leading-snug text-stone-300 shadow-elev-2"
          >
            {content}
          </RadixTooltip.Content>
        </RadixTooltip.Portal>
      </RadixTooltip.Root>
    </RadixTooltip.Provider>
  );
}
