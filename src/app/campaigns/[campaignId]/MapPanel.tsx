"use client";

import { EmptyState } from "@/components/EmptyState";
import * as Dialog from "@radix-ui/react-dialog";
import { ImageOff, ImagePlus, Loader2, RefreshCw, X } from "lucide-react";
import { useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { ContextMenu, type ContextMenuItem } from "@/components/ui/ContextMenu";
import { GameIcon } from "@/components/ui/GameIcon";
import { SectionHead } from "@/components/ui/SectionHead";
import { KitButton, PanelError, RowMenu } from "./PanelKit";
import { SkyLayer } from "@/components/SkyLayer";
import { TheatreInserts } from "@/app/campaigns/[campaignId]/TheatreInserts";
import type { CastMember } from "@/lib/dm/cast";
import type { Speaker } from "@/lib/dm/speech";
import type { SceneState } from "@/lib/scene/state";
import { mapPlaceholder } from "@/lib/placeholders";
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
  genre,
  scene = null,
  inserts = null,
}: {
  campaignId: string;
  locations: CampaignLocation[];
  steersStory: boolean;
  mediaStatus?: Record<string, MediaStatus>;
  // The table's setting, for the stand-in plate an unmapped area shows.
  genre?: string | null;
  // The sky over the table: a tint and weather over the picture.
  scene?: SceneState | null;
  // Theatre inserts (docs/vtt-parity-implementation-plan.md 8.3): who is
  // speaking in the latest passage, and the faces to show for them.
  inserts?: { speakers: Speaker[]; cast: CastMember[]; messageId: string } | null;
}) {
  const current = locations.find((location) => location.isCurrent) ?? null;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [populating, setPopulating] = useState(false);
  const [populateNote, setPopulateNote] = useState("");

  // "Populate" (docs/vtt-parity-implementation-plan.md 12.1): the settlement
  // generator writes the place's people, shops, rumours and a hook.
  async function populate(locationId: string) {
    setPopulating(true);
    setPopulateNote("");
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/locations/${locationId}/populate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const data = await response.json().catch(() => ({}));
      setPopulateNote(response.ok ? `${data.npcs} people and ${data.shops} shops now live here. Hook: ${data.hook?.title ?? ""}` : String(data.error ?? "Could not populate that place."));
    } finally {
      setPopulating(false);
    }
  }
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

  // The third choice beside upload and redraw: no map, so the stand-in plate
  // shows. The panel updates through location_map_ready like the others.
  async function clearToPlaceholder() {
    if (!shown) {
      return;
    }
    setRegenerateError("");
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/locations/${shown.id}/map`, {
        method: "DELETE",
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        setRegenerateError(data.error ?? "Could not clear the map.");
      }
    } catch {
      setRegenerateError("Could not reach the server.");
    }
  }

  if (!locations.length) {
    return (
      <EmptyState size="sm" art="map" title={canPaint ? "No areas charted yet. Maps appear as the party explores." : "No areas charted yet. Areas appear as the party explores, and the DM can upload a map for each."} />
    );
  }

  // Everything the header's buttons do, for the kebab and a right-click.
  const mapItems: ContextMenuItem[] =
    shown && steersStory
      ? [
          { id: "upload", label: shown.mapImage ? "Replace map with your own picture" : "Upload a map", glyph: "tab-handout", disabled: uploading || regenerating, onSelect: () => fileRef.current?.click() },
          ...(canPaint ? [{ id: "redraw", label: "Redraw this map", glyph: "system-maps", disabled: regenerating || uploading, onSelect: () => void regenerate() }] : []),
          ...(shown.mapImage ? [{ id: "clear", label: "Use the placeholder instead", glyph: "quest-hidden", disabled: uploading || regenerating, onSelect: () => void clearToPlaceholder() }] : []),
          { id: "populate", label: "Populate", glyph: "system-party", separated: true, disabled: populating, onSelect: () => void populate(shown.id) },
        ]
      : shown?.mapImage
        ? [{ id: "enlarge", label: "Enlarge the map", glyph: "tab-map", onSelect: () => setEnlarged(true) }]
        : [];

  return (
    <div className="space-y-3">
      {shown ? (
        <ContextMenu items={mapItems} label={shown.name}>
          <SectionHead
            title={
              <>
                {shown.name}
                {shown.isCurrent ? (
                  <span className="ml-1.5 rounded-full border border-emerald-500/40 bg-emerald-950 px-1.5 py-0.5 align-middle font-sans text-[10px] normal-case tracking-normal text-emerald-300">
                    here
                  </span>
                ) : null}
              </>
            }
            glyph="tab-map"
            aside={
              steersStory ? (
                <span className="flex items-center gap-0.5">
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
                  <KitButton
                    tone="icon"
                    always
                    onClick={() => fileRef.current?.click()}
                    disabled={uploading || regenerating}
                    busy={uploading}
                    title={shown.mapImage ? "Replace map with your own picture" : "Upload a map"}
                    aria-label={shown.mapImage ? "Replace map" : "Upload a map"}
                    className="disabled:opacity-50"
                  >
                    {uploading ? null : <ImagePlus className="size-3.5" />}
                  </KitButton>
                  {canPaint ? (
                    <KitButton tone="icon" always onClick={regenerate} disabled={regenerating || uploading} busy={regenerating} title="Redraw this map" aria-label="Redraw this map" className="disabled:opacity-50">
                      {regenerating ? null : <RefreshCw className="size-3.5" />}
                    </KitButton>
                  ) : null}
                  {shown.mapImage ? (
                    <KitButton
                      tone="icon"
                      always
                      onClick={() => void clearToPlaceholder()}
                      disabled={uploading || regenerating}
                      title="Take the map away and show the stand-in for this kind of place"
                      aria-label="Use the placeholder instead"
                      className="disabled:opacity-50"
                    >
                      <ImageOff className="size-3.5" />
                    </KitButton>
                  ) : null}
                  <RowMenu items={mapItems} label={shown.name} />
                </span>
              ) : null
            }
          />
          {regenerateError ? <PanelError className="mb-1.5">{regenerateError}</PanelError> : null}

          {shown.mapImage ? (
            <button
              type="button"
              onClick={() => setEnlarged(true)}
              aria-label={`Enlarge the map of ${shown.name}`}
              className="panel motion-card relative block w-full overflow-hidden rounded-lg"
            >
              {/* The slow drift and the sky's tint over the scene art: the
                  animated scene without a video asset. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={shown.mapImage.url}
                alt={`Map of ${shown.name}`}
                className="ken-burns w-full"
              />
              <SkyLayer scene={scene} mode="art" />
              {inserts ? <TheatreInserts speakers={inserts.speakers} cast={inserts.cast} messageId={inserts.messageId} /> : null}
            </button>
          ) : mediaStatus[shown.id] && mediaStatus[shown.id].state !== "failed" ? (
            <div role="status" className="skeleton-block flex aspect-[4/3] flex-col items-center justify-center gap-1.5 rounded-lg text-xs text-stone-400">
              <Loader2 className="size-4 animate-spin text-amber-400" />
              {mediaStatus[shown.id].state === "queued"
                ? "Waiting for the render queue..."
                : "Drawing the map..."}
            </div>
          ) : (
            // The stand-in plate for the kind of place this is, with the
            // status written over it; a real map replaces it the moment one
            // is drawn or uploaded.
            <div className="panel relative overflow-hidden rounded-lg">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={mapPlaceholder(
                  { name: shown.name, description: shown.layoutDescription, genre },
                  shown.id,
                )}
                alt=""
                loading="lazy"
                className="aspect-[16/9] w-full object-cover opacity-80"
              />
              <p className="absolute inset-x-0 bottom-0 flex items-center gap-1.5 bg-gradient-to-t from-stone-950/90 to-transparent px-2 pb-1.5 pt-4 text-xs text-stone-300">
                <GameIcon icon={{ kind: "glyph", key: "system-maps" }} size="size-5" className="shrink-0" />
                {mediaStatus[shown.id]?.state === "failed"
                  ? "Map render failed"
                  : !canPaint && steersStory
                    ? "Not yet mapped. Upload one above."
                    : "Not yet mapped"}
              </p>
            </div>
          )}

          {shown.layoutDescription ? (
            <p className="mt-1.5 text-xs leading-5 text-stone-400">{shown.layoutDescription}</p>
          ) : null}
          {steersStory ? (
            <KitButton disabled={populating} busy={populating} onClick={() => void populate(shown.id)} title="Invent this place's people, shops, rumours and a hook" className="mt-1.5">
              {populating ? null : <GameIcon icon={{ kind: "glyph", key: "system-party" }} size="size-4" />} Populate
            </KitButton>
          ) : null}
          {populateNote ? <p role="status" className="live-in mt-1 text-xs text-amber-300/80">{populateNote}</p> : null}
          {shown.connections.length ? (
            <p className="mt-1 flex items-start gap-1 text-xs text-stone-500">
              <GameIcon icon={{ kind: "glyph", key: "pace-normal" }} size="size-4" className="mt-0.5 shrink-0" />
              <span>Routes: {shown.connections.join(", ")}</span>
            </p>
          ) : null}
        </ContextMenu>
      ) : null}

      {locations.length > 1 ? (
        <div>
          <SectionHead title="Charted areas" glyph="system-region" level="h4" aside={locations.length} />
          <ul className="space-y-1">
            {locations.map((location) => (
              <li key={location.id}>
                <button
                  type="button"
                  onClick={() =>
                    setSelectedId(location.id === shown?.id ? null : location.id)
                  }
                  aria-pressed={location.id === shown?.id}
                  className={cn(
                    "pk-tap flex w-full items-center gap-1.5 rounded-md border border-transparent px-2 py-1.5 text-left text-xs motion-press",
                    location.id === shown?.id
                      ? "border-amber-500/40 bg-amber-400/10 text-amber-200"
                      : "text-stone-400 hover:bg-stone-900/70 hover:text-stone-200",
                  )}
                >
                  <GameIcon icon={{ kind: "glyph", key: location.mapImage ? "tab-map" : "quest-hidden" }} size="size-4" className="shrink-0" />
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
            <Dialog.Overlay className="dialog-overlay fixed inset-0 z-50 bg-[#05030d]/70 backdrop-blur-sm" />
            <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[92vh] w-[min(94vw,64rem)] -translate-x-1/2 -translate-y-1/2 overflow-auto panel rounded-xl p-4">
              <div className="mb-2 flex items-center justify-between">
                <Dialog.Title className="gold-title font-display text-lg">{shown.name}</Dialog.Title>
                <Dialog.Close aria-label="Close" className="pk-tap rounded p-1 text-stone-400 hover:bg-stone-900 hover:text-amber-200 motion-nudge">
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
