"use client";

import { UserPlus } from "lucide-react";
import { useId, useState } from "react";
import { HeroRoutes } from "@/app/campaigns/[campaignId]/HeroRoutes";
import { SessionBanner, bannerButtonClass } from "@/app/campaigns/[campaignId]/SessionBanner";

// Replaces the composer for a member who joined an active campaign but has
// no character yet: the same three ways to a hero as the lobby, so a friend
// who joined mid-game can take a ready-made one and be in the scene in a
// minute. The DM is told to write the newcomer in either way.
export function CharacterGate({ campaignId }: { campaignId: string }) {
  return (
    <div className="border-t border-stone-800 p-4">
      <div className="mx-auto flex max-w-2xl flex-col items-center gap-3 rounded-xl border border-amber-900/60 bg-amber-950/20 px-4 py-4 text-center">
        <UserPlus className="size-6 text-amber-300" />
        <div>
          <p className="font-serif text-base text-stone-100">The adventure is underway.</p>
          <p className="mt-1 text-sm text-stone-400">Pick a hero to step into the scene. The GM writes them in.</p>
        </div>
        <HeroRoutes campaignId={campaignId} className="w-full text-left" />
      </div>
    </div>
  );
}

// A player whose heroes at the table have all fallen
// (src/lib/characters/fallen-logic.ts). Unlike a newcomer they keep the
// table: the chronicle, table talk and the board stay theirs, so this sits
// above the composer instead of replacing it, and opens the same three ways
// to a hero when they are ready. The new one joins at the level the fallen
// hero reached, and the GM is told whose place they take.
export function FallenHeroBanner({ campaignId, name, level }: { campaignId: string; name: string; level: number }) {
  const [open, setOpen] = useState(false);
  const routesId = useId();
  return (
    <div className="border-t border-stone-800 px-3 pt-3" data-fallen-hero="">
      <SessionBanner
        glyph="cue-death"
        tone="blood"
        title={`${name} has fallen`}
        actions={
          <button
            type="button"
            className={bannerButtonClass(!open)}
            aria-expanded={open}
            aria-controls={routesId}
            onClick={() => setOpen(!open)}
          >
            {open ? "Not yet" : "Bring in a new hero"}
          </button>
        }
      >
        <span className="block text-sm">
          Bring in a new hero to keep playing. They join at level {level}, and the GM writes them in.
        </span>
      </SessionBanner>
      {open ? (
        <div id={routesId} className="reveal-height mx-auto mt-2 max-w-2xl">
          <HeroRoutes campaignId={campaignId} />
        </div>
      ) : null}
    </div>
  );
}
