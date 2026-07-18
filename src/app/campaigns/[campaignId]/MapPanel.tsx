"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Compass, Loader2, Map as MapIcon, RefreshCw, X } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/cn";
import type {
  CampaignLocation,
  MediaStatus,
} from "@/app/campaigns/[campaignId]/useCampaignStream";

// The area map: current location's rendered map (click to enlarge), its
// exits, and a history of visited places with their maps.
export function MapPanel({
  campaignId,
  locations,
  isLead,
  mediaStatus = {},
}: {
  campaignId: string;
  locations: CampaignLocation[];
  isLead: boolean;
  mediaStatus?: Record<string, MediaStatus>;
}) {
  const current = locations.find((location) => location.isCurrent) ?? null;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [enlarged, setEnlarged] = useState(false);
  const [regenerating, setRegenerating] = useState(false);

  const shown = (selectedId ? locations.find((l) => l.id === selectedId) : null) ?? current;

  async function regenerate() {
    if (!shown) {
      return;
    }
    setRegenerating(true);
    try {
      await fetch(`/api/campaigns/${campaignId}/locations/${shown.id}/map`, {
        method: "POST",
      });
    } finally {
      setRegenerating(false);
    }
  }

  if (!locations.length) {
    return (
      <p className="px-1 py-6 text-center text-xs text-stone-600">
        No areas charted yet. Maps appear as the party explores.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {shown ? (
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <h3 className="flex items-center gap-1.5 text-sm font-medium text-stone-200">
              <Compass className="size-4 text-amber-200" />
              {shown.name}
              {shown.isCurrent ? (
                <span className="rounded-full bg-emerald-950 px-1.5 py-0.5 text-[10px] text-emerald-300">
                  here
                </span>
              ) : null}
            </h3>
            {isLead ? (
              <button
                type="button"
                onClick={regenerate}
                disabled={regenerating}
                title="Redraw this map"
                className="text-stone-500 hover:text-amber-400 disabled:opacity-50"
              >
                {regenerating ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="size-3.5" />
                )}
              </button>
            ) : null}
          </div>

          {shown.mapImage ? (
            <button type="button" onClick={() => setEnlarged(true)} className="block w-full">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={shown.mapImage.url}
                alt={`Map of ${shown.name}`}
                className="w-full rounded-md border border-stone-800"
              />
            </button>
          ) : mediaStatus[shown.id] && mediaStatus[shown.id].state !== "failed" ? (
            <div className="flex aspect-[4/3] flex-col items-center justify-center gap-1.5 rounded-md border border-dashed border-stone-800 text-xs text-stone-500">
              <Loader2 className="size-4 animate-spin text-amber-700" />
              {mediaStatus[shown.id].state === "queued"
                ? "Waiting for the render queue..."
                : "Drawing the map..."}
            </div>
          ) : (
            <div className="flex aspect-[4/3] items-center justify-center rounded-md border border-dashed border-stone-800 text-xs text-stone-600">
              <MapIcon className="mr-1.5 size-4" />
              {mediaStatus[shown.id]?.state === "failed" ? "Map render failed" : "Not yet mapped"}
            </div>
          )}

          {shown.layoutDescription ? (
            <p className="mt-1.5 text-xs leading-5 text-stone-400">{shown.layoutDescription}</p>
          ) : null}
          {shown.connections.length ? (
            <p className="mt-1 text-xs text-stone-500">
              Routes: {shown.connections.join(", ")}
            </p>
          ) : null}
        </div>
      ) : null}

      {locations.length > 1 ? (
        <div>
          <h4 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-stone-500">
            Charted areas
          </h4>
          <ul className="space-y-1">
            {locations.map((location) => (
              <li key={location.id}>
                <button
                  type="button"
                  onClick={() =>
                    setSelectedId(location.id === shown?.id ? null : location.id)
                  }
                  className={cn(
                    "w-full rounded px-2 py-1 text-left text-xs",
                    location.id === shown?.id
                      ? "bg-amber-950/40 text-amber-200"
                      : "text-stone-400 hover:bg-stone-900",
                  )}
                >
                  {location.name}
                  {location.isCurrent ? " (here)" : ""}
                  {location.mapImage ? "" : " · unmapped"}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {shown?.mapImage ? (
        <Dialog.Root open={enlarged} onOpenChange={setEnlarged}>
          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 z-40 bg-black/80" />
            <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[92vh] w-[min(94vw,64rem)] -translate-x-1/2 -translate-y-1/2 overflow-auto rounded-xl border border-stone-800 bg-stone-950 p-4">
              <div className="mb-2 flex items-center justify-between">
                <Dialog.Title className="font-serif text-stone-100">{shown.name}</Dialog.Title>
                <Dialog.Close className="rounded p-1 text-stone-400 hover:bg-stone-900">
                  <X className="size-4" />
                </Dialog.Close>
              </div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={shown.mapImage.url} alt={`Map of ${shown.name}`} className="w-full rounded" />
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      ) : null}
    </div>
  );
}
