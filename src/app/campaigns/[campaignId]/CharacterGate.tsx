"use client";

import Link from "next/link";
import { UserPlus } from "lucide-react";

// Replaces the composer for a member who joined an active campaign but has
// no character yet: they must create one before acting.
export function CharacterGate({ campaignId }: { campaignId: string }) {
  return (
    <div className="border-t border-stone-800 p-4">
      <div className="mx-auto flex max-w-md flex-col items-center gap-3 rounded-xl border border-amber-900/60 bg-amber-950/20 px-5 py-5 text-center">
        <UserPlus className="size-6 text-amber-300" />
        <div>
          <p className="font-serif text-base text-stone-100">The adventure is underway.</p>
          <p className="mt-1 text-sm text-stone-400">
            Create your character to step into the scene. You can bring one from your library
            or build a new one.
          </p>
        </div>
        <Link
          href={`/campaigns/${campaignId}/character`}
          className="rounded-lg bg-amber-200 px-4 py-2 text-sm font-medium text-stone-950 hover:bg-amber-100"
        >
          Create your character
        </Link>
      </div>
    </div>
  );
}
