"use client";

import { Copy, Loader2, Trash2, Users } from "lucide-react";
import { cn } from "@/lib/cn";
import { PIXEL_ICONS, PixelTile, ui } from "@/lib/ui";
import { CampaignCover } from "@/components/CampaignCover";
import { Tooltip } from "@/components/ui/Tooltip";
import { ExportMenu } from "@/app/campaigns/[campaignId]/ExportMenu";
import { steersStory, type HomeCampaign } from "@/app/home/types";

// "Your campaigns": every table this account sits at, with the same three
// actions the old tiles carried. Export is for anyone at the table,
// Duplicate follows story authority, Delete is the owner's alone.
export function CampaignList({
  campaigns,
  loading,
  loadFailed,
  userId,
  cloningId,
  actionError,
  onRetry,
  onClone,
  onDelete,
}: {
  campaigns: HomeCampaign[];
  loading: boolean;
  loadFailed: boolean;
  userId: string;
  cloningId: string;
  actionError: string;
  onRetry: () => void;
  onClone: (id: string) => void;
  onDelete: (campaign: HomeCampaign) => void;
}) {
  return (
    <section className="mb-8">
      <div className="mb-4 flex items-center gap-3">
        <PixelTile src={PIXEL_ICONS.chats} size="size-9" />
        <h2 className="eyebrow text-sm text-amber-200/90">Your campaigns</h2>
      </div>

      {actionError ? <p className="mb-3 text-sm text-red-400">{actionError}</p> : null}

      {loading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="size-5 animate-spin text-stone-500" />
        </div>
      ) : loadFailed && campaigns.length === 0 ? (
        // The list never arrived; a table full of campaigns may still
        // exist, so the empty-table hero would be a lie here.
        <div className="flex flex-col items-center gap-3 rounded-xl border border-stone-800 bg-stone-950/40 px-6 py-10 text-center">
          <p className="text-sm text-stone-400">Could not load your campaigns.</p>
          <button type="button" onClick={onRetry} className={ui.btnSecondary}>
            Try again
          </button>
        </div>
      ) : campaigns.length === 0 ? null : ( // the hero above has already said "empty table"
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {campaigns.map((campaign) => (
            <li key={campaign.id}>
              <CampaignTile
                campaign={campaign}
                userId={userId}
                cloning={cloningId === campaign.id}
                onClone={() => onClone(campaign.id)}
                onDelete={() => onDelete(campaign)}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function CampaignTile({
  campaign,
  userId,
  cloning,
  onClone,
  onDelete,
}: {
  campaign: HomeCampaign;
  userId: string;
  cloning: boolean;
  onClone: () => void;
  onDelete: () => void;
}) {
  const ended = campaign.status === "ended";
  return (
    <a
      href={`/campaigns/${campaign.id}`}
      className={cn(ui.cardHover, "group relative block h-full p-4", ended && "opacity-80")}
    >
      <CampaignCover
        cover={campaign.cover}
        title={campaign.title}
        className="mb-3 rounded-lg shadow-none"
      />
      <div className="mb-1 flex items-start justify-between gap-2">
        <p className="min-w-0 truncate font-display text-lg tracking-wide text-amber-50">
          {campaign.title}
        </p>
        <span
          className={cn(
            "eyebrow shrink-0 rounded-full border px-2 py-0.5 text-[9px]",
            campaign.status === "lobby" && "border-sky-500/40 bg-sky-950/60 text-sky-300",
            campaign.status === "active" &&
              "border-emerald-500/40 bg-emerald-950/60 text-emerald-300",
            ended && "border-stone-600/50 bg-stone-900 text-stone-400",
          )}
        >
          {campaign.status}
        </span>
      </div>
      <p className="text-sm text-stone-400">
        Level {campaign.startingLevel} start · {campaign.difficulty}
        {campaign.theme ? ` · ${campaign.theme}` : ""}
      </p>
      <div className="mt-3 flex items-center justify-between border-t border-stone-700/40 pt-2.5 text-sm text-stone-400">
        <span className="flex items-center gap-1.5">
          <Users className="size-4 text-amber-300/70" />
          {campaign.playerCount}/{campaign.maxPlayers}
          {campaign.maxPlayers === 1 ? " · solo" : ""}
        </span>
        <span className="flex items-center gap-1">
          <ExportMenu campaignId={campaign.id} variant="tile-icon" />
          {steersStory(campaign, userId) ? (
            <Tooltip content="Copy the world into a new campaign, without the transcript">
              <button
                type="button"
                aria-label="Duplicate this campaign"
                disabled={cloning}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onClone();
                }}
                className={cn(ui.iconAction, "hover:text-amber-300")}
              >
                {cloning ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Copy className="size-4" />
                )}
              </button>
            </Tooltip>
          ) : null}
          {campaign.role === "owner" ? (
            <Tooltip content="Delete this campaign">
              <button
                type="button"
                aria-label="Delete this campaign"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onDelete();
                }}
                className={cn(ui.iconAction, "hover:text-red-400")}
              >
                <Trash2 className="size-4" />
              </button>
            </Tooltip>
          ) : null}
        </span>
      </div>
    </a>
  );
}
