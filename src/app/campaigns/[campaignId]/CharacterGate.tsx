"use client";

import { UserPlus } from "lucide-react";
import { HeroRoutes } from "@/app/campaigns/[campaignId]/HeroRoutes";

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
