"use client";

import * as RadixDialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { RulebookReader } from "./RulebookReader";

// The rulebook laid open over the table, so a rule can be checked mid-fight
// without leaving the session. The same book as /rulebook, sized to the
// overlay; it keeps the page and the bookmarks the reader left there.
export function RulebookDialog({
  open,
  onOpenChange,
  startAt,
  startAnchor,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  startAt?: string;
  startAnchor?: string;
}) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="dialog-overlay fixed inset-0 z-[60] bg-[#05030d]/80 backdrop-blur-sm" />
        <RadixDialog.Content aria-describedby={undefined} className="rb-dialog">
          <RadixDialog.Title className="sr-only">The Rulebook</RadixDialog.Title>
          <RulebookReader embedded startAt={startAt} startAnchor={startAnchor} />
          <RadixDialog.Close aria-label="Close the rulebook" className="rb-dialog-close motion-press">
            <X className="size-5" />
          </RadixDialog.Close>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
