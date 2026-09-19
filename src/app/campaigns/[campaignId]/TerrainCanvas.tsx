"use client";

import { useCallback, useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { Maximize2, Minus, Plus } from "lucide-react";
import { cn } from "@/lib/cn";
import { backdropRect, type Backdrop, type BackdropTransform } from "@/lib/battlemap/backdrop";
import type { Brush as BrushName } from "@/lib/battlemap/paint";
import type { Stamp } from "@/lib/battlemap/stamp";
import type { ShapeTool } from "@/lib/battlemap/tools";
import type { DoorStates, LightZone, MapLabel, MapProp, ZoneKind } from "@/lib/battlemap/scene";
import type { AmbientLight, MapLight, XY } from "@/lib/battlemap/types";
import {
  drawBackdropHandles,
  drawBorderGuard,
  drawGrid,
  drawGround,
  drawPaintedGround,
  drawSelection,
  drawPlaced,
  drawToolPreview,
  type Births,
  type HiddenLayers,
} from "@/app/campaigns/[campaignId]/terrainDraw";
import type { PaintedGround } from "@/app/campaigns/[campaignId]/useMapPaint";
import {
  FIT,
  ZOOM,
  SelectionAnts,
  ZoomButton,
  calmMotion,
  clampView,
  flashTiles,
  useImage,
  type View,
} from "@/app/campaigns/[campaignId]/terrainCanvasParts";

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
  | { kind: "zone"; ambient: AmbientLight; zoneKind?: ZoneKind }
  | { kind: "select" }
  | { kind: "backdrop" }
  | { kind: "pick" }
  | { kind: "pan" };

// What the editor's top bar drives: the same three moves the corner buttons make.
export type CanvasControls = { zoomIn: () => void; zoomOut: () => void; fit: () => void };

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
  onSelect,
  selected,
  refused,
  onBackdrop,
  ground = null,
  hidden,
  showGrid = true,
  dmView = true,
  guard = false,
  contain = false,
  onHover,
  onZoom,
  controls,
  className,
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
  // The select tool: a tap reports the tile; the parent decides what stood
  // there. `selected` is outlined in gold (the selection model, 10.1).
  onSelect?: (x: number, y: number, shift: boolean) => void;
  selected?: Array<{ x0: number; y0: number; x1: number; y1: number }>;
  // The id of the latest refusal. When it changes, the tile last acted on
  // flashes ember: the map said no, and this is where.
  refused?: number;
  // The backdrop tool: two corner handles set the picture's register by
  // hand (section 3.7); the sliders stay for fine work.
  onBackdrop?: (transform: BackdropTransform) => void;
  // The renderer's picture of this terrain, drawn as the ground beneath every
  // overlay; absent, the flat fills stand in (no painted sets, or "Flat").
  ground?: PaintedGround | null;
  // Layers the eye toggles have hidden.
  hidden?: HiddenLayers;
  showGrid?: boolean;
  // Off shows the map as a player would find it: no DM-only labels, no door
  // states, no overlay.
  dmView?: boolean;
  // The dashed line inside the border the painter never opens.
  guard?: boolean;
  // Fit inside the parent's height as well as its width (the editor's fixed
  // canvas column); without it the canvas is as tall as its width makes it.
  contain?: boolean;
  // The tile under the pointer, reported only when it changes.
  onHover?: (at: XY | null) => void;
  onZoom?: (zoom: number) => void;
  controls?: Ref<CanvasControls>;
  className?: string;
}) {
  const outerRef = useRef<HTMLDivElement>(null);
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
  // Motion over the canvas: the flashes' layer, the tile last acted on, and
  // which placed things are new enough to still be popping in.
  const fxRef = useRef<HTMLDivElement>(null);
  const flashRef = useRef<HTMLDivElement>(null);
  const lastActRef = useRef<XY | null>(null);
  const birthsRef = useRef<Births>({ known: new Set(), born: new Map() });
  const popFrameRef = useRef(0);
  const drawRef = useRef<() => void>(() => {});

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) {
      return;
    }
    const tile = Math.max(4, Math.floor(canvas.width / width));
    canvas.height = tile * height;
    context.clearRect(0, 0, canvas.width, canvas.height);
    const shows = (layer: keyof HiddenLayers) => !hidden?.[layer];
    const art = shows("backdrop") ? backdrop : null;
    const picture = art ? (image?.element ?? null) : null;
    // A map with its own picture keeps it, as the play board does; the
    // renderer paints the rest.
    const painted = ground && !picture && shows("terrain") && ground.terrain.length === terrain.length ? ground : null;
    if (painted) {
      drawPaintedGround(context, { terrain, width, height, tile, picture: painted.canvas, paintedFrom: painted.terrain });
    } else {
      drawGround(context, { terrain, width, height, tile, backdrop: art, image: picture, showTerrain: shows("terrain") });
    }
    const fx = fxRef.current;
    if (fx) {
      // The overlay is exactly the drawn map, so its children place in percent.
      fx.style.width = `${tile * width}px`;
      fx.style.height = `${tile * height}px`;
    }
    // A thing placed since the last draw pops in. Thumbnails hold no tool and
    // never pop, so a gallery of them is not a gallery of animation loops.
    const popping = drawPlaced(context, birthsRef.current, {
      lights: shows("lights") ? (lights ?? []) : [],
      labels: shows("labels") ? ((dmView ? labels : labels?.filter((label) => !label.dmOnly)) ?? []) : [],
      props: shows("props") ? (props ?? []) : [],
      zones: shows("zones") ? (zones ?? []) : [],
      doors: shows("doors") && dmView ? doors : {},
      overlay: shows("overlay") && dmView ? overlay : null,
      input: { width, height, tile, backdrop, stamped: painted?.stamped },
      still: !tool || calmMotion(),
    });
    canvas.dataset.popping = popping ? "true" : "false";
    cancelAnimationFrame(popFrameRef.current);
    if (popping) {
      popFrameRef.current = requestAnimationFrame(() => drawRef.current());
    }
    if (tool?.kind === "backdrop" && backdrop) {
      drawBackdropHandles(context, backdropRect(backdrop.transform, width, height, tile), width);
    }
    drawSelection(context, selected ?? [], tile);
    if (showGrid) {
      drawGrid(context, width, height, tile);
    }
    if (guard) {
      drawBorderGuard(context, width, height, tile);
    }
    drawToolPreview(context, { tool, hover, drag, painting, terrain, width, height, tile });
  }, [terrain, width, height, backdrop, image, lights, labels, props, doors, zones, overlay, tool, hover, drag, painting, selected, ground, hidden, showGrid, dmView, guard]);

  // The observer subscribes once; the draw it calls is whichever is current.
  // Keeping the two apart means a hover does not re-subscribe to resizes.
  useEffect(() => {
    drawRef.current = draw;
    draw();
  }, [draw]);
  useEffect(() => () => cancelAnimationFrame(popFrameRef.current), []);

  // The map said no: the tile that was asked for flashes ember.
  useEffect(() => {
    if (refused && lastActRef.current) {
      flashTiles(flashRef.current, lastActRef.current, 0, { width, height }, "refused");
    }
    // Only a new refusal flashes; a resized map does not repeat the last one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refused]);

  // Every tap and every tile of a stroke answers where it landed. With the
  // guard up, the border is the one place the painter never opens.
  function answer(at: XY, reach = 0) {
    lastActRef.current = at;
    const onBorder = at.x === 0 || at.y === 0 || at.x === width - 1 || at.y === height - 1;
    const paints = tool?.kind === "brush" || tool?.kind === "shape" || tool?.kind === "stamp";
    flashTiles(flashRef.current, at, reach, { width, height }, guard && onBorder && paints && reach === 0 ? "refused" : "landed");
  }
  useEffect(() => {
    const outer = outerRef.current;
    const wrapper = wrapperRef.current;
    const canvas = canvasRef.current;
    if (!outer || !wrapper || !canvas) {
      return;
    }
    const resize = () => {
      // Contained, the stage is the largest box of the map's shape that fits
      // the parent both ways; its width is set here, outside React, because a
      // resize is not a render.
      const across = outer.clientWidth;
      const down = outer.clientHeight;
      const stage = contain && down > 0 ? Math.min(across, Math.floor((down * width) / height)) : across;
      wrapper.style.width = contain ? `${Math.max(1, stage)}px` : "";
      canvas.width = Math.max(1, stage);
      drawRef.current();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(outer);
    return () => observer.disconnect();
  }, [contain, width, height]);

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

  useEffect(() => {
    onZoom?.(view.zoom);
  }, [view.zoom, onZoom]);
  useImperativeHandle(
    controls,
    () => ({
      zoomIn: () => zoomAt(ZOOM.step, null),
      zoomOut: () => zoomAt(1 / ZOOM.step, null),
      fit: () => setView(FIT),
    }),
    [zoomAt],
  );

  // The parent hears about the pointer only when it crosses into another tile.
  const hoverKey = hover ? `${hover.x},${hover.y}` : "";
  useEffect(() => {
    if (!onHover) {
      return;
    }
    const [x, y] = hoverKey.split(",").map(Number);
    onHover(hoverKey ? { x, y } : null);
  }, [hoverKey, onHover]);

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

  // A corner of the backdrop being dragged (the backdrop tool).
  const backdropDragRef = useRef<{
    corner: "tl" | "br";
    transform: BackdropTransform;
    tile: number;
    px: number;
    py: number;
    rect: { x: number; y: number; width: number; height: number };
  } | null>(null);

  function endStroke() {
    backdropDragRef.current = null;
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
  const cursor = !tool ? "" : tool.kind === "pan" ? "cursor-grab" : tool.kind === "pick" ? "cursor-copy" : tool.kind === "select" ? "cursor-pointer" : tool.kind === "backdrop" ? "cursor-move" : "cursor-crosshair";

  return (
    <div ref={outerRef} className={cn("relative w-full", contain && "flex h-full min-h-0 items-center justify-center", className)}>
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
        if (tool.kind === "backdrop" && backdrop) {
          // A press near a corner handle grips it; anywhere else does nothing.
          const canvas = canvasRef.current;
          if (!canvas) {
            return;
          }
          const bounds = canvas.getBoundingClientRect();
          const tile = bounds.width / width;
          const rect = backdropRect(backdrop.transform, width, height, tile);
          const px = event.clientX - bounds.left;
          const py = event.clientY - bounds.top;
          const near = (cx: number, cy: number) => Math.hypot(px - cx, py - cy) < 14;
          const corner = near(rect.x, rect.y) ? "tl" : near(rect.x + rect.width, rect.y + rect.height) ? "br" : null;
          if (corner) {
            backdropDragRef.current = { corner, transform: backdrop.transform, tile, px, py, rect };
          }
          return;
        }
        const at = tileAtPointer(event.clientX, event.clientY);
        if (!at) {
          return;
        }
        if (tool.kind !== "select" && tool.kind !== "zone" && !(tool.kind === "shape" && tool.tool !== "fill")) {
          answer(at, tool.kind === "brush" ? tool.radius : 0);
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
          case "select":
            onSelect?.(at.x, at.y, event.shiftKey);
            break;
        }
      }}
      onPointerMove={(event) => {
        const pointers = pointersRef.current;
        if (pointers.has(event.pointerId)) {
          pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
        }
        const grip = backdropDragRef.current;
        if (grip) {
          const canvas = canvasRef.current;
          if (!canvas) {
            return;
          }
          const bounds = canvas.getBoundingClientRect();
          const px = event.clientX - bounds.left;
          const py = event.clientY - bounds.top;
          const dx = (px - grip.px) / grip.tile;
          const dy = (py - grip.py) / grip.tile;
          if (grip.corner === "tl") {
            // Sliding the top-left corner moves the picture.
            onBackdrop?.({
              ...grip.transform,
              offsetX: Math.round((grip.transform.offsetX + dx) * 4) / 4,
              offsetY: Math.round((grip.transform.offsetY + dy) * 4) / 4,
            });
          } else {
            // Dragging the bottom-right corner scales it about the top-left.
            const scale = Math.max(0.2, Math.min(5, (grip.rect.width + (px - grip.px)) / (width * grip.tile)));
            const grow = scale / grip.transform.scale;
            const centreShift = ((grow - 1) * width) / 2;
            onBackdrop?.({
              ...grip.transform,
              scale: Math.round(scale * 100) / 100,
              offsetX: Math.round((grip.transform.offsetX + centreShift) * 4) / 4,
              offsetY: Math.round((grip.transform.offsetY + ((grow - 1) * height) / 2) * 4) / 4,
            });
          }
          return;
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
          answer(at, tool?.kind === "brush" ? tool.radius : 0);
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
      <div
        ref={fxRef}
        aria-hidden="true"
        className="pointer-events-none absolute left-0 top-0"
        style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`, transformOrigin: "0 0" }}
      >
        <SelectionAnts boxes={selected ?? []} width={width} height={height} />
        <div ref={flashRef} className="absolute inset-0" />
      </div>
      {zoomable ? (
        <div className="absolute right-1.5 top-1.5 flex flex-col gap-1">
          <ZoomButton label="Zoom in" icon={Plus} onClick={() => zoomAt(ZOOM.step, null)} />
          <ZoomButton label="Zoom out" icon={Minus} onClick={() => zoomAt(1 / ZOOM.step, null)} />
          <ZoomButton label="Fit the whole map" icon={Maximize2} onClick={() => setView(FIT)} />
        </div>
      ) : null}
    </div>
    </div>
  );
}
