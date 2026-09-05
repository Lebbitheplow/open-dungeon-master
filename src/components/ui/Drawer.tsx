"use client";

import * as RadixDialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

// Side drawer over a scrim: 80% of the viewport capped at 320px, slides in
// from its edge, closes on Escape or a scrim tap. Radix Dialog underneath
// handles focus trapping and restoring focus to whatever opened it.
//
//   <Drawer open={open} onOpenChange={setOpen} side="left" title="Campaigns">
//     <nav>...</nav>
//   </Drawer>
export function Drawer({
  open,
  onOpenChange,
  side = "left",
  title,
  hideTitle = false,
  children,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  side?: "left" | "right";
  title: ReactNode;
  hideTitle?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="dialog-overlay fixed inset-0 z-50 bg-[#05030d]/70 backdrop-blur-sm" />
        <RadixDialog.Content
          className={cn(
            "texture-noise fixed inset-y-0 z-50 flex w-[80%] max-w-[320px] flex-col border-stone-600/50 bg-stone-950 shadow-elev-2",
            "pt-[calc(1rem+env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))]",
            side === "left" ? "drawer-left left-0 border-r" : "drawer-right right-0 border-l",
            className,
          )}
        >
          <div className="mb-3 flex shrink-0 items-center justify-between gap-3 px-4">
            <RadixDialog.Title
              className={cn("font-display text-lg tracking-wide text-amber-100", hideTitle && "sr-only")}
            >
              {title}
            </RadixDialog.Title>
            <RadixDialog.Close
              className="rounded-md p-1 text-stone-400 transition-colors hover:bg-stone-800 hover:text-stone-200"
              aria-label="Close"
            >
              <X className="size-4" />
            </RadixDialog.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-4">{children}</div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
