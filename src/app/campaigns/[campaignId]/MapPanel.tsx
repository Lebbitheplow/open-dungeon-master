"use client";

import { EmptyState } from "@/components/EmptyState";
import * as Dialog from "@radix-ui/react-dialog";
import { returnFocus } from "@/components/ui/return-focus";
import { ImageOff, ImagePlus, Loader2, RefreshCw, X } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { nameWithin, placeTree } from "@/lib/overworld/places";
import { encodeImageForUpload } from "@/lib/image-encode";
import { variantUrl } from "@/lib/image-format";
import { ContextMenu, type ContextMenuItem } from "@/components/ui/ContextMenu";
import { GameIcon } from "@/components/ui/GameIcon";
import { SectionHead } from "@/components/ui/SectionHead";
import { KitButton, PanelError, RowMenu } from "./PanelKit";
import { SkyLayer } from "@/components/SkyLayer";
import { TheatreInserts } from "@/app/campaigns/[campaignId]/TheatreInserts";
import { PlacePartOfDialog } from "@/app/campaigns/[campaignId]/PlacePartOfDialog";
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
//
// The places are listed the way the region map above draws them (issue
// 548): each place of its own, with the parts filed under it (a vault's
// entrance, a village's hall) indented beneath it by their short names.
// Whoever runs the story files an area under a bigger place, or lifts it
// out, from the area's menu.
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

  const tree = useMemo(() => placeTree(locations), [locations]);
  // Places of their own in the order they come, each followed by its parts,
  // depth first, named under their place.
  const rows = useMemo(() => {
    const byId = new Map(locations.map((location) => [location.id, location]));
    const out: Array<{ location: CampaignLocation; depth: number; label: string }> = [];
    const seen = new Set<string>();
    const visit = (location: CampaignLocation, depth: number, within: string) => {
      if (seen.has(location.id)) {
        return;
      }
      seen.add(location.id);
      out.push({ location, depth, label: within ? nameWithin(location.name, within) : location.name });
      for (const id of tree.childrenOf.get(location.id) ?? []) {
        const part = byId.get(id);
        if (part) {
          visit(part, depth + 1, location.name);
        }
      }
    };
    for (const location of locations) {
      if (!tree.parentOf.get(location.id)) {
        visit(location, 0, "");
      }
    }
    return out;
  }, [locations, tree]);
  const parentOfShown = shown ? (locations.find((location) => location.id === tree.parentOf.get(shown.id)) ?? null) : null;

  // The area the "Part of" picker was opened for, from its menu: held by id,
  // so an arrival that changes the shown area while it is open does not
  // change which area it files.
  const [filingId, setFilingId] = useState<string | null>(null);
  const filingPlace = filingId ? (locations.find((location) => location.id === filingId) ?? null) : null;
  const filingParentId = filingPlace ? (tree.parentOf.get(filingPlace.id) ?? null) : null;

  // The uploaded file goes to /api/upload first, then its path to the same
  // route a redraw uses; the panel updates through location_map_ready.
  async function upload(file: File) {
    if (!shown) {
      return;
    }
    setUploading(true);
    setRegenerateError("");
    try {
      const { dataUrl, type } = await encodeImageForUpload(file);
      const uploaded = await fetch("/api/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dataUrl, name: file.name, type }),
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
      <EmptyState size="sm" art="map" title={canPaint ? "No areas charted yet. Maps appear as the party explores." : "No areas charted yet. Areas appear as the party explores, and the GM can upload a map for each."} />
    );
  }

  // Everything the header's buttons do, for the kebab and a right-click.
  const mapItems: ContextMenuItem[] =
    shown && steersStory
      ? [
          { id: "upload", label: shown.mapImage ? "Replace map with your own picture" : "Upload a map", glyph: "ui-upload", disabled: uploading || regenerating, onSelect: () => fileRef.current?.click() },
          ...(canPaint ? [{ id: "redraw", label: "Redraw this map", glyph: "ui-paint", disabled: regenerating || uploading, onSelect: () => void regenerate() }] : []),
          ...(shown.mapImage ? [{ id: "clear", label: "Use the placeholder instead", glyph: "ui-placeholder", disabled: uploading || regenerating, onSelect: () => void clearToPlaceholder() }] : []),
          { id: "populate", label: "Populate", glyph: "system-party", separated: true, disabled: populating, onSelect: () => void populate(shown.id) },
          { id: "part-of", label: parentOfShown ? "Part of another place" : "Part of a bigger place", glyph: "system-region", onSelect: () => setFilingId(shown.id) },
        ]
      : shown?.mapImage
        ? [{ id: "enlarge", label: "Enlarge the map", glyph: "ui-zoom", onSelect: () => setEnlarged(true) }]
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
            className="section-head-wraps"
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
          {parentOfShown ? (
            <p className="-mt-1 mb-1.5 text-xs text-stone-500">
              Part of{" "}
              <button
                type="button"
                onClick={() => setSelectedId(parentOfShown.id)}
                className="pk-tap rounded px-0.5 text-amber-300/90 underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400 motion-press"
              >
                {parentOfShown.name}
              </button>
            </p>
          ) : null}
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
                src={variantUrl(shown.mapImage.url, 1024)}
                alt={`Map of ${shown.name}`}
                loading="lazy"
                decoding="async"
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
                  { scene: shown.ambience?.bed, genre },
                  shown.id,
                )}
                alt=""
                loading="lazy"
                className="aspect-[16/9] w-full object-cover opacity-80"
              />
              <p className="absolute inset-x-0 bottom-0 flex items-center gap-1.5 bg-gradient-to-t from-stone-950/90 to-transparent px-2 pb-1.5 pt-4 text-xs text-stone-300">
                <GameIcon icon={{ kind: "glyph", key: "system-maps" }} size="size-5" className="shrink-0" />
                {mediaStatus[shown.id]?.state === "failed"
                  ? mediaStatus[shown.id]?.reason
                    ? `Map render failed: ${mediaStatus[shown.id]?.reason}`
                    : "Map render failed"
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
            {rows.map(({ location, depth, label }) => (
              <li
                key={location.id}
                className={cn("live-in", depth ? "border-l border-stone-700/70 pl-2" : "")}
                style={depth ? { marginLeft: `${depth * 0.75}rem` } : undefined}
              >
                <button
                  type="button"
                  onClick={() =>
                    setSelectedId(location.id === shown?.id ? null : location.id)
                  }
                  aria-pressed={location.id === shown?.id}
                  aria-label={label === location.name ? undefined : `${location.name}${location.isCurrent ? " (here)" : ""}${location.mapImage ? "" : ", unmapped"}`}
                  className={cn(
                    "pk-tap flex w-full items-center gap-1.5 rounded-md border border-transparent px-2 py-1.5 text-left text-xs motion-press",
                    location.id === shown?.id
                      ? "border-amber-500/40 bg-amber-400/10 text-amber-200"
                      : "text-stone-400 hover:bg-stone-900/70 hover:text-stone-200",
                  )}
                >
                  <GameIcon icon={{ kind: "glyph", key: location.mapImage ? "tab-map" : "quest-hidden" }} size="size-4" className="shrink-0" />
                  {label}
                  {location.isCurrent ? " (here)" : ""}
                  {location.mapImage ? "" : " · unmapped"}
                  {!depth && tree.childrenOf.get(location.id)?.length ? (
                    <span className="ml-auto shrink-0 rounded-full border border-stone-700 px-1.5 text-[10px] text-stone-500">
                      {tree.descendantsOf(location.id).length} inside
                    </span>
                  ) : null}
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
            <Dialog.Content {...returnFocus} className="fixed left-1/2 top-1/2 z-50 max-h-[92vh] w-[min(94vw,64rem)] -translate-x-1/2 -translate-y-1/2 overflow-auto panel rounded-xl p-4">
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

      {filingPlace && steersStory ? (
        <PlacePartOfDialog
          campaignId={campaignId}
          place={filingPlace}
          parentId={filingParentId}
          rows={rows}
          tree={tree}
          open
          onOpenChange={(open) => {
            if (!open) {
              setFilingId(null);
            }
          }}
        />
      ) : null}
    </div>
  );
}
