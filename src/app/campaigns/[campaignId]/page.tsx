"use client";

import Link from "next/link";
import { PageSkeleton } from "@/components/PageSkeleton";
import { EmptyState } from "@/components/EmptyState";
import { ui } from "@/lib/ui";

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
  const {
    state,
    refresh,
    refreshNotes,
    refreshSideChat,
    refreshWhispers,
    refreshAsks,
    refreshFacts,
    refreshBattleMap,
    markFxPlayed,
    markCameraDone,
    markTitleCardShown,
    playSting,
  } = useCampaignStream(campaignId);

  if (state.loading) {
    return (
      <PageSkeleton kind="table" />
    );
  }

  if (state.error || !state.campaign || !state.me) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-3 p-6">
        <EmptyState
          art="map"
          title={state.error || "Campaign not found."}
          hint={state.answeredBy ? `Answered by ${state.answeredBy}` : undefined}
          action={
            <Link href="/" className={ui.btnSecondary}>
              Back to campaigns
            </Link>
          }
        />
      </main>
    );
  }

  return state.campaign.status === "lobby" ? (
    <Lobby state={state} refresh={refresh} />
  ) : (
    <SessionView
      state={state}
      refreshNotes={refreshNotes}
      refreshFacts={refreshFacts}
      refreshSideChat={refreshSideChat}
      refreshWhispers={refreshWhispers}
      refreshAsks={refreshAsks}
      refreshBattleMap={refreshBattleMap}
      markFxPlayed={markFxPlayed}
      markCameraDone={markCameraDone}
      markTitleCardShown={markTitleCardShown}
      playSting={playSting}
    />
  );
}
