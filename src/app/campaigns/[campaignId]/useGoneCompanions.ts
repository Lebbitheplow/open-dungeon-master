"use client";

import { useEffect, useState } from "react";
import type { GoneEntry } from "@/app/campaigns/[campaignId]/departing";

// The Gone list (GET /companions/gone), read again whenever `refreshKey`
// moves: the Party panel lists it, and the story log keeps the departed's
// lines under their own names and faces.
export function useGoneCompanions(campaignId: string, refreshKey: unknown): GoneEntry[] {
  const [gone, setGone] = useState<GoneEntry[]>([]);
  useEffect(() => {
    if (!campaignId) {
      return;
    }
    let live = true;
    void fetch(`/api/campaigns/${campaignId}/companions/gone`)
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { gone?: GoneEntry[] } | null) => {
        if (live && body?.gone) {
          setGone(body.gone);
        }
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [campaignId, refreshKey]);
  return gone;
}
