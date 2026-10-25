"use client";

import Link from "next/link";
import { PageSkeleton } from "@/components/PageSkeleton";
import { EmptyState } from "@/components/EmptyState";
import { ui } from "@/lib/ui";

import { Suspense, lazy, use, useEffect } from "react";
import { useCampaignStream } from "@/app/campaigns/[campaignId]/useCampaignStream";
import { ContentScopeProvider } from "@/lib/content-scope";
import { installPageErrorRecorder } from "@/lib/page-errors";

// The lobby and the table are separate downloads: a table in play never
// needs the lobby's character builder, and a lobby never needs the board,
// the composer or the side panels. The table, where nearly every visit
// lands, starts loading the moment this page mounts, alongside the
// snapshot; a lobby loads once the snapshot says that is where the campaign
// is. Either shows behind the same table skeleton as the snapshot.
const loadLobby = () => import("@/app/campaigns/[campaignId]/Lobby");
const loadSessionView = () => import("@/app/campaigns/[campaignId]/SessionView");
const Lobby = lazy(() => loadLobby().then((module) => ({ default: module.Lobby })));
const SessionView = lazy(() => loadSessionView().then((module) => ({ default: module.SessionView })));

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

  useEffect(() => {
    void loadSessionView();
  }, []);

  // This browser keeps the game page's own errors for "Report a problem"
  // (issue #459, src/lib/page-errors.ts).
  useEffect(() => installPageErrorRecorder(), []);

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

  // Every content request made at this table is its own (src/lib/content-scope.tsx).
  return (
    <ContentScopeProvider campaignId={campaignId}>
      <Suspense fallback={<PageSkeleton kind="table" />}>
      {state.campaign.status === "lobby" ? (
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
      )}
      </Suspense>
    </ContentScopeProvider>
  );
}
