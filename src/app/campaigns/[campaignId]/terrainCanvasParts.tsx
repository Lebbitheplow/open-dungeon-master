"use client";

import { useEffect, useState } from "react";
import type { LucideIcon } from "lucide-react";
import type { XY } from "@/lib/battlemap/types";

// The small parts of TerrainCanvas that are not its pointer logic: the zoom
// limits and their clamp, the corner buttons, and the image loader. Apart only
// to keep the canvas file to its subject.

export type View = { x: number; y: number; zoom: number };
export const ZOOM = { min: 1, max: 6, step: 1.25 } as const;
export const FIT: View = { x: 0, y: 0, zoom: 1 };

export function ZoomButton({ label, icon: Icon, onClick }: { label: string; icon: LucideIcon; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      // A press on the button must not start a pan or a stroke underneath.
      onPointerDown={(event) => event.stopPropagation()}
      onClick={onClick}
      className="rounded-md border border-stone-700 bg-stone-950/80 p-1 text-stone-300 hover:text-amber-200"
    >
      <Icon className="size-3.5" />
    </button>
  );
}

export function clampView(view: View, widthPx: number, heightPx: number): View {
  const zoom = Math.min(ZOOM.max, Math.max(ZOOM.min, view.zoom));
  if (zoom === 1) {
    return FIT;
  }
  const minX = widthPx - widthPx * zoom;
  const minY = heightPx - heightPx * zoom;
  return {
    zoom,
    x: Math.min(0, Math.max(minX, view.x)),
    y: Math.min(0, Math.max(minY, view.y)),
  };
}

// A picture decoded from a path, kept with the path it came from so a
// swapped or removed picture is simply not the current one.
export function useImage(path: string) {
  const [image, setImage] = useState<{ path: string; element: HTMLImageElement } | null>(null);
  useEffect(() => {
    if (!path) {
      return;
    }
    const loading = new Image();
    loading.src = path;
    loading.onload = () => setImage({ path, element: loading });
    return () => {
      loading.onload = null;
    };
  }, [path]);
  return image && image.path === path ? image : null;
}

// ---- motion laid over the canvas ----

export function calmMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches || document.documentElement.dataset.effects === "low";
}

// Marching ants round the selection. An SVG in tile units stretched over the
// canvas; the stroke does not scale with it, so the dashes stay the same size
// on any map. The dashes show either way; maps.css makes them march.
export function SelectionAnts({
  boxes,
  width,
  height,
}: {
  boxes: Array<{ x0: number; y0: number; x1: number; y1: number }>;
  width: number;
  height: number;
}) {
  if (!boxes.length) {
    return null;
  }
  return (
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="absolute inset-0 size-full overflow-visible">
      {boxes.map((box) => (
        <rect
          key={`${box.x0},${box.y0},${box.x1},${box.y1}`}
          data-map-ants=""
          className="map-ants"
          x={box.x0}
          y={box.y0}
          width={box.x1 - box.x0 + 1}
          height={box.y1 - box.y0 + 1}
          fill="none"
          stroke="#e3c15c"
          strokeWidth={2}
          strokeDasharray="8 4"
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>
  );
}

// A tile answers the tool: gold where it landed, ember where the map refused.
// Made outside React because it is an answer to a pointer, not a state; the
// mark removes itself when its animation ends.
export function flashTiles(
  layer: HTMLElement | null,
  at: XY,
  reach: number,
  size: { width: number; height: number },
  tone: "landed" | "refused",
) {
  if (!layer || calmMotion()) {
    return;
  }
  const x0 = Math.max(0, at.x - reach);
  const y0 = Math.max(0, at.y - reach);
  const x1 = Math.min(size.width - 1, at.x + reach);
  const y1 = Math.min(size.height - 1, at.y + reach);
  const mark = document.createElement("span");
  mark.dataset.mapFlash = tone;
  mark.className = `map-flash absolute rounded-[2px] ${tone === "refused" ? "bg-ember-400" : "bg-amber-300"}`;
  mark.style.left = `${(x0 / size.width) * 100}%`;
  mark.style.top = `${(y0 / size.height) * 100}%`;
  mark.style.width = `${((x1 - x0 + 1) / size.width) * 100}%`;
  mark.style.height = `${((y1 - y0 + 1) / size.height) * 100}%`;
  mark.addEventListener("animationend", () => mark.remove());
  layer.appendChild(mark);
  // Where the stylesheet is late no animation ever ends.
  window.setTimeout(() => mark.remove(), 900);
}
