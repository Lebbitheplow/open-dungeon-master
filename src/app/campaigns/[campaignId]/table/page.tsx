"use client";

import { Loader2 } from "lucide-react";
import { use } from "react";
import { BattleMapPanel } from "@/app/campaigns/[campaignId]/BattleMapPanel";
import { MapPanel } from "@/app/campaigns/[campaignId]/MapPanel";
import { useCampaignStream } from "@/app/campaigns/[campaignId]/useCampaignStream";
import { HandoutStage } from "@/components/HandoutStage";
import { SceneTitle } from "@/components/SceneTitle";

// The table view (docs/vtt-parity-implementation-plan.md 13.2): the player
// projection of the board, the scene art, the sky and the current title
// card with no chrome at all, for a television at an in-person table. It
// reads the same stream as any member's browser, so it can never show a
// thing the server withheld from a player.
export default function TablePage({ params }: { params: Promise<{ campaignId: string }> }) {
  const { campaignId } = use(params);
  const { state, refreshBattleMap, markFxPlayed, markCameraDone, markTitleCardShown } = useCampaignStream(campaignId);

  if (state.loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-stone-950">
        <Loader2 className="size-6 animate-spin text-stone-500" />
      </main>
    );
  }
  if (state.error || !state.campaign || !state.me) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-stone-950">
        <p className="text-sm text-stone-400">{state.error || "Sign in as a member of this table to show it."}</p>
      </main>
    );
  }
  return (
    <main className="fixed inset-0 overflow-hidden bg-stone-950">
      <div className="absolute inset-0 flex items-center justify-center p-2">
        {state.battleMap ? (
          <div className="h-full w-full [&_*]:!cursor-default">
            <BattleMapPanel
              campaignId={campaignId}
              view={state.battleMap}
              genre={state.campaign.gameSettings?.genre ?? null}
              encounter={state.encounter ?? null}
              sheets={state.sheets}
              refreshBattleMap={refreshBattleMap}
              canDirect={false}
              canFocusPing={false}
              ping={state.mapPing ?? null}
              fx={state.fx}
              onFxPlayed={markFxPlayed}
              camera={state.camera ?? null}
              onCameraDone={markCameraDone}
              sky={state.scene ?? null}
              canDraw={false}
            />
          </div>
        ) : (
          <div className="w-full max-w-5xl">
            <MapPanel campaignId={campaignId} locations={state.locations} steersStory={false} mediaStatus={state.mediaStatus} genre={state.campaign.gameSettings?.genre} scene={state.scene ?? null} />
          </div>
        )}
      </div>
      <SceneTitle card={state.titleCard} onShown={markTitleCardShown} />
      <HandoutStage campaignId={campaignId} handout={state.handout} userId={state.me.id} steersStory={false} onDismiss={async () => {}} />
    </main>
  );
}
