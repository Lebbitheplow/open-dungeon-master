"use client";

import { lazy, Suspense } from "react";
import type { PlaceBindingKind } from "@/lib/worldforge/model";

// A place's battle map or encounter opened from the World tab at the table
// (PlaceBattleMaps): the map library's editor sheet, or the encounter's
// form in a sheet, for that one record, over the tab. The table has no
// workshop tools to go to, and the DM keeps the place they were reading.
// Loaded when first opened, so the World tab stays light.

const DmMapLibraryPanel = lazy(() => import("@/app/campaigns/[campaignId]/DmMapLibraryPanel").then((module) => ({ default: module.DmMapLibraryPanel })));
const DmEncounterPrepPanel = lazy(() => import("@/app/campaigns/[campaignId]/DmEncounterPrepPanel").then((module) => ({ default: module.DmEncounterPrepPanel })));

export function TablePrep({ campaignId, open, onClose }: { campaignId: string; open: { kind: PlaceBindingKind; id: string }; onClose: () => void }) {
  return (
    <Suspense fallback={null}>
      {open.kind === "map" ? (
        <DmMapLibraryPanel key={open.id} campaignId={campaignId} layout="gallery" openOnArrival={open.id} only onClose={onClose} />
      ) : (
        <DmEncounterPrepPanel key={open.id} campaignId={campaignId} layout="rows" openOnArrival={open.id} only onClose={onClose} />
      )}
    </Suspense>
  );
}
