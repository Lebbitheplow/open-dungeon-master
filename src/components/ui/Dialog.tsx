"use client";

import * as RadixDialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

// Shared Radix dialog shell: blurred night overlay, animated glass panel,
// gold display-font title. Content scrolls internally when tall.
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
          className={cn(
            "texture-noise fixed left-1/2 top-1/2 z-[60] max-h-[90vh] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-stone-600/50 bg-stone-950 p-6 shadow-elev-2",
            width,
          )}
        >
          <div className="mb-4 flex items-center justify-between gap-3">
            <RadixDialog.Title className="flex items-center gap-2 font-display text-lg tracking-wide text-amber-100">
              {icon}
              {title}
            </RadixDialog.Title>
            <RadixDialog.Close className="rounded-md p-1 text-stone-400 transition-colors hover:bg-stone-800 hover:text-stone-200">
              <X className="size-4" />
            </RadixDialog.Close>
          </div>
          {children}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
