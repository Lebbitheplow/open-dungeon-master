"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  loadCatalogue,
  paintCanvas,
  paintKey,
  paintThumb,
  thumbRequest,
  type ObjectEntry,
  type PaintRequest,
  type PaintStamp,
  type ThumbRequest,
  type TileEntry,
} from "@/lib/battlemap/render/painted";
import type { MapProp } from "@/lib/battlemap/scene";
import { onPaintedMapsChange, paintedMapsOn, writePaintedMaps } from "@/lib/painted-maps";

// The painted renderer, as hooks for the map tools: the ground under the
// editor's overlays, the gallery and history thumbnails, and the catalogue the
// pickers read. The play board has its own (usePaintedMap.ts); this one hands
// back a canvas rather than a URL because the editor draws into a canvas.

// What the editor lays under its vector overlays. `terrain` is the string the
// picture was painted from, so the canvas can mark a square that has changed
// since (a stroke the renderer has not caught up with yet). `stamped` are the
// "x,y" squares whose prop the renderer drew, so the overlay skips its marker.
export type PaintedGround = { key: string; canvas: HTMLCanvasElement; terrain: string; stamped: Set<string> };

export type GroundInput = Omit<PaintRequest, "quality" | "stamps"> & { props?: MapProp[] };

export function stampsOf(props: MapProp[] | undefined): PaintStamp[] {
  return (props ?? []).flatMap((prop) => (prop.stamp ? [{ x: prop.x, y: prop.y, id: prop.stamp }] : []));
}

function lowQuality(): boolean {
  return document.documentElement.dataset.effects === "low" || window.matchMedia("(pointer: coarse)").matches;
}

// The "Flat" toggle in the tileset panel is the device's painted-maps choice
// (src/lib/painted-maps.ts): taste and hardware, never map data.
export function usePaintedPreference(): [boolean, (on: boolean) => void] {
  const on = useSyncExternalStore(onPaintedMapsChange, paintedMapsOn, () => true);
  return [on, writePaintedMaps];
}

export function usePaintedGround(input: GroundInput | null): PaintedGround | null {
  const [ground, setGround] = useState<PaintedGround | null>(null);
  const [painted] = usePaintedPreference();
  const stamps = stampsOf(input?.props);
  const request: PaintRequest | null =
    input && painted
      ? {
          width: input.width,
          height: input.height,
          terrain: input.terrain,
          theme: input.theme,
          genre: input.genre,
          seedKey: input.seedKey,
          skin: input.skin,
          dressing: input.dressing,
          cell: input.cell,
          quality: "full",
          stamps,
        }
      : null;
  // Quality is read inside the effect (it needs the document); everything else
  // that decides the picture is in this key.
  const key = request ? paintKey(request) : "";
  const latest = useRef(request);
  useEffect(() => {
    latest.current = request;
  });

  useEffect(() => {
    const wanted = latest.current;
    if (!wanted || !key) {
      return;
    }
    let cancelled = false;
    // Debounced: a dragged brush changes the terrain several times a second,
    // and only the last of them is worth a repaint.
    const timer = window.setTimeout(() => {
      const quality = lowQuality() ? "low" : "full";
      void paintCanvas({ ...wanted, quality }).then((canvas) => {
        if (cancelled || !canvas) {
          return;
        }
        setGround({
          key,
          canvas,
          terrain: wanted.terrain,
          stamped: new Set((wanted.stamps ?? []).map((stamp) => `${stamp.x},${stamp.y}`)),
        });
      });
    }, 140);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [key]);

  if (!request || !ground) {
    return null;
  }
  // A picture of another map (or another size of this one) is not shown; one
  // of this map that is merely behind is, with the changed squares marked.
  return ground.terrain.length === request.terrain.length && ground.key.split("|")[0] === request.seedKey ? ground : null;
}

// Thumbnails paint one at a time, each after the browser has had a turn, so a
// drawer of forty maps never holds the list up (3.7: never blocking).
let thumbQueue: Promise<unknown> = Promise.resolve();
function queued<T>(job: () => Promise<T>): Promise<T> {
  const next = thumbQueue.then(
    () =>
      new Promise<T>((resolve, reject) => {
        const run = () => job().then(resolve, reject);
        if (typeof window.requestIdleCallback === "function") {
          window.requestIdleCallback(run, { timeout: 400 });
        } else {
          window.setTimeout(run, 16);
        }
      }),
  );
  thumbQueue = next.catch(() => null);
  return next;
}

export function useMapThumb(request: ThumbRequest | null, cell?: number): string | null {
  const [thumb, setThumb] = useState<{ key: string; url: string } | null>(null);
  const [painted] = usePaintedPreference();
  const key = request && painted ? paintKey(thumbRequest(request, cell)) : "";
  const latest = useRef(request);
  useEffect(() => {
    latest.current = request;
  });
  useEffect(() => {
    const wanted = latest.current;
    if (!key || !wanted) {
      return;
    }
    let cancelled = false;
    void queued(() => paintThumb(wanted, cell)).then((url) => {
      if (!cancelled && url) {
        setThumb({ key, url });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [key, cell]);
  return thumb && thumb.key === key ? thumb.url : null;
}

export type Catalogue = { tiles: TileEntry[]; objects: ObjectEntry[] };

let catalogueCache: Catalogue | null = null;

// The painted sets' manifests, for the tileset panel and the stamp picker.
// Null until loaded, and for good on a host without the painted sets.
export function useCatalogue(): Catalogue | null {
  const [catalogue, setCatalogue] = useState<Catalogue | null>(catalogueCache);
  useEffect(() => {
    if (catalogueCache) {
      return;
    }
    let cancelled = false;
    void loadCatalogue().then((loaded) => {
      if (loaded) {
        catalogueCache = loaded;
      }
      if (!cancelled && loaded) {
        setCatalogue(loaded);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return catalogue;
}
