"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { backdropRect, type Backdrop } from "@/lib/battlemap/backdrop";
import { stampFootprint, type Stamp } from "@/lib/battlemap/stamp";
import { TERRAIN } from "@/lib/battlemap/types";

// The DM's own drawing surface: a battle map's terrain, unfogged, that can
// be painted and stamped on.
//
// Split out of DmMapStudioPanel so the map library can use the same surface.
// The two panels differ in what they are editing (the board on the table
// versus a map in a drawer) and not at all in how a person draws on it.
//
// This is a preview and a drawing surface, never an authority. Every stroke
// it reports is validated server-side by src/lib/battlemap/paint.ts, so a
// wall through a combatant comes back as a sentence rather than a broken
// field, and this canvas simply redraws whatever the server says is true.

const TILE_FILL: Record<string, string> = {
  [TERRAIN.floor]: "#3f3a33",
  [TERRAIN.wall]: "#1b1815",
  [TERRAIN.water]: "#26495e",
  [TERRAIN.difficult]: "#4a4126",
  [TERRAIN.door]: "#6b4f2a",
};

// Over a backdrop the terrain stops being the surface and becomes the
// markings on it, the same reasoning the play view follows in
// battleMapCells.tsx: the art is the floor, and the tint says what the rules
// think is there.
const TILE_TINT: Record<string, { fill: string; alpha: number }> = {
  [TERRAIN.wall]: { fill: "#1b1815", alpha: 0.55 },
  [TERRAIN.water]: { fill: "#26495e", alpha: 0.45 },
  [TERRAIN.difficult]: { fill: "#4a4126", alpha: 0.4 },
  [TERRAIN.door]: { fill: "#6b4f2a", alpha: 0.5 },
};

export function TerrainCanvas({
  terrain,
  width,
  height,
  backdrop,
  onPaint,
  onStamp,
  stamp,
}: {
  terrain: string;
  width: number;
  height: number;
  backdrop?: Backdrop | null;
  // A dragged brush: called on press and on every tile the pointer crosses.
  onPaint?: (x: number, y: number) => void;
  // A stamp: one shape, one click, so it never fires on a drag.
  onStamp?: (x: number, y: number) => void;
  // The shape under the cursor, outlined before it lands.
  stamp?: Pick<Stamp, "kind" | "width" | "height"> | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const paintingRef = useRef(false);
  // The decoded picture, kept with the path it was decoded from. Pairing
  // them means a backdrop that has just been swapped or removed is simply
  // not the current one, so the effect below never has to clear state
  // synchronously to keep a stale image off the canvas.
  const [image, setImage] = useState<{ path: string; element: HTMLImageElement } | null>(null);
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);

  const backdropPath = backdrop?.path ?? "";
  useEffect(() => {
    if (!backdropPath) {
      return;
    }
    // Loading an image is a subscription to something outside React, and the
    // decoded image is what the draw pass depends on, so it is state rather
    // than a ref: the redraw then follows from the dependency instead of
    // from a counter nudging it.
    const loading = new Image();
    loading.src = backdropPath;
    loading.onload = () => setImage({ path: backdropPath, element: loading });
    return () => {
      loading.onload = null;
    };
  }, [backdropPath]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) {
      return;
    }
    const tile = Math.max(4, Math.floor(canvas.width / width));
    canvas.height = tile * height;
    context.clearRect(0, 0, canvas.width, canvas.height);

    const art = Boolean(backdrop && image && image.path === backdrop.path);
    if (backdrop && image && art) {
      const rect = backdropRect(backdrop.transform, width, height, tile);
      context.globalAlpha = backdrop.transform.opacity;
      context.drawImage(image.element, rect.x, rect.y, rect.width, rect.height);
      context.globalAlpha = 1;
    }

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const ch = terrain[y * width + x];
        if (art) {
          const tint = TILE_TINT[ch];
          if (!tint) {
            continue;
          }
          context.globalAlpha = tint.alpha;
          context.fillStyle = tint.fill;
          context.fillRect(x * tile, y * tile, tile, tile);
          context.globalAlpha = 1;
          continue;
        }
        context.fillStyle = TILE_FILL[ch] ?? "#2a2724";
        context.fillRect(x * tile, y * tile, tile, tile);
      }
    }

    context.strokeStyle = "rgba(0, 0, 0, 0.25)";
    context.lineWidth = 1;
    for (let x = 0; x <= width; x += 1) {
      context.beginPath();
      context.moveTo(x * tile, 0);
      context.lineTo(x * tile, height * tile);
      context.stroke();
    }
    for (let y = 0; y <= height; y += 1) {
      context.beginPath();
      context.moveTo(0, y * tile);
      context.lineTo(width * tile, y * tile);
      context.stroke();
    }

    // The shape about to land, outlined where the cursor is. Seeing the room
    // before stamping it is the difference between a tool and a guess.
    if (stamp && hover) {
      const box = stampFootprint({ ...stamp, x: hover.x, y: hover.y });
      context.strokeStyle = "rgba(251, 191, 36, 0.9)";
      context.lineWidth = 2;
      context.strokeRect(
        box.x0 * tile,
        box.y0 * tile,
        (box.x1 - box.x0 + 1) * tile,
        (box.y1 - box.y0 + 1) * tile,
      );
    }
  }, [terrain, width, height, backdrop, image, stamp, hover]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const resize = () => {
      canvas.width = canvas.clientWidth;
      draw();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [draw]);

  function tileAtPointer(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) {
      return null;
    }
    const rect = canvas.getBoundingClientRect();
    const tile = rect.width / width;
    const x = Math.floor((event.clientX - rect.left) / tile);
    const y = Math.floor((event.clientY - rect.top) / tile);
    return x >= 0 && y >= 0 && x < width && y < height ? { x, y } : null;
  }

  const interactive = Boolean(onPaint || onStamp);

  return (
    <canvas
      ref={canvasRef}
      className={cn(
        "block w-full rounded-lg border border-stone-800",
        interactive && "cursor-crosshair",
      )}
      onPointerDown={(event) => {
        const at = tileAtPointer(event);
        if (!at) {
          return;
        }
        if (onStamp) {
          onStamp(at.x, at.y);
          return;
        }
        if (onPaint) {
          paintingRef.current = true;
          onPaint(at.x, at.y);
        }
      }}
      onPointerMove={(event) => {
        const at = tileAtPointer(event);
        if (stamp) {
          setHover(at);
        }
        if (onPaint && paintingRef.current && at) {
          onPaint(at.x, at.y);
        }
      }}
      onPointerUp={() => {
        paintingRef.current = false;
      }}
      onPointerLeave={() => {
        paintingRef.current = false;
        if (stamp) {
          setHover(null);
        }
      }}
    />
  );
}
