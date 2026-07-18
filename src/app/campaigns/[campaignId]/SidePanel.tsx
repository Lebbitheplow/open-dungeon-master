"use client";

import {
  BookOpen,
  Check,
  Link as LinkIcon,
  Map as MapIcon,
  MessagesSquare,
  ScrollText,
  Settings2,
  StickyNote,
  UserPlus,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { Tooltip } from "@/components/ui/Tooltip";
import { EventLog } from "@/app/campaigns/[campaignId]/EventLog";
import { MapPanel } from "@/app/campaigns/[campaignId]/MapPanel";
import { NotesPanel } from "@/app/campaigns/[campaignId]/NotesPanel";
import { PartyPanel } from "@/app/campaigns/[campaignId]/PartyPanel";
import { SessionSettings } from "@/app/campaigns/[campaignId]/SessionSettings";
import { SideChatPanel } from "@/app/campaigns/[campaignId]/SideChatPanel";
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
import type { SideThread } from "@/lib/db/side-chat";
import type { CharacterSheet } from "@/lib/schemas/sheet";

type Tab = "party" | "map" | "story" | "notes" | "chat" | "log" | "settings";

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
  sideThreads,
  refreshSideChat,
  chatTarget,
  onChatTargetHandled,
  onMessageUser,
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
  sideThreads: SideThread[];
  refreshSideChat: () => Promise<void>;
  chatTarget: string | null;
  onChatTargetHandled: () => void;
  onMessageUser: (userId: string) => void;
  mediaStatus: Record<string, MediaStatus>;
  mapsEnabled: boolean;
  inviteCode?: string;
  midGameJoinOpen?: boolean;
  campaign?: Parameters<typeof SessionSettings>[0]["campaign"];
}) {
  const [tab, setTab] = useState<Tab>("party");
  const [inviteCopied, setInviteCopied] = useState(false);

  // "Message" on a party card jumps to the chat tab; SideChatPanel opens the
  // 1:1 thread from the same request. State-from-props during render, per
  // React's "adjusting state when a prop changes" pattern.
  const [seenChatTarget, setSeenChatTarget] = useState<string | null>(null);
  if (chatTarget && chatTarget !== seenChatTarget) {
    setSeenChatTarget(chatTarget);
    setTab("chat");
  }

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
  const sideUnread = sideThreads.reduce((sum, thread) => sum + thread.unread, 0);
  const tabs: Array<[Tab, string, LucideIcon, string]> = [
    ["party", "Party", Users, "Character sheets, HP and conditions for the whole party."],
    ...(mapsEnabled
      ? ([["map", "Map", MapIcon, "The scene map and discovered locations."]] as Array<
          [Tab, string, LucideIcon, string]
        >)
      : []),
    ["story", "Story", BookOpen, "Chapters and the tale so far."],
    ["notes", "Notes", StickyNote, "Suggest story notes; the party lead approves them."],
    ["chat", "Chat", MessagesSquare, "Side chat between players. The DM does not see it."],
    ["log", "Log", ScrollText, "Dice rolls and DM stat changes, audited."],
    ...(campaign
      ? ([["settings", "Setup", Settings2, "Campaign settings, invites and game toggles."]] as Array<
          [Tab, string, LucideIcon, string]
        >)
      : []),
  ];

  return (
    <aside className="hidden w-80 shrink-0 flex-col border-l border-stone-700/50 bg-gradient-to-b from-stone-950/70 to-stone-950/30 lg:flex">
      <div className="flex gap-1 border-b border-stone-700/50 px-2 py-2">
        {tabs.map(([value, label, Icon, tip]) => (
          <Tooltip key={value} content={tip} side="bottom">
          <button
            type="button"
            onClick={() => setTab(value)}
            className={cn(
              "relative flex flex-1 flex-col items-center gap-1 rounded-lg py-2 transition-all duration-150 ease-snap",
              tab === value
                ? "bg-amber-400/10 text-amber-300 shadow-[0_1px_0_rgba(244,224,166,0.15)_inset,0_0_16px_rgba(212,171,58,0.12)]"
                : "text-stone-500 hover:bg-stone-900/60 hover:text-stone-300",
            )}
          >
            <Icon className="size-4" />
            <span className="eyebrow text-[9px] leading-none">{label}</span>
            {value === "notes" && pendingCount ? (
              <span className="absolute right-1.5 top-1 rounded-full bg-gradient-to-b from-amber-300 to-amber-500 px-1 text-[9px] font-semibold text-amber-950 shadow-glow-gold">
                {pendingCount}
              </span>
            ) : null}
            {value === "chat" && sideUnread ? (
              <span className="absolute right-1.5 top-1 rounded-full bg-gradient-to-b from-amber-300 to-amber-500 px-1 text-[9px] font-semibold text-amber-950 shadow-glow-gold">
                {sideUnread}
              </span>
            ) : null}
            {tab === value ? (
              <span className="absolute -bottom-[9px] h-px w-8 bg-gradient-to-r from-transparent via-amber-400/80 to-transparent" />
            ) : null}
          </button>
          </Tooltip>
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
            onMessageUser={onMessageUser}
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
        ) : tab === "chat" ? (
          <SideChatPanel
            campaignId={campaignId}
            members={members}
            meUserId={meUserId}
            threads={sideThreads}
            refreshSideChat={refreshSideChat}
            openThreadRequest={chatTarget}
            onOpenHandled={onChatTargetHandled}
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
