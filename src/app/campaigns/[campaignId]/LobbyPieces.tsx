"use client";

import { Dices, Pencil } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/cn";
import { CampaignCover } from "@/components/CampaignCover";
import { GameIcon } from "@/components/ui/GameIcon";
import { GoldTitle } from "@/components/ui/GoldTitle";
import { Switch } from "@/components/ui/Switch";
import { Tooltip } from "@/components/ui/Tooltip";
import { ui } from "@/lib/ui";
import type { CampaignCover as CampaignCoverRef } from "@/lib/campaign-types";

// The pieces of the lobby that are pure presentation, kept out of Lobby.tsx so
// that file stays the seat logic and the layout.

// The entrance slot of a lobby section: its place in the stagger (and, on the
// phone, nothing else; the order there comes from a Tailwind order class).
export function enter(index: number): CSSProperties {
  return { "--i": index } as CSSProperties;
}

// A glyph, a small caps title and a rule that wipes in: the head of a group
// of cards in either column.
export function LobbyGroupHead({
  glyph,
  title,
  className,
  style,
}: {
  glyph: string;
  title: string;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div className={cn("lobby-head mb-3", className)} style={style}>
      <GameIcon icon={{ kind: "glyph", key: glyph }} size="size-7" />
      <h2 className="lobby-head-title">{title}</h2>
      <span className="lobby-head-rule motion-rule" aria-hidden="true" />
    </div>
  );
}

// The masthead: the cover as a banner, then where you are and what this
// campaign is. The pencil is the lead's way into EditCampaignDialog.
export function LobbyHero({
  campaign,
  canEdit,
  onEdit,
  className,
  style,
}: {
  campaign: {
    id: string;
    title: string;
    description: string;
    theme: string;
    startingLevel: number;
    difficulty: string;
    cover: CampaignCoverRef | null;
    gameSettings: { genre: string };
  };
  canEdit: boolean;
  onEdit: () => void;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div className={cn(ui.card, "lobby-hero ornate texture-noise mb-6", className)} style={style}>
      <div className="lobby-hero-art">
        <CampaignCover
          cover={campaign.cover}
          title={campaign.title}
          genre={campaign.gameSettings.genre}
          seed={campaign.id}
          className="aspect-[16/7] rounded-b-none border-0 shadow-none"
        />
      </div>
      <div className="relative -mt-1 px-4 pb-4 sm:px-5 sm:pb-5">
        <p className={ui.sectionEyebrow}>Waiting in the lobby</p>
        <div className="mt-1 flex items-start gap-2">
          <GoldTitle className="min-w-0 text-balance break-words leading-tight">{campaign.title}</GoldTitle>
          {canEdit ? (
            <Tooltip content="Edit campaign settings">
              <button
                type="button"
                onClick={onEdit}
                aria-label="Edit campaign settings"
                className="motion-nudge mt-1 shrink-0 rounded-md border border-stone-700/70 p-2 text-stone-400 hover:border-amber-500/40 hover:text-amber-100"
              >
                <Pencil className="size-3.5" />
              </button>
            </Tooltip>
          ) : null}
        </div>
        <span
          className="motion-rule mt-2 block h-px w-full bg-gradient-to-r from-amber-400/60 via-amber-400/20 to-transparent"
          aria-hidden="true"
        />
        <p className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-stone-300">
          <HeroChip>Level {campaign.startingLevel} start</HeroChip>
          <HeroChip>{campaign.difficulty}</HeroChip>
          {campaign.theme ? <HeroChip>{campaign.theme}</HeroChip> : null}
        </p>
        {campaign.description ? (
          <p className="reveal mt-2.5 font-serif text-sm leading-6 text-stone-300">{campaign.description}</p>
        ) : null}
      </div>
    </div>
  );
}

function HeroChip({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-full border border-amber-400/25 bg-amber-400/10 px-2.5 py-0.5 text-amber-100">
      {children}
    </span>
  );
}

// "I roll physical dice": the player's own choice, offered only where the
// table allows real dice and the player has a character to roll for.
export function LobbyRealDice({
  on,
  onToggle,
  className,
  style,
}: {
  on: boolean;
  onToggle: () => void;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <section className={cn(ui.card, "mb-6 flex items-center gap-3 px-4 py-3", className)} style={style}>
      <GameIcon icon={{ kind: "glyph", key: "die-d20" }} size="size-9" />
      <div className="min-w-0 flex-1">
        <p className="text-sm text-stone-200">I roll physical dice</p>
        <p className="text-xs text-stone-500">
          The game pauses for you to enter your real rolls instead of rolling digitally.
        </p>
      </div>
      <span className="flex shrink-0 flex-col items-center gap-1">
        <Switch on={on} onChange={onToggle} label="I roll physical dice" />
        <span className={cn("inline-flex items-center gap-1 text-[11px]", on ? "text-amber-200" : "text-stone-500")}>
          <Dices className="size-3" />
          {on ? "Real dice" : "Digital"}
        </span>
      </span>
    </section>
  );
}
