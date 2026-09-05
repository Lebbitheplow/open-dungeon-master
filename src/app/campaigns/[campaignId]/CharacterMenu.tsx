"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  BookUser,
  Crown,
  Flag,
  MessageSquare,
  MoreVertical,
  ShieldBan,
  StickyNote,
  UserMinus,
  Volume2,
  VolumeX,
  Wrench,
} from "lucide-react";
import { useState } from "react";
import { Tooltip } from "@/components/ui/Tooltip";
import { ReportDialog, type ReportTarget } from "@/app/campaigns/[campaignId]/ReportDialog";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// Per-character options menu on each party card: sheet, notes, private
// message, and the lead-only corrections and lead transfer.
export function CharacterMenu({
  sheet,
  steersStory,
  leadUserId,
  canTransferLead,
  onViewSheet,
  onNotes,
  onAdjust,
  onMessage,
  canModerate = false,
  canMute = false,
  muted = false,
}: {
  sheet: CharacterSheet;
  steersStory: boolean;
  leadUserId: string;
  canTransferLead: boolean;
  onViewSheet: () => void;
  onNotes: () => void;
  onAdjust: () => void;
  onMessage?: () => void;
  // Another player's character: report and block are offered.
  canModerate?: boolean;
  // The lead or owner looking at another player: mute and unmute.
  canMute?: boolean;
  muted?: boolean;
}) {
  const [reportTarget, setReportTarget] = useState<ReportTarget | null>(null);

  const item =
    "flex w-full cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs text-stone-300 outline-none data-[highlighted]:bg-stone-800";

  // Opening a modal Dialog straight from a DropdownMenu item races the two
  // Radix components' body cleanup and can strand pointer-events:none on
  // <body> (page looks frozen until refresh). Let the menu finish closing
  // before the dialog mounts.
  const defer = (action: () => void) => (event: Event) => {
    event.preventDefault();
    setTimeout(action, 0);
  };

  async function makeLead() {
    await fetch(`/api/campaigns/${sheet.campaignId}/lead`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: sheet.userId }),
    });
  }

  async function setMuted(next: boolean) {
    await fetch(`/api/campaigns/${sheet.campaignId}/mute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: sheet.userId, muted: next }),
    });
  }

  async function dismissCompanion() {
    await fetch(`/api/campaigns/${sheet.campaignId}/companions/${sheet.id}`, {
      method: "DELETE",
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
          <DropdownMenu.Item className={item} onSelect={defer(onViewSheet)}>
            <BookUser className="size-3.5 text-stone-500" /> View sheet
          </DropdownMenu.Item>
          <DropdownMenu.Item className={item} onSelect={defer(onNotes)}>
            <StickyNote className="size-3.5 text-stone-500" /> Notes
          </DropdownMenu.Item>
          {onMessage ? (
            <DropdownMenu.Item className={item} onSelect={defer(onMessage)}>
              <MessageSquare className="size-3.5 text-stone-500" /> Message
            </DropdownMenu.Item>
          ) : null}
          {steersStory ? (
            <DropdownMenu.Item className={item} onSelect={defer(onAdjust)}>
              <Wrench className="size-3.5 text-stone-500" /> Adjust stats
            </DropdownMenu.Item>
          ) : null}
          {canTransferLead && sheet.userId !== leadUserId && !sheet.isCompanion ? (
            <DropdownMenu.Item className={item} onSelect={makeLead}>
              <Crown className="size-3.5 text-amber-400" /> Make party lead
            </DropdownMenu.Item>
          ) : null}
          {steersStory && sheet.isCompanion ? (
            <DropdownMenu.Item className={item} onSelect={dismissCompanion}>
              <UserMinus className="size-3.5 text-red-400" /> Dismiss companion
            </DropdownMenu.Item>
          ) : null}
          {canMute ? (
            <DropdownMenu.Item className={item} onSelect={() => setMuted(!muted)}>
              {muted ? (
                <>
                  <Volume2 className="size-3.5 text-stone-500" /> Unmute player
                </>
              ) : (
                <>
                  <VolumeX className="size-3.5 text-orange-400" /> Mute player
                </>
              )}
            </DropdownMenu.Item>
          ) : null}
          {canModerate ? (
            <>
              <DropdownMenu.Separator className="my-1 h-px bg-stone-800" />
              <DropdownMenu.Item
                className={item}
                onSelect={defer(() =>
                  setReportTarget({ userId: sheet.userId, authorType: "player", label: sheet.name }),
                )}
              >
                <Flag className="size-3.5 text-amber-400" /> Report player
              </DropdownMenu.Item>
              <DropdownMenu.Item
                className={item}
                onSelect={defer(() =>
                  setReportTarget({
                    userId: sheet.userId,
                    authorType: "player",
                    label: sheet.name,
                    mode: "block",
                  }),
                )}
              >
                <ShieldBan className="size-3.5 text-red-400" /> Block player
              </DropdownMenu.Item>
            </>
          ) : null}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
      {canModerate ? (
        <ReportDialog
          campaignId={sheet.campaignId}
          target={reportTarget}
          onClose={() => setReportTarget(null)}
        />
      ) : null}
    </DropdownMenu.Root>
  );
}
