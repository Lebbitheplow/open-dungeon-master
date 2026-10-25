"use client";

import * as RadixDialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { returnFocus } from "./return-focus";

// Shared Radix dialog shell: blurred night overlay, animated glass panel,
// gold display-font title. Content scrolls internally when tall, under a
// title row that stays put, so the close is never scrolled out of reach of
// a finger (a phone or a Steam Deck has no Escape key to fall back on).
// Closing hands focus back to whatever opened it: these dialogs are opened
// from state, with no Radix trigger, and Radix alone would drop focus on the
// page body, so a keyboard user lost their place in the list behind.
export function Dialog({
  open,
  onOpenChange,
  title,
  icon,
  width = "w-[min(92vw,34rem)]",
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  icon?: ReactNode;
  width?: string;
  children: ReactNode;
}) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="dialog-overlay fixed inset-0 z-[60] bg-[#05030d]/70 backdrop-blur-sm" />
        <RadixDialog.Content
          {...returnFocus}
          className={cn(
            "texture-noise fixed left-1/2 top-1/2 z-[60] max-h-[90vh] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-stone-600/50 bg-stone-950 p-6 shadow-elev-2",
            width,
          )}
        >
          <div className="sticky -top-6 z-10 -mx-6 -mt-6 mb-2 flex items-center justify-between gap-3 bg-stone-950/95 px-6 pb-2 pt-6">
            <RadixDialog.Title className="flex items-center gap-2 font-display text-lg tracking-wide text-amber-100">
              {icon}
              <span className="gold-title">{title}</span>
            </RadixDialog.Title>
            <RadixDialog.Close
              aria-label="Close"
              className="pk-tap -m-1 flex shrink-0 items-center justify-center rounded-md p-2 text-stone-400 transition-colors hover:bg-stone-800 hover:text-stone-200"
            >
              <X className="size-4" />
            </RadixDialog.Close>
          </div>
          {children}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
