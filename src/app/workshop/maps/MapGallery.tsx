"use client";

import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { TerrainCanvas } from "@/app/campaigns/[campaignId]/TerrainCanvas";
import { THEME_LABELS, type PreparedMap } from "@/app/workshop/maps/types";

// The workshop's map gallery: every prepared map as a thumbnail tile that
// renders the real terrain grid, with its size and theme underneath. Tapping
// a tile hands the map to the caller, which opens the editor.
//
// The thumbnail is the same TerrainCanvas the editor draws on, sized by its
// container: the canvas fits itself to clientWidth, so no second renderer is
// needed. It is wrapped pointer-events-none because a thumbnail is a picture,
// not a surface, and the hover outline would otherwise flicker under a
// finger scrolling the gallery.

export function MapGallery({
  maps,
  selectedId,
  onOpen,
}: {
  maps: PreparedMap[];
  selectedId: string;
  onOpen: (map: PreparedMap) => void;
}) {
  if (!maps.length) {
    return (
      <p className="text-xs text-stone-500">
        Nothing in the drawer yet. Roll one, start from blank rock, or import a drawing.
      </p>
    );
  }
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {maps.map((map) => (
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
            <div className="pointer-events-none overflow-hidden rounded-md">
              <TerrainCanvas
                terrain={map.terrain}
                width={map.width}
                height={map.height}
                backdrop={map.backdrop}
              />
            </div>
            <div className="min-w-0 px-1 pb-1">
              <p className="truncate font-display text-sm tracking-wide text-amber-50">{map.name}</p>
              <p className="text-[11px] text-stone-500">
                {map.width} × {map.height} · {THEME_LABELS[map.theme]}
              </p>
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}
