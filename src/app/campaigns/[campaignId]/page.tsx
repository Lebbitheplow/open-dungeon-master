"use client";

import Link from "next/link";
import { Loader2 } from "lucide-react";
import { use } from "react";
import { Lobby } from "@/app/campaigns/[campaignId]/Lobby";
import { SessionView } from "@/app/campaigns/[campaignId]/SessionView";
import { useCampaignStream } from "@/app/campaigns/[campaignId]/useCampaignStream";

export default function CampaignPage({
  params,
}: {
  params: Promise<{ campaignId: string }>;
}) {
  const { campaignId } = use(params);
  const { state, refresh, refreshNotes, refreshSideChat } = useCampaignStream(campaignId);

  if (state.loading) {
    return (
      <main className="flex flex-1 items-center justify-center">
        <Loader2 className="size-6 animate-spin text-stone-500" />
      </main>
    );
  }

  if (state.error || !state.campaign || !state.me) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-3 p-6">
        <p className="text-stone-400">{state.error || "Campaign not found."}</p>
        <Link href="/" className="text-sm text-amber-200 hover:underline">
          Back to campaigns
        </Link>
      </main>
    );
  }

  return state.campaign.status === "lobby" ? (
    <Lobby state={state} refresh={refresh} />
  ) : (
    <SessionView state={state} refreshNotes={refreshNotes} refreshSideChat={refreshSideChat} />
  );
}
