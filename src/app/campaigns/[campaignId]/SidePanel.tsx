"use client";

import { Check, Link as LinkIcon, UserPlus } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { EventLog } from "@/app/campaigns/[campaignId]/EventLog";
import { MapPanel } from "@/app/campaigns/[campaignId]/MapPanel";
import { NotesPanel } from "@/app/campaigns/[campaignId]/NotesPanel";
import { PartyPanel } from "@/app/campaigns/[campaignId]/PartyPanel";
import { SessionSettings } from "@/app/campaigns/[campaignId]/SessionSettings";
import { StoryPanel } from "@/app/campaigns/[campaignId]/StoryPanel";
import type {
  AuditEntry,
  CampaignLocation,
  MediaStatus,
} from "@/app/campaigns/[campaignId]/useCampaignStream";
import type { CampaignMember } from "@/lib/campaign-types";
import type { Chapter } from "@/lib/db/chapters";
import type { CharacterEvent } from "@/lib/db/character-events";
import type { Note } from "@/lib/db/notes";
import type { CharacterSheet } from "@/lib/schemas/sheet";

type Tab = "party" | "map" | "story" | "notes" | "log" | "settings";

// The session's right rail: party sheets, the current area map, story
// chapters, table notes, and the stat-change log, tabbed to keep it narrow.
export function SidePanel({
  campaignId,
  sheets,
  members,
  meUserId,
  isLead,
  leadUserId,
  canTransferLead,
  onAdjustHp,
  spotlightUserIds,
  auditLog,
  locations,
  chapters,
  notes,
  characterEvents,
  refreshNotes,
  mediaStatus,
  mapsEnabled,
  inviteCode,
  midGameJoinOpen,
  campaign,
}: {
  campaignId: string;
  sheets: CharacterSheet[];
  members: CampaignMember[];
  meUserId: string;
  isLead: boolean;
  leadUserId: string;
  canTransferLead: boolean;
  onAdjustHp: (delta: number) => void;
  spotlightUserIds: string[];
  auditLog: AuditEntry[];
  locations: CampaignLocation[];
  chapters: Chapter[];
  notes: Note[];
  characterEvents: CharacterEvent[];
  refreshNotes: () => Promise<void>;
  mediaStatus: Record<string, MediaStatus>;
  mapsEnabled: boolean;
  inviteCode?: string;
  midGameJoinOpen?: boolean;
  campaign?: Parameters<typeof SessionSettings>[0]["campaign"];
}) {
  const [tab, setTab] = useState<Tab>("party");
  const [inviteCopied, setInviteCopied] = useState(false);

  // Lead-only mid-game invite controls, shown on the Party tab.
  async function toggleMidGameJoin() {
    await fetch(`/api/campaigns/${campaignId}/settings`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ midGameJoinOpen: !midGameJoinOpen }),
    });
  }

  async function copyInviteLink() {
    await navigator.clipboard.writeText(`${window.location.origin}/join/${inviteCode}`);
    setInviteCopied(true);
    setTimeout(() => setInviteCopied(false), 1500);
  }
  // The lead sees every pending suggestion; members only their own.
  const pendingCount = notes.filter((note) => note.status === "pending").length;
  const tabs: Array<[Tab, string]> = [
    ["party", "Party"],
    ...(mapsEnabled ? ([["map", "Map"]] as Array<[Tab, string]>) : []),
    ["story", "Story"],
    ["notes", "Notes"],
    ["log", "Log"],
    ...(campaign ? ([["settings", "Setup"]] as Array<[Tab, string]>) : []),
  ];

  return (
    <aside className="hidden w-64 shrink-0 flex-col border-l border-stone-800 lg:flex">
      <div className="flex border-b border-stone-800">
        {tabs.map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setTab(value)}
            className={cn(
              "relative flex-1 py-2 text-xs font-medium uppercase tracking-wide",
              tab === value
                ? "border-b-2 border-amber-600 text-amber-300"
                : "text-stone-500 hover:text-stone-300",
            )}
          >
            {label}
            {value === "notes" && pendingCount ? (
              <span className="absolute -mt-1 ml-0.5 rounded-full bg-amber-600 px-1 text-[9px] font-semibold text-stone-950">
                {pendingCount}
              </span>
            ) : null}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {tab === "party" ? (
          <>
          {isLead && inviteCode ? (
            <div className="mb-3 rounded-lg border border-stone-800 bg-stone-950/40 p-3">
              <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-stone-400">
                <UserPlus className="size-3.5" /> New players
              </p>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={toggleMidGameJoin}
                  title="Allow new players to join with the invite code mid-game"
                  className={cn(
                    "rounded-md border px-2 py-1 text-xs",
                    midGameJoinOpen
                      ? "border-amber-700 bg-amber-950/50 text-amber-200"
                      : "border-stone-700 text-stone-400",
                  )}
                >
                  Joining {midGameJoinOpen ? "open" : "closed"}
                </button>
                {midGameJoinOpen ? (
                  <button
                    type="button"
                    onClick={copyInviteLink}
                    title="Copy the invite link"
                    className="flex items-center gap-1 rounded-md border border-stone-700 px-2 py-1 text-xs text-stone-400 hover:text-stone-200"
                  >
                    {inviteCopied ? (
                      <Check className="size-3.5 text-emerald-400" />
                    ) : (
                      <LinkIcon className="size-3.5" />
                    )}
                    {inviteCode}
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}
          <PartyPanel
            sheets={sheets}
            meUserId={meUserId}
            onAdjustHp={onAdjustHp}
            spotlightUserIds={spotlightUserIds}
            isLead={isLead}
            leadUserId={leadUserId}
            canTransferLead={canTransferLead}
            notes={notes}
            members={members}
            refreshNotes={refreshNotes}
            embedded
          />
          </>
        ) : tab === "map" ? (
          <MapPanel
            campaignId={campaignId}
            locations={locations}
            isLead={isLead}
            mediaStatus={mediaStatus}
          />
        ) : tab === "story" ? (
          <StoryPanel campaignId={campaignId} chapters={chapters} isLead={isLead} />
        ) : tab === "notes" ? (
          <NotesPanel
            campaignId={campaignId}
            notes={notes}
            members={members}
            meUserId={meUserId}
            isLead={isLead}
            refreshNotes={refreshNotes}
          />
        ) : tab === "settings" && campaign ? (
          <SessionSettings campaign={campaign} isLead={isLead} />
        ) : (
          <EventLog
            campaignId={campaignId}
            auditLog={auditLog}
            sheets={sheets}
            characterEvents={characterEvents}
            isLead={isLead}
          />
        )}
      </div>
    </aside>
  );
}
