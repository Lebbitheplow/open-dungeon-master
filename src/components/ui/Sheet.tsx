"use client";

import * as RadixDialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

// Responsive Radix dialog. Below lg it is a bottom sheet: grip bar, rounded
// top, slides up from the fold, capped at 85vh with safe-area padding. From
// lg up it becomes either a centered dialog (like Dialog.tsx) or a popover
// pinned top-right under the app header, 320px wide.
//
//   <Sheet open={open} onOpenChange={setOpen} title="Filters" desktop="popover">
//     ...
//   </Sheet>
//
// The title is required for screen readers; pass hideTitle to keep it out
// of the visual layout. The layout switch is pure CSS, so there is no
// hydration flicker and no resize listener.
export function Sheet({
  open,
  onOpenChange,
  title,
  hideTitle = false,
  desktop = "dialog",
  children,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  hideTitle?: boolean;
  desktop?: "dialog" | "popover";
  children: ReactNode;
  className?: string;
}) {
  const popover = desktop === "popover";
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        {/* A popover should not dim the page behind it on desktop, but the
            overlay still has to exist so outside clicks dismiss. */}
        <RadixDialog.Overlay
          className={cn(
            "dialog-overlay fixed inset-0 z-[60] bg-[#05030d]/70 backdrop-blur-sm",
            popover && "lg:bg-transparent lg:backdrop-blur-none",
          )}
        />
        <RadixDialog.Content
          className={cn(
            "sheet texture-noise fixed inset-x-0 bottom-0 z-[60] flex max-h-[85vh] flex-col rounded-t-2xl border border-stone-600/50 bg-stone-950 px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-2 shadow-elev-2",
            "lg:bottom-auto lg:rounded-xl lg:p-6",
            popover
              ? "lg:left-auto lg:right-4 lg:top-16 lg:w-80 lg:max-h-[calc(100vh-5rem)]"
              : "lg:left-1/2 lg:right-auto lg:top-1/2 lg:w-[min(92vw,34rem)] lg:max-h-[90vh] lg:-translate-x-1/2 lg:-translate-y-1/2",
            className,
          )}
        >
          <div className="mx-auto mb-3 h-1 w-10 shrink-0 rounded-full bg-stone-600/70 lg:hidden" aria-hidden="true" />
          <div className={cn("flex shrink-0 items-center justify-between gap-3", hideTitle ? "mb-0" : "mb-4")}>
            <RadixDialog.Title
              className={cn(
                "font-display text-lg tracking-wide text-amber-100",
                hideTitle && "sr-only",
              )}
            >
              {title}
            </RadixDialog.Title>
            <RadixDialog.Close
              className={cn(
                "rounded-md p-1 text-stone-400 transition-colors hover:bg-stone-800 hover:text-stone-200",
                hideTitle && "absolute right-3 top-3 lg:right-4 lg:top-4",
              )}
              aria-label="Close"
            >
              <X className="size-4" />
            </RadixDialog.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
