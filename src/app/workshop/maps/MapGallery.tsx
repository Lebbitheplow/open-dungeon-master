"use client";

import { cn } from "@/lib/cn";
import { ListControls, useListControls } from "@/components/ui/ListControls";
import { ui } from "@/lib/ui";
import { resolveSkin } from "@/lib/battlemap/skins";
import { TerrainCanvas } from "@/app/campaigns/[campaignId]/TerrainCanvas";
import { stampsOf, useMapThumb } from "@/app/campaigns/[campaignId]/useMapPaint";
import { THEME_LABELS, type PreparedMap } from "@/app/workshop/maps/types";

// The workshop's map gallery: every prepared map as a thumbnail with its size,
// theme and skin underneath. Tapping a tile hands the map to the caller, which
// opens the editor.
//
// The thumbnail is painted by the renderer the table plays on
// (docs/visual-overhaul-plan.md 3.7), small and with the dressing off, one at
// a time in idle moments and cached per map and version. Until its picture
// arrives, and on a host without the painted sets, a tile shows the flat
// TerrainCanvas it always did, so the list is never waiting on art. A map with
// its own backdrop keeps showing that. The picture is wrapped
// pointer-events-none because a thumbnail is a picture, not a surface.

// Sharper than the history strip's 8 px: a gallery card is some 300 px wide.
const CARD_CELL = 16;

function MapThumb({ map, genre }: { map: PreparedMap; genre: string | null | undefined }) {
  const thumb = useMapThumb(
    map.backdrop
      ? null
      : {
          width: map.width,
          height: map.height,
          terrain: map.terrain,
          theme: map.theme,
          genre,
          skin: map.skin,
          seedKey: map.id,
          stamps: stampsOf(map.props),
        },
    CARD_CELL,
  );
  return (
    <div className="pointer-events-none relative overflow-hidden rounded-md" style={{ aspectRatio: `${map.width} / ${map.height}` }}>
      {thumb ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={thumb} alt="" className="map-fade-in block size-full object-cover" />
      ) : (
        <TerrainCanvas terrain={map.terrain} width={map.width} height={map.height} backdrop={map.backdrop} />
      )}
    </div>
  );
}

export function MapGallery({
  maps,
  selectedId,
  genre,
  onOpen,
}: {
  maps: PreparedMap[];
  selectedId: string;
  // The campaign's setting, which decides a map's default skin.
  genre?: string | null;
  onOpen: (map: PreparedMap) => void;
}) {
  const controls = useListControls(maps);
  if (!maps.length) {
    return (
      <p className="text-xs text-stone-500">
        Nothing in the drawer yet. Roll one, start from blank rock, or import a drawing.
      </p>
    );
  }
  return (
    <div className="space-y-3">
    <ListControls controls={controls} placeholder="Find a map" />
    {controls.filtered && !controls.shown.length ? (
      <p className="text-xs text-stone-500">Nothing matches that. Clear the search or the tag.</p>
    ) : null}
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {controls.shown.map((map) => (
        <li key={map.id}>
          <button
            type="button"
            onClick={() => onOpen(map)}
            aria-label={`Open ${map.name}`}
            className={cn(
              ui.card,
              ui.tileHover,
              "flex w-full flex-col gap-2 p-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/40",
              map.id === selectedId && "border-amber-500/40",
            )}
          >
            <MapThumb map={map} genre={genre} />
            <div className="min-w-0 px-1 pb-1">
              <p className="truncate font-display text-sm tracking-wide text-amber-50">{map.name}</p>
              <p className="text-[11px] text-stone-500">
                {map.width} × {map.height} · {THEME_LABELS[map.theme]} · {resolveSkin(genre, map.theme, map.skin).name}
              </p>
            </div>
          </button>
        </li>
      ))}
    </ul>
    </div>
  );
}
