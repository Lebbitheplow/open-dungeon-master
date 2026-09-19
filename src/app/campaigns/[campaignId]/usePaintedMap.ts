"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { paintKey, paintMap, type PaintQuality } from "@/lib/battlemap/render/painted";
import { mapSkinKey } from "@/lib/battlemap/skins";
import type { PlayerMapView } from "@/lib/battlemap/view";
import { onPaintedMapsChange, paintedMapsOn } from "@/lib/painted-maps";

function qualityNow(): PaintQuality | null {
  if (typeof window === "undefined" || !paintedMapsOn()) return null;
  const low = document.documentElement.dataset.effects === "low" || window.matchMedia("(pointer: coarse)").matches;
  return low ? "low" : "full";
}

// The painted picture for a board, as an object URL, or null while it is
// being painted, when the map carries its own backdrop, or when painting is
// off. The previous picture stays up while a newly explored room is painted,
// so walking through a door never flashes the board back to flat tiles.
export function usePaintedMap(view: PlayerMapView | null, genre: string | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  // The device setting, so flipping it repaints or clears an open board at once.
  const enabled = useSyncExternalStore(onPaintedMapsChange, paintedMapsOn, () => true);
  const shown = useRef<{ key: string; url: string } | null>(null);
  const mapId = view?.mapId ?? null;
  const terrain = view?.terrain ?? "";
  // The skin the DM chose for this map; a change repaints the board.
  const skinKey = mapSkinKey(view?.skin);
  const wanted = Boolean(view) && !view?.backdrop && enabled;

  useEffect(() => {
    if (!view || !wanted) {
      return;
    }
    const quality = qualityNow();
    if (!quality) {
      return;
    }
    const request = { width: view.width, height: view.height, terrain, theme: view.theme, genre, seedKey: view.mapId, quality, skin: view.skin };
    const key = paintKey(request);
    if (shown.current?.key === key) {
      return;
    }
    let cancelled = false;
    // Off the critical path: the board is usable on its drawn tiles first.
    const timer = window.setTimeout(() => {
      void paintMap(request).then((next) => {
        if (cancelled || !next) {
          if (next) URL.revokeObjectURL(next);
          return;
        }
        const previous = shown.current;
        shown.current = { key, url: next };
        setUrl(next);
        if (previous) {
          // After the swap has painted, so the old picture is never torn down mid-frame.
          window.setTimeout(() => URL.revokeObjectURL(previous.url), 1000);
        }
      });
    }, 120);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // The view object changes every tick; the picture depends only on these.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapId, terrain, wanted, genre, skinKey, view?.width, view?.height, view?.theme]);

  useEffect(
    () => () => {
      if (shown.current) URL.revokeObjectURL(shown.current.url);
      shown.current = null;
    },
    [mapId],
  );

  return wanted ? url : null;
}
