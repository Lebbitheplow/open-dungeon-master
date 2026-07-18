"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { BookUser, Crown, MessageSquare, MoreVertical, StickyNote, Wrench } from "lucide-react";
import { Tooltip } from "@/components/ui/Tooltip";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// Per-character options menu on each party card: sheet, notes, private
// message, and the lead-only corrections and lead transfer.
export function CharacterMenu({
  sheet,
  isLead,
  leadUserId,
  canTransferLead,
  onViewSheet,
  onNotes,
  onAdjust,
  onMessage,
}: {
  sheet: CharacterSheet;
  isLead: boolean;
  leadUserId: string;
  canTransferLead: boolean;
  onViewSheet: () => void;
  onNotes: () => void;
  onAdjust: () => void;
  onMessage?: () => void;
}) {
  const item =
    "flex w-full cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs text-stone-300 outline-none data-[highlighted]:bg-stone-800";

  async function makeLead() {
    await fetch(`/api/campaigns/${sheet.campaignId}/lead`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: sheet.userId }),
    });
  }

  return (
    <DropdownMenu.Root>
      <Tooltip content={`Options for ${sheet.name}: sheet, notes, message and more`}>
        <DropdownMenu.Trigger asChild>
          <button
            type="button"
            aria-label={`Options for ${sheet.name}`}
            className="rounded p-1 text-stone-500 hover:bg-stone-900 hover:text-stone-300"
          >
            <MoreVertical className="size-3.5" />
          </button>
        </DropdownMenu.Trigger>
      </Tooltip>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={4}
          className="panel z-50 min-w-40 rounded-lg p-1"
        >
          <DropdownMenu.Item className={item} onSelect={onViewSheet}>
            <BookUser className="size-3.5 text-stone-500" /> View sheet
          </DropdownMenu.Item>
          <DropdownMenu.Item className={item} onSelect={onNotes}>
            <StickyNote className="size-3.5 text-stone-500" /> Notes
          </DropdownMenu.Item>
          {onMessage ? (
            <DropdownMenu.Item className={item} onSelect={onMessage}>
              <MessageSquare className="size-3.5 text-stone-500" /> Message
            </DropdownMenu.Item>
          ) : null}
          {isLead ? (
            <DropdownMenu.Item className={item} onSelect={onAdjust}>
              <Wrench className="size-3.5 text-stone-500" /> Adjust stats
            </DropdownMenu.Item>
          ) : null}
          {canTransferLead && sheet.userId !== leadUserId ? (
            <DropdownMenu.Item className={item} onSelect={makeLead}>
              <Crown className="size-3.5 text-amber-400" /> Make party lead
            </DropdownMenu.Item>
          ) : null}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
