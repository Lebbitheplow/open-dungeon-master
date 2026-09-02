"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Compass, ImagePlus, Loader2, Map as MapIcon, RefreshCw, X } from "lucide-react";
import { useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { offersImages, useCapabilities } from "@/lib/use-capabilities";
import type {
  CampaignLocation,
  MediaStatus,
} from "@/app/campaigns/[campaignId]/useCampaignStream";

// The area map: current location's rendered map (click to enlarge), its
// exits, and a history of visited places with their maps.
//
// Whoever runs the story can always put a map of their own on an area; the
// redraw button beside it is only offered when the server has an image
// backend to draw with, so a table without one sees the upload alone.
export function MapPanel({
  campaignId,
  locations,
  steersStory,
  mediaStatus = {},
}: {
  campaignId: string;
  locations: CampaignLocation[];
  steersStory: boolean;
  mediaStatus?: Record<string, MediaStatus>;
}) {
  const current = locations.find((location) => location.isCurrent) ?? null;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [enlarged, setEnlarged] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  // A redraw the server refused, as distinct from a render the queue failed
  // (that one arrives through mediaStatus and shows in the placeholder).
  const [regenerateError, setRegenerateError] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const canPaint = offersImages(useCapabilities());

  const shown = (selectedId ? locations.find((l) => l.id === selectedId) : null) ?? current;

  // The uploaded file goes to /api/upload first, then its path to the same
  // route a redraw uses; the panel updates through location_map_ready.
  async function upload(file: File) {
    if (!shown) {
      return;
    }
    setUploading(true);
    setRegenerateError("");
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("read failed"));
        reader.readAsDataURL(file);
      });
      const uploaded = await fetch("/api/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dataUrl, name: file.name, type: file.type }),
      });
      const payload = await uploaded.json().catch(() => ({}));
      if (!uploaded.ok) {
        setRegenerateError(payload.error || "That image would not upload.");
        return;
      }
      const response = await fetch(`/api/campaigns/${campaignId}/locations/${shown.id}/map`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageUrl: payload.url }),
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        setRegenerateError(data.error ?? "Could not set the map.");
      }
    } catch {
      setRegenerateError("That image would not upload.");
    } finally {
      setUploading(false);
    }
  }

  async function regenerate() {
    if (!shown) {
      return;
    }
    setRegenerating(true);
    setRegenerateError("");
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/locations/${shown.id}/map`, {
        method: "POST",
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        setRegenerateError(data.error ?? "Could not queue the redraw.");
      }
    } catch {
      setRegenerateError("Could not reach the server.");
    } finally {
      setRegenerating(false);
    }
  }

  if (!locations.length) {
    return (
      <p className="px-1 py-6 text-center text-xs text-stone-600">
        {canPaint
          ? "No areas charted yet. Maps appear as the party explores."
          : "No areas charted yet. Areas appear as the party explores, and the DM can upload a map for each."}
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
            {steersStory ? (
              <span className="flex items-center gap-2">
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) {
                      void upload(file);
                    }
                    event.target.value = "";
                  }}
                />
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  disabled={uploading || regenerating}
                  title={shown.mapImage ? "Replace map with your own picture" : "Upload a map"}
                  aria-label={shown.mapImage ? "Replace map" : "Upload a map"}
                  className="text-stone-500 hover:text-amber-400 disabled:opacity-50"
                >
                  {uploading ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <ImagePlus className="size-3.5" />
                  )}
                </button>
                {canPaint ? (
                  <button
                    type="button"
                    onClick={regenerate}
                    disabled={regenerating || uploading}
                    title="Redraw this map"
                    aria-label="Redraw this map"
                    className="text-stone-500 hover:text-amber-400 disabled:opacity-50"
                  >
                    {regenerating ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="size-3.5" />
                    )}
                  </button>
                ) : null}
              </span>
            ) : null}
          </div>
          {regenerateError ? (
            <p className="mb-1.5 text-xs text-red-400">{regenerateError}</p>
          ) : null}

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
              {mediaStatus[shown.id]?.state === "failed"
                ? "Map render failed"
                : !canPaint && steersStory
                  ? "Not yet mapped. Upload one above."
                  : "Not yet mapped"}
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
            <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[92vh] w-[min(94vw,64rem)] -translate-x-1/2 -translate-y-1/2 overflow-auto panel rounded-xl p-4">
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
