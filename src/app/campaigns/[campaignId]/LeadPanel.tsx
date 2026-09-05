"use client";

import {
  Check,
  Crown,
  Link as LinkIcon,
  Pencil,
  QrCode,
  StickyNote,
  UserPlus,
  Wand2,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { copyText } from "@/lib/clipboard";
import { buildShareLinks } from "@/lib/share-link";
import { InviteShareDialog } from "@/components/InviteShareDialog";
import { Ribbon } from "@/components/ui/Ribbon";
import { EditCampaignDialog } from "@/app/campaigns/[campaignId]/EditCampaignDialog";
import { LeadFloorControl } from "@/app/campaigns/[campaignId]/LeadFloorControl";
import {
  DirectorArmedBanner,
  DirectorPresets,
} from "@/app/campaigns/[campaignId]/DirectorPanel";
import {
  PendingNotesList,
  pendingCampaignNotes,
} from "@/app/campaigns/[campaignId]/NotesPanel";
import type { CampaignMember } from "@/lib/campaign-types";
import type { Floor } from "@/lib/db/campaigns";
import type { PublicEncounter } from "@/lib/db/encounter-view";
import type { Note } from "@/lib/db/notes";
import type { GameSettings } from "@/lib/schemas/game-settings";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// The lead's desk. Everything the party lead can do to the table, in one
// tab, rather than an invite block on Party, an approval queue on Notes,
// floor buttons in the DM console and a transfer item in a character menu.
//
// Two authorities meet here and the sections follow them exactly
// (src/lib/dm/viewer.ts). `isLead` owns the table: invites, the lead seat,
// campaign details. `steersStory` owns the story: the floor, note approvals,
// directions to the AI. In an AI campaign the lead holds both; at a human-DM
// table the lead keeps the first set and the DM has the second, and this tab
// simply shows fewer cards.

export type LeadCampaign = Parameters<typeof EditCampaignDialog>[0]["campaign"] & {
  dmUserId?: string | null;
  assistantDmUserId?: string | null;
  gameSettings?: GameSettings;
};

function Card({
  icon: Icon,
  title,
  aside,
  children,
}: {
  icon: LucideIcon;
  title: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="mb-3 rounded-lg border border-stone-800 bg-stone-950/40 p-3">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-xs font-medium text-stone-400">
          <Icon className="size-3.5" /> {title}
        </p>
        {aside}
      </div>
      {children}
    </div>
  );
}

// Mid-game invites. The toggle PATCHes game settings, so it follows story
// authority; the invite link itself stays with the lead, who owns who sits
// at the table.
function InvitesCard({
  campaignId,
  inviteCode,
  midGameJoinOpen,
  steersStory,
}: {
  campaignId: string;
  inviteCode: string;
  midGameJoinOpen: boolean;
  steersStory: boolean;
}) {
  const [inviteCopied, setInviteCopied] = useState(false);
  const [inviteSharing, setInviteSharing] = useState(false);
  // The joining toggle has no optimistic state (midGameJoinOpen rides the
  // stream), so a refused PATCH changes nothing on screen; this is the only
  // trace it leaves.
  const [joinToggleError, setJoinToggleError] = useState("");
  // For the copied invite link: a tunnel host plays on 127.0.0.1, an address
  // guests cannot reach, so prefer the server's publicUrl.
  const [publicOrigin, setPublicOrigin] = useState("");
  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/providers")
      .then((response) => (response.ok ? response.json() : {}))
      .then((data: { publicUrl?: string }) => {
        if (!cancelled && typeof data.publicUrl === "string") {
          setPublicOrigin(data.publicUrl);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  async function toggleMidGameJoin() {
    setJoinToggleError("");
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ midGameJoinOpen: !midGameJoinOpen }),
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        setJoinToggleError(data.error ?? "That change was not saved.");
      }
    } catch {
      setJoinToggleError("Could not reach the table.");
    }
  }

  async function copyInviteLink() {
    // The /j interstitial link works for both app and browser recipients.
    const links = buildShareLinks({ publicOrigin, inviteCode });
    if (await copyText(links.appUrl || links.joinUrl)) {
      setInviteCopied(true);
      setTimeout(() => setInviteCopied(false), 1500);
    }
  }

  return (
    <Card icon={UserPlus} title="Invites">
      <div className="flex items-center gap-1.5">
        {steersStory ? (
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
        ) : (
          // A lead at a human-DM table shares the code but the setting is
          // the DM's, so the state shows without a control the server would
          // refuse.
          <span className="rounded-md border border-stone-800 px-2 py-1 text-xs text-stone-500">
            Joining {midGameJoinOpen ? "open" : "closed"}
          </span>
        )}
        {midGameJoinOpen ? (
          <>
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
            <button
              type="button"
              onClick={() => setInviteSharing(true)}
              title="Show the invite QR code and share options"
              className="flex items-center gap-1 rounded-md border border-stone-700 px-2 py-1 text-xs text-stone-400 hover:text-stone-200"
            >
              <QrCode className="size-3.5" />
            </button>
          </>
        ) : null}
      </div>
      {joinToggleError ? <p className="mt-1.5 text-xs text-red-400">{joinToggleError}</p> : null}
      <InviteShareDialog
        open={inviteSharing}
        onOpenChange={setInviteSharing}
        campaignId={campaignId}
        inviteCode={inviteCode}
        canRegenerate
      />
    </Card>
  );
}

// Handing the seat over. The route lets the lead or the owner do this; the
// list leaves out the current lead (nothing to hand) and the DM seats (the
// DM runs the story, not a character, and the lead seat is a player's).
function LeadSeatCard({
  campaignId,
  members,
  sheets,
  leadUserId,
  dmUserIds,
}: {
  campaignId: string;
  members: CampaignMember[];
  sheets: CharacterSheet[];
  leadUserId: string;
  dmUserIds: string[];
}) {
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const candidates = members.filter(
    (member) => member.userId !== leadUserId && !dmUserIds.includes(member.userId),
  );
  const characterFor = (userId: string) =>
    sheets.find((sheet) => sheet.userId === userId && !sheet.isCompanion)?.name;

  async function makeLead(member: CampaignMember) {
    if (!window.confirm(`Make ${member.username} the party lead? You will lose this tab.`)) {
      return;
    }
    setBusy(member.userId);
    setError("");
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/lead`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: member.userId }),
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? "The lead did not change.");
      }
    } catch {
      setError("Could not reach the table.");
    } finally {
      setBusy("");
    }
  }

  return (
    <Card icon={Crown} title="The lead seat">
      {candidates.length ? (
        <ul className="space-y-1">
          {candidates.map((member) => {
            const character = characterFor(member.userId);
            return (
              <li key={member.userId} className="flex items-center gap-2 text-xs">
                <span className="min-w-0 flex-1 truncate text-stone-300">
                  {member.username}
                  {character ? (
                    <span className="text-stone-500"> as {character}</span>
                  ) : null}
                </span>
                <button
                  type="button"
                  disabled={busy !== ""}
                  onClick={() => makeLead(member)}
                  className="shrink-0 rounded-md border border-stone-700 px-2 py-0.5 text-[11px] text-stone-400 hover:text-stone-200 disabled:opacity-40"
                >
                  Make lead
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-[11px] text-stone-600">Nobody else at the table to hand it to.</p>
      )}
      {error ? <p className="mt-1.5 text-xs text-red-400">{error}</p> : null}
    </Card>
  );
}

export function LeadPanel({
  campaignId,
  campaign,
  floor,
  sheets,
  members,
  notes,
  refreshNotes,
  meUserId,
  inviteCode,
  midGameJoinOpen,
  canTransferLead,
  leadUserId,
  steersStory,
  isLead,
  encounter,
  directorArm,
}: {
  campaignId: string;
  campaign: LeadCampaign;
  floor: Floor;
  sheets: CharacterSheet[];
  members: CampaignMember[];
  notes: Note[];
  refreshNotes: () => Promise<void>;
  meUserId: string;
  inviteCode?: string;
  midGameJoinOpen: boolean;
  canTransferLead: boolean;
  leadUserId: string;
  steersStory: boolean;
  isLead: boolean;
  encounter?: PublicEncounter | null;
  // The stream's armed flag, so the banner here refetches the directive on
  // the same beat as the one above the composer.
  directorArm?: Parameters<typeof DirectorArmedBanner>[0]["armed"];
}) {
  const [editing, setEditing] = useState(false);
  const pending = pendingCampaignNotes(notes);
  // The director route accepts any story authority, but Direct only exists
  // in the composer for a lead steering an AI narrator: a human DM has
  // replaced the thing a direction would steer, so the card follows the
  // composer rather than the route.
  const directsAi = steersStory && (campaign.gameSettings?.dmMode ?? "ai") === "ai";
  const dmUserIds = [campaign.dmUserId, campaign.assistantDmUserId].filter(
    (id): id is string => typeof id === "string" && id.length > 0,
  );

  return (
    <div className="text-sm">
      {/* Ember rather than the DM console's gold: the two seats are not the
          same thing, and the composer's Direct pill already wears this. */}
      <div className="mb-3">
        <Ribbon tone="ember">
          <Crown className="mr-1 inline size-3" aria-hidden="true" />
          Lead only
        </Ribbon>
        <p className="mt-1.5 text-xs text-stone-400">You steer this table.</p>
      </div>

      {steersStory ? (
        <LeadFloorControl
          campaignId={campaignId}
          floor={floor}
          sheets={sheets}
          encounter={encounter}
        />
      ) : null}

      {steersStory ? (
        <Card
          icon={StickyNote}
          title="Notes to approve"
          aside={
            pending.length ? (
              <span className="rounded-full bg-amber-900/60 px-1.5 text-[10px] text-amber-200">
                {pending.length}
              </span>
            ) : null
          }
        >
          {pending.length ? (
            <PendingNotesList
              campaignId={campaignId}
              notes={pending}
              members={members}
              meUserId={meUserId}
              refreshNotes={refreshNotes}
            />
          ) : (
            <p className="text-[11px] text-stone-600">Nothing waiting for you.</p>
          )}
        </Card>
      ) : null}

      {directsAi ? (
        <Card icon={Wand2} title="Direct the story">
          <p className="mb-2 text-[11px] text-stone-500">
            Pick Direct in the composer, then Private for a note only the DM sees.
          </p>
          <DirectorArmedBanner campaignId={campaignId} steersStory armed={directorArm} />
          <div className="flex flex-wrap gap-1.5">
            <DirectorPresets campaignId={campaignId} />
          </div>
        </Card>
      ) : null}

      {isLead && inviteCode && campaign.maxPlayers > 1 ? (
        <InvitesCard
          campaignId={campaignId}
          inviteCode={inviteCode}
          midGameJoinOpen={midGameJoinOpen}
          steersStory={steersStory}
        />
      ) : null}

      {canTransferLead ? (
        <LeadSeatCard
          campaignId={campaignId}
          members={members}
          sheets={sheets}
          leadUserId={leadUserId}
          dmUserIds={dmUserIds}
        />
      ) : null}

      {isLead ? (
        <Card
          icon={Pencil}
          title="Campaign details"
          aside={
            <button
              type="button"
              onClick={() => setEditing(true)}
              title="Edit title, premise, setting, difficulty, and player slots"
              className="flex items-center gap-1 rounded-md border border-stone-700 px-2 py-1 text-xs text-stone-300 hover:bg-stone-900"
            >
              <Pencil className="size-3" /> Edit details
            </button>
          }
        >
          <p className="truncate text-stone-200">{campaign.title}</p>
          <p className="mt-1 text-xs text-stone-500">
            Difficulty {campaign.difficulty} · Level {campaign.startingLevel} start · Up to{" "}
            {campaign.maxPlayers} players
          </p>
        </Card>
      ) : null}

      {editing ? (
        <EditCampaignDialog campaign={campaign} onClose={() => setEditing(false)} />
      ) : null}
    </div>
  );
}
