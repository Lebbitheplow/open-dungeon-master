"use client";

import { useEffect, useRef } from "react";
import { useNarrationAudio } from "@/app/campaigns/[campaignId]/useNarrationAudio";
import { useAmbienceAudio } from "@/app/campaigns/[campaignId]/useAmbienceAudio";
import type { CampaignState } from "@/app/campaigns/[campaignId]/useCampaignStream";

// The table's two audio channels and how they meet. Narration is the DM's
// voice; ambience is the room. The room drops behind the voice while a
// passage is being read and comes back when it stops. Nothing else in the
// app knows how to do this, which is why the two hooks are joined here
// rather than inside either one.
export function useTableAudio(state: CampaignState) {
  const narration = useNarrationAudio();
  const ambience = useAmbienceAudio(
    state.ambience,
    state.ambienceSting,
    Boolean(state.campaign?.gameSettings?.ambienceEnabled),
  );
  const duckAmbience = ambience.setDucked;
  useEffect(() => {
    duckAmbience(Boolean(narration.playingMessageId));
  }, [duckAmbience, narration.playingMessageId]);

  // Only tts_ready events newer than the seq present when the snapshot first
  // loaded autoplay; the backlog stays silent (replay buttons cover history).
  // Each narration is handed over exactly once: unrelated events (new chat
  // messages) must never re-trigger and restart playback.
  const mountSeqRef = useRef<number | null>(null);
  const handedTtsRef = useRef<string | null>(null);
  const { latestTts, loading, lastSeq } = state;
  const { onTtsReady } = narration;
  useEffect(() => {
    if (mountSeqRef.current === null) {
      if (!loading) {
        mountSeqRef.current = lastSeq;
      }
      return;
    }
    if (latestTts && latestTts.messageId !== handedTtsRef.current) {
      handedTtsRef.current = latestTts.messageId;
      onTtsReady(latestTts.messageId, latestTts.url, latestTts.seq > mountSeqRef.current);
    }
  }, [latestTts, onTtsReady, loading, lastSeq]);

  return { narration, ambience };
}
