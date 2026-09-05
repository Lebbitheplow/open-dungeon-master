"use client";

import { Swords } from "lucide-react";
import { CampaignCover } from "@/components/CampaignCover";
import { HeroCard } from "@/components/ui/HeroCard";
import { IconChip, ui } from "@/lib/ui";
import { holdsDmSeat, type HomeCampaign } from "@/app/home/types";

// The doorway at the top of home: the table you were last at, with its cover
// art and one line saying who you are there and how full it is.
export function ContinueHero({ campaign, userId }: { campaign: HomeCampaign; userId: string }) {
  const seats = `${campaign.playerCount}/${campaign.maxPlayers}`;
  const party = campaign.maxPlayers === 1 ? "solo" : `${seats} party`;
  const line =
    campaign.status === "lobby"
      ? `Lobby · ${seats}`
      : campaign.playingAs
        ? `Playing as ${campaign.playingAs} · ${party}`
        : holdsDmSeat(campaign, userId)
          ? `Running the table · ${party}`
          : `No character yet · ${party}`;
  return (
    <HeroCard
      eyebrow="Continue"
      title={campaign.title}
      line={line}
      art={
        <CampaignCover
          cover={campaign.cover}
          title={campaign.title}
          className="h-full rounded-none border-0 shadow-none aspect-auto"
        />
      }
      action={
        <a href={`/campaigns/${campaign.id}`} className={ui.btnPrimary}>
          <Swords className="size-4" /> Enter world
        </a>
      }
    />
  );
}

// The same slot when the account has no campaigns at all. Kept word for
// word from the old dashboard: it is a statement about the account, which
// is why a failed list fetch never shows it.
export function EmptyHero() {
  return (
    <div className="flex flex-col items-center gap-4 rounded-xl border border-stone-800 bg-stone-950/40 px-6 py-10 text-center">
      <IconChip icon={Swords} size="size-12" iconSize="size-5" />
      <div className="max-w-sm">
        <p className="text-balance font-serif text-2xl text-stone-200">
          Every campaign starts with an empty table.
        </p>
        <p className="mt-2 text-pretty text-sm text-stone-500">
          Create one and invite your friends, or join theirs with a room code below.
        </p>
      </div>
    </div>
  );
}
