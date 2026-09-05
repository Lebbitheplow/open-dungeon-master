"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Maximize2, Minus, Plus, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import type { Backdrop } from "@/lib/battlemap/backdrop";
import type { Brush as BrushName } from "@/lib/battlemap/paint";
import type { Stamp } from "@/lib/battlemap/stamp";
import type { ShapeTool } from "@/lib/battlemap/tools";
import type { DoorStates, LightZone, MapLabel, MapProp } from "@/lib/battlemap/scene";
import type { AmbientLight, MapLight, XY } from "@/lib/battlemap/types";
import {
  drawGrid,
  drawGround,
  drawLights,
  drawScene,
  drawToolPreview,
} from "@/app/campaigns/[campaignId]/terrainDraw";

// The DM's own drawing surface: a battle map's terrain, unfogged, that can
// be painted, stamped, lit, labelled and looked at up close.
//
// Shared by the studio (the board on the table), the library (a map in the
// drawer) and the gallery (a thumbnail, which passes no tool and gets no
// interaction). The two editors differ in what they are editing and not at
// all in how a person draws on it.
//
// This is a preview and a drawing surface, never an authority. Every stroke
// it reports is validated server-side by src/lib/battlemap/paint.ts, so a
// wall through a combatant comes back as a sentence rather than a broken
// field, and this canvas simply redraws whatever the server says is true.
//
// Zoom and pan are the one thing it owns outright: a 24x18 map at
// fit-to-width on a phone is a picture, not a surface, and the shells the
// client apps wrap this page in are phones half the time. Two fingers
// pinch and drag; the wheel zooms at the cursor; the Move tool drags with
// one finger. touch-none keeps a one-finger brush stroke from scrolling the
// page out from under the drawing.

export type CanvasTool =
  | { kind: "brush"; brush: BrushName; radius: number }
  | { kind: "shape"; tool: ShapeTool; brush: BrushName }
  | { kind: "stamp"; stamp: Pick<Stamp, "kind" | "width" | "height"> }
  | { kind: "light"; brightRadius: number; dimRadius: number }
  | { kind: "label" }
  | { kind: "prop" }
  | { kind: "door" }
  | { kind: "zone"; ambient: AmbientLight }
  | { kind: "pick" }
  | { kind: "pan" };

type View = { x: number; y: number; zoom: number };
const ZOOM = { min: 1, max: 6, step: 1.25 } as const;
const FIT: View = { x: 0, y: 0, zoom: 1 };

function ZoomButton({ label, icon: Icon, onClick }: { label: string; icon: LucideIcon; onClick: () => void }) {
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

function clampView(view: View, widthPx: number, heightPx: number): View {
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
function useImage(path: string) {
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

export function TerrainCanvas({
  terrain,
  width,
  height,
  backdrop,
  lights,
  labels,
  props,
  doors,
  zones,
  overlayPath,
  tool = null,
  zoomable = false,
  onStroke,
  onStrokeEnd,
  onShape,
  onStamp,
  onLight,
  onLabel,
  onProp,
  onDoor,
  onZone,
  onPick,
}: {
  terrain: string;
  width: number;
  height: number;
  backdrop?: Backdrop | null;
  lights?: MapLight[];
  labels?: MapLabel[];
  props?: MapProp[];
  doors?: DoorStates;
  zones?: LightZone[];
  overlayPath?: string;
  tool?: CanvasTool | null;
  zoomable?: boolean;
  // A dragged brush: called on press and on every new tile the pointer
  // crosses, then onStrokeEnd once when it lifts.
  onStroke?: (x: number, y: number) => void;
  onStrokeEnd?: () => void;
  // A shape or a zone: pressed on one tile, released on another.
  onShape?: (from: XY, to: XY) => void;
  onZone?: (from: XY, to: XY) => void;
  // One tap each: a stamp, a light, a label, a prop, a door state, or the
  // eyedropper.
  onStamp?: (x: number, y: number) => void;
  onLight?: (x: number, y: number) => void;
  onLabel?: (x: number, y: number) => void;
  onProp?: (x: number, y: number) => void;
  onDoor?: (x: number, y: number) => void;
  onPick?: (x: number, y: number) => void;
}) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [view, setView] = useState<View>(FIT);
  const [hover, setHover] = useState<XY | null>(null);
  const [drag, setDrag] = useState<{ from: XY; to: XY } | null>(null);
  const [painting, setPainting] = useState(false);
  const image = useImage(backdrop?.path ?? "");
  const overlay = useImage(overlayPath ?? "");

  // Everything the pointer handlers need between events, none of which
  // should cause a render on its own.
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const pinchRef = useRef<{ dist: number; mid: { x: number; y: number }; view: View } | null>(null);
  const panRef = useRef<{ x: number; y: number; view: View } | null>(null);
  const paintingRef = useRef<{ last: XY } | null>(null);
  const anchorRef = useRef<XY | null>(null);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) {
      return;
    }
    const tile = Math.max(4, Math.floor(canvas.width / width));
    canvas.height = tile * height;
    context.clearRect(0, 0, canvas.width, canvas.height);
    drawGround(context, { terrain, width, height, tile, backdrop, image: image?.element ?? null });
    drawLights(context, lights ?? [], tile);
    drawScene(context, { labels, props, doors, zones, overlay }, { width, height, tile, backdrop });
    drawGrid(context, width, height, tile);
    drawToolPreview(context, { tool, hover, drag, painting, terrain, width, height, tile });
  }, [terrain, width, height, backdrop, image, lights, labels, props, doors, zones, overlay, tool, hover, drag, painting]);

  // The observer subscribes once; the draw it calls is whichever is current.
  // Keeping the two apart means a hover does not re-subscribe to resizes.
  const drawRef = useRef(draw);
  useEffect(() => {
    drawRef.current = draw;
    draw();
  }, [draw]);
  useEffect(() => {
    const wrapper = wrapperRef.current;
    const canvas = canvasRef.current;
    if (!wrapper || !canvas) {
      return;
    }
    const resize = () => {
      canvas.width = Math.max(1, wrapper.clientWidth);
      drawRef.current();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(wrapper);
    return () => observer.disconnect();
  }, []);

  // A new map starts at fit-to-width; a map that changed size under the
  // view would otherwise be panned to a corner that no longer exists.
  // Adjusted during render rather than in an effect, so the first frame of
  // the new map is already at fit.
  const [sizedFor, setSizedFor] = useState({ width, height });
  if (sizedFor.width !== width || sizedFor.height !== height) {
    setSizedFor({ width, height });
    setView(FIT);
  }

  // The wrapper's layout box is the canvas at zoom 1: a CSS transform
  // changes nothing about layout, which is what makes the clamp simple.
  const setViewClamped = useCallback((next: View | ((current: View) => View)) => {
    const wrapper = wrapperRef.current;
    const w = wrapper?.clientWidth || 1;
    const h = wrapper?.clientHeight || 1;
    setView((current) => clampView(typeof next === "function" ? next(current) : next, w, h));
  }, []);

  // Zoom around a point on the wrapper, so the tile under the cursor stays
  // under the cursor.
  const zoomAt = useCallback(
    (factor: number, at: { x: number; y: number } | null) => {
      const wrapper = wrapperRef.current;
      const px = at?.x ?? (wrapper?.clientWidth ?? 0) / 2;
      const py = at?.y ?? (wrapper?.clientHeight ?? 0) / 2;
      setViewClamped((current) => {
        const zoom = Math.min(ZOOM.max, Math.max(ZOOM.min, current.zoom * factor));
        const ratio = zoom / current.zoom;
        return { zoom, x: px - (px - current.x) * ratio, y: py - (py - current.y) * ratio };
      });
    },
    [setViewClamped],
  );

  // React registers wheel listeners as passive, and a passive listener
  // cannot stop the page scrolling under the zoom; this one is not.
  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper || !zoomable) {
      return;
    }
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = wrapper.getBoundingClientRect();
      zoomAt(event.deltaY < 0 ? ZOOM.step : 1 / ZOOM.step, {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      });
    };
    wrapper.addEventListener("wheel", onWheel, { passive: false });
    return () => wrapper.removeEventListener("wheel", onWheel);
  }, [zoomable, zoomAt]);

  function tileAtPointer(clientX: number, clientY: number): XY | null {
    const canvas = canvasRef.current;
    if (!canvas) {
      return null;
    }
    // The bounding rect already includes the zoom transform.
    const rect = canvas.getBoundingClientRect();
    const tile = rect.width / width;
    const x = Math.floor((clientX - rect.left) / tile);
    const y = Math.floor((clientY - rect.top) / tile);
    return x >= 0 && y >= 0 && x < width && y < height ? { x, y } : null;
  }

  function wrapperPoint(clientX: number, clientY: number) {
    const rect = wrapperRef.current?.getBoundingClientRect();
    return { x: clientX - (rect?.left ?? 0), y: clientY - (rect?.top ?? 0) };
  }

  function endStroke() {
    if (paintingRef.current) {
      paintingRef.current = null;
      setPainting(false);
      onStrokeEnd?.();
    }
  }

  function endDrag(at: XY | null) {
    const from = anchorRef.current;
    anchorRef.current = null;
    setDrag(null);
    if (!from) {
      return;
    }
    if (tool?.kind === "zone") {
      onZone?.(from, at ?? from);
    } else {
      onShape?.(from, at ?? from);
    }
  }

  const interactive = Boolean(tool);
  const cursor = !tool ? "" : tool.kind === "pan" ? "cursor-grab" : tool.kind === "pick" ? "cursor-copy" : "cursor-crosshair";

  return (
    <div
      ref={wrapperRef}
      className={cn(
        "relative w-full overflow-hidden rounded-lg border border-stone-800 bg-stone-950 select-none",
        (interactive || zoomable) && "touch-none",
        cursor,
      )}
      onPointerDown={(event) => {
        const wrapper = wrapperRef.current;
        if (!wrapper) {
          return;
        }
        wrapper.setPointerCapture(event.pointerId);
        pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

        if (pointersRef.current.size === 2 && zoomable) {
          // Second finger down: whatever the first was doing becomes a pinch.
          endStroke();
          anchorRef.current = null;
          setDrag(null);
          panRef.current = null;
          const [a, b] = [...pointersRef.current.values()];
          const mid = wrapperPoint((a.x + b.x) / 2, (a.y + b.y) / 2);
          pinchRef.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), mid, view };
          return;
        }
        if (pointersRef.current.size > 1) {
          return;
        }

        const pan = event.button === 1 || !tool || tool.kind === "pan";
        if (pan) {
          if (zoomable) {
            panRef.current = { x: event.clientX, y: event.clientY, view };
          }
          return;
        }
        const at = tileAtPointer(event.clientX, event.clientY);
        if (!at) {
          return;
        }
        switch (tool.kind) {
          case "brush":
            paintingRef.current = { last: at };
            setPainting(true);
            onStroke?.(at.x, at.y);
            break;
          case "shape":
            if (tool.tool === "fill") {
              onShape?.(at, at);
            } else {
              anchorRef.current = at;
              setDrag({ from: at, to: at });
            }
            break;
          case "zone":
            anchorRef.current = at;
            setDrag({ from: at, to: at });
            break;
          case "stamp":
            onStamp?.(at.x, at.y);
            break;
          case "light":
            onLight?.(at.x, at.y);
            break;
          case "label":
            onLabel?.(at.x, at.y);
            break;
          case "prop":
            onProp?.(at.x, at.y);
            break;
          case "door":
            onDoor?.(at.x, at.y);
            break;
          case "pick":
            onPick?.(at.x, at.y);
            break;
        }
      }}
      onPointerMove={(event) => {
        const pointers = pointersRef.current;
        if (pointers.has(event.pointerId)) {
          pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
        }
        const pinch = pinchRef.current;
        if (pinch && pointers.size >= 2) {
          const [a, b] = [...pointers.values()];
          const dist = Math.hypot(a.x - b.x, a.y - b.y);
          const mid = wrapperPoint((a.x + b.x) / 2, (a.y + b.y) / 2);
          const ratio = dist / pinch.dist;
          const zoom = Math.min(ZOOM.max, Math.max(ZOOM.min, pinch.view.zoom * ratio));
          const scale = zoom / pinch.view.zoom;
          setViewClamped({
            zoom,
            x: pinch.mid.x - (pinch.mid.x - pinch.view.x) * scale + (mid.x - pinch.mid.x),
            y: pinch.mid.y - (pinch.mid.y - pinch.view.y) * scale + (mid.y - pinch.mid.y),
          });
          return;
        }
        const pan = panRef.current;
        if (pan) {
          setViewClamped({
            zoom: pan.view.zoom,
            x: pan.view.x + (event.clientX - pan.x),
            y: pan.view.y + (event.clientY - pan.y),
          });
          return;
        }
        const at = tileAtPointer(event.clientX, event.clientY);
        setHover(at);
        const stroke = paintingRef.current;
        if (stroke && at && (stroke.last.x !== at.x || stroke.last.y !== at.y)) {
          stroke.last = at;
          onStroke?.(at.x, at.y);
        }
        if (anchorRef.current && at) {
          setDrag({ from: anchorRef.current, to: at });
        }
      }}
      onPointerUp={(event) => {
        pointersRef.current.delete(event.pointerId);
        if (pointersRef.current.size < 2) {
          pinchRef.current = null;
        }
        panRef.current = null;
        endStroke();
        if (anchorRef.current) {
          endDrag(tileAtPointer(event.clientX, event.clientY));
        }
      }}
      onPointerCancel={(event) => {
        pointersRef.current.delete(event.pointerId);
        pinchRef.current = null;
        panRef.current = null;
        endStroke();
        anchorRef.current = null;
        setDrag(null);
      }}
      onPointerLeave={() => setHover(null)}
    >
      <canvas
        ref={canvasRef}
        className="block"
        style={{
          transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`,
          transformOrigin: "0 0",
        }}
      />
      {zoomable ? (
        <div className="absolute right-1.5 top-1.5 flex flex-col gap-1">
          <ZoomButton label="Zoom in" icon={Plus} onClick={() => zoomAt(ZOOM.step, null)} />
          <ZoomButton label="Zoom out" icon={Minus} onClick={() => zoomAt(1 / ZOOM.step, null)} />
          <ZoomButton label="Fit the whole map" icon={Maximize2} onClick={() => setView(FIT)} />
        </div>
      ) : null}
    </div>
  );
}
