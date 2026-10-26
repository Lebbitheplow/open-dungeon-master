"use client";

import { Loader2, Minus, Plus } from "lucide-react";
import { useUndoRing } from "@/lib/use-undo-ring";
import { terrainDiffStrokes } from "@/lib/overworld/undo";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { SectionHead } from "@/components/ui/SectionHead";
import { KitButton, PanelError } from "./PanelKit";
import { skinForGenre, type XY } from "@/lib/overworld/logic";
import { MAX_STROKES, type OverworldBrush } from "@/lib/overworld/paint";
import {
  featureAt,
  type LabelSize,
  type OverworldSize,
  type PathKind,
} from "@/lib/overworld/features";
import { PromptDialog } from "@/components/ui/PromptDialog";
import { OverworldAuthoring } from "@/app/campaigns/[campaignId]/OverworldAuthoring";
import {
  askCopy,
  FileTools,
  importAzgaarFiles,
  LabelTools,
  LineTools,
  ModeBar,
  PaintTools,
  TileLegend,
  type OverworldAsk,
  type OverworldMode,
} from "@/app/campaigns/[campaignId]/OverworldTools";
import {
  drawOverworld,
  saveOverworldPng,
  OVERWORLD_TILE as TILE,
  type OverworldData,
} from "@/app/campaigns/[campaignId]/overworldDraw";
import { regionPlaceAt, regionPlaces } from "@/app/campaigns/[campaignId]/regionPlaces";
import { useOverworldView } from "@/app/campaigns/[campaignId]/useOverworldView";

// The overworld region map: seeded terrain canvas (or a picture in its
// place), known locations as anchors with routes from the connections
// graph, roads, rivers and borders, labels, a pulsing party marker, and
// lead-placed pins. Pan with drag, zoom with the wheel or a pinch.
//
// Whoever steers the story also authors it: pins, the party marker, dragging
// a place to where it belongs, renaming it, painting the ground, drawing
// lines and words over it, and the dials the terrain is rolled under
// (OverworldAuthoring). Everything else is read-only.
//
// Pointing at a dot, or tapping it, names it whatever else is in the way and
// says what is inside it (issue 548): a name with no room beside its dot
// waits for that, or for a zoom that spreads the dots apart.

type Stranded = Array<{ id: string; name: string }>;
// A place dragged here that took its bound Atlas pin along (WorldForge's
// Atlas, src/lib/db/atlas-region.ts followAnchor): the pins that moved, and
// where the place stood, so the move can be undone.
type PinsFollowed = { locationId: string; name: string; pins: string[]; before: XY | null };

// How close to a dot a pointer has to be to mean it, in CSS pixels: a mouse
// is precise, a finger is not.
const REACH = { mouse: 12, touch: 22 };

export function OverworldPanel({
  campaignId,
  genre,
  steersStory,
  visible = true,
  placesKey = "",
}: {
  campaignId: string;
  genre: string;
  steersStory: boolean;
  // On a phone the side panel stays mounted behind the chat; the pulse loop
  // rests while it is off screen and picks up again when it is shown.
  visible?: boolean;
  // Changes when the table's places do (an arrival, a rename, a part filed
  // under its place), so a map left open during play follows the story.
  placesKey?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [data, setData] = useState<OverworldData | null>(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<OverworldMode>("look");
  const [brush, setBrush] = useState<OverworldBrush>("plains");
  const [brushRadius, setBrushRadius] = useState(1);
  // Named after the paint, not after the failure: these are places the DM
  // just put under water or under a peak. The server reports them and moves
  // nothing, because a lighthouse on a reef is a decision.
  const [stranded, setStranded] = useState<Stranded>([]);
  const [held, setHeld] = useState<string | null>(null);
  const [asking, setAsking] = useState<OverworldAsk | null>(null);
  const [regenBusy, setRegenBusy] = useState(false);
  // A line being drawn: its kind, its points so far, and the name it will
  // carry when finished.
  const [pathKind, setPathKind] = useState<PathKind>("road");
  const [pending, setPending] = useState<XY[]>([]);
  const [pathLabel, setPathLabel] = useState("");
  const [labelSize, setLabelSize] = useState<LabelSize>("small");
  // The backdrop image, keyed by the path it was loaded from, so a picture
  // taken away or replaced never draws for a frame under the wrong path.
  const [backdrop, setBackdrop] = useState<{ path: string; image: HTMLImageElement } | null>(null);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importNote, setImportNote] = useState("");
  const [error, setError] = useState("");
  const [followed, setFollowed] = useState<PinsFollowed | null>(null);
  // The dot under a mouse, and the one last tapped or clicked.
  const [hovered, setHovered] = useState<string | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  // A press in look mode, to tell a tap from the start of a pan.
  const pressRef = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const pulseRef = useRef(0);
  const sizeRef = useRef("");
  // Device pixels per CSS pixel: the canvas is drawn at the screen's own
  // density so names stay crisp on a phone.
  const densityRef = useRef(1);
  const { view, fit, down, move, up, zoomBy } = useOverworldView(canvasRef, !loading);
  // A paint drag in flight: the tiles it has touched, sent as one request
  // on release (docs/vtt-parity-implementation-plan.md section 10.5).
  const strokeRef = useRef<{ tiles: Map<string, XY> } | null>(null);
  const [strokeCount, setStrokeCount] = useState(0);
  // Painted terrain before each paint, so undo can put it back as strokes.
  const paintUndo = useUndoRing<string>(`${campaignId}:overworld`, {
    hotkeys: mode === "paint",
    replace: async (previous) => {
      if (!data) {
        return null;
      }
      const strokes = terrainDiffStrokes(data.map.terrain, previous, data.map.width);
      if (!strokes.length) {
        return previous;
      }
      const payload = await patch({ strokes });
      return payload ? payload.map.terrain : null;
    },
  });

  // Loaded on open, and again whenever the table's places change under it;
  // a reload after the first keeps the map on screen rather than flashing
  // the skeleton. Every load and every save takes a number, and only the
  // newest one's answer is shown: a reload still in flight when a paint is
  // saved must not land after it with the ground as it was.
  const answerRef = useRef(0);
  useEffect(() => {
    let cancelled = false;
    const asked = ++answerRef.current;
    fetch(`/api/campaigns/${campaignId}/overworld`)
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => {
        if (!cancelled && payload && asked === answerRef.current) {
          setData(payload);
        }
      })
      .catch(() => {
        // transient; the next open retries
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [campaignId, placesKey]);

  const places = useMemo(() => (data ? regionPlaces(data.locations) : []), [data]);

  const backdropPath = data?.map.backdropPath ?? "";
  useEffect(() => {
    if (!backdropPath) {
      return;
    }
    let cancelled = false;
    const image = new Image();
    image.onload = () => {
      if (!cancelled) {
        setBackdrop({ path: backdropPath, image });
      }
    };
    image.src = backdropPath;
    return () => {
      cancelled = true;
    };
  }, [backdropPath]);
  const backdropImage = backdrop && backdrop.path === backdropPath ? backdrop.image : null;

  // Draw loop: static except the party-marker pulse, so a lightweight
  // interval redraw keeps it alive without a full animation frame chain.
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !data) {
      return;
    }
    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }
    const density = densityRef.current;
    context.save();
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.scale(density, density);
    context.translate(view.x, view.y);
    context.scale(view.zoom, view.zoom);
    const names = drawOverworld(context, data, {
      genre,
      pulse: pulseRef.current,
      selectedLocationId: held,
      backdrop: backdropImage,
      pending: pending.length ? { kind: pathKind, points: pending } : null,
      zoom: view.zoom,
      hoveredLocationId: hovered,
      focusedLocationId: focused,
      visible: {
        x: -view.x / view.zoom,
        y: -view.y / view.zoom,
        width: canvas.clientWidth / view.zoom,
        height: canvas.clientHeight / view.zoom,
      },
    });
    context.restore();
    // For the browser checks: how many places have their name on the map,
    // and the view, so a check can find a dot on screen.
    canvas.dataset.namesShown = String(names.shown.length);
    canvas.dataset.namesHidden = String(names.hidden.length);
    canvas.dataset.places = String(places.length);
    canvas.dataset.view = `${view.x},${view.y},${view.zoom}`;
  }, [backdropImage, data, focused, genre, held, hovered, pathKind, pending, places.length, view]);

  useEffect(() => {
    draw();
    if (!visible) {
      return;
    }
    // The pulse is a real animation, so it needs a loop while the map is on
    // screen; it pauses (rather than redrawing on change) while the panel is
    // hidden or the tab is in the background.
    let interval = 0;
    const start = () => {
      if (interval || document.hidden) {
        return;
      }
      interval = window.setInterval(() => {
        pulseRef.current += 1;
        draw();
      }, 90);
    };
    const stop = () => {
      window.clearInterval(interval);
      interval = 0;
    };
    const onVisibility = () => (document.hidden ? stop() : start());
    start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [draw, visible]);

  // The latest draw, for the resize below, which must not re-run (and
  // reallocate the canvas) every time a pan or a pointer changes the frame.
  const drawRef = useRef(draw);
  useEffect(() => {
    drawRef.current = draw;
  }, [draw]);

  // Size the canvas to its container; fit the map on first data and again
  // whenever the map changed size underneath the view.
  const mapWidth = data?.map.width ?? 0;
  const mapHeight = data?.map.height ?? 0;
  // Where the first view looks: the ground the places stand on, with room
  // round it (issue 548), since a new region's places sit in a corner of a
  // map that is mostly still unexplored. The whole map when there are none.
  const focus = useMemo(() => {
    if (!places.length || !mapWidth || !mapHeight) {
      return null;
    }
    const xs = places.map((place) => place.anchor.x);
    const ys = places.map((place) => place.anchor.y);
    const margin = 6;
    const width = Math.max(28, Math.max(...xs) - Math.min(...xs) + margin * 2);
    const height = Math.max(21, Math.max(...ys) - Math.min(...ys) + margin * 2);
    const centreX = (Math.max(...xs) + Math.min(...xs) + 1) / 2;
    const centreY = (Math.max(...ys) + Math.min(...ys) + 1) / 2;
    return {
      x: (centreX - width / 2) * TILE,
      y: (centreY - height / 2) * TILE,
      width: Math.min(width, mapWidth) * TILE,
      height: Math.min(height, mapHeight) * TILE,
    };
  }, [mapHeight, mapWidth, places]);

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas || !mapWidth || !mapHeight) {
      return;
    }
    const resize = () => {
      const width = container.clientWidth;
      const height = Math.max(320, Math.round(width * 0.72));
      const density = Math.min(3, Math.max(1, window.devicePixelRatio || 1));
      densityRef.current = density;
      canvas.style.height = `${height}px`;
      const deviceWidth = Math.round(width * density);
      const deviceHeight = Math.round(height * density);
      if (canvas.width !== deviceWidth || canvas.height !== deviceHeight) {
        canvas.width = deviceWidth;
        canvas.height = deviceHeight;
      }
      const key = `${mapWidth}x${mapHeight}`;
      const changed = sizeRef.current !== "" && sizeRef.current !== key;
      sizeRef.current = key;
      fit(canvas, mapWidth * TILE, mapHeight * TILE, changed, focus);
      drawRef.current();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    return () => observer.disconnect();
    // `loading` because the canvas only exists once it is over.
  }, [fit, focus, loading, mapHeight, mapWidth]);

  // Returns the payload as well as storing it, because a paint answers with
  // more than the new map: it names the places it left in the sea.
  async function patch(body: Record<string, unknown>) {
    setError("");
    const asked = ++answerRef.current;
    const response = await fetch(`/api/campaigns/${campaignId}/overworld`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      setError((payload as { error?: string }).error ?? "That did not work.");
      return null;
    }
    if (asked === answerRef.current) {
      setData(payload);
    }
    return payload as OverworldData & { stranded?: Stranded; atlas?: Array<{ pin: string; name: string }> };
  }

  // Canvas pixels to map tiles, or null outside the grid.
  function tileAt(clientX: number, clientY: number): XY | null {
    const canvas = canvasRef.current;
    if (!canvas || !data) {
      return null;
    }
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor((clientX - rect.left - view.x) / view.zoom / TILE);
    const y = Math.floor((clientY - rect.top - view.y) / view.zoom / TILE);
    return x >= 0 && y >= 0 && x < data.map.width && y < data.map.height ? { x, y } : null;
  }

  // The place whose dot is under the pointer, if any. Only places of their
  // own have dots: a part is reached through its place.
  function placeAt(clientX: number, clientY: number, pointerType = "mouse") {
    const canvas = canvasRef.current;
    if (!canvas) {
      return null;
    }
    const rect = canvas.getBoundingClientRect();
    const reach = pointerType === "mouse" ? REACH.mouse : REACH.touch;
    return regionPlaceAt(
      places,
      { x: (clientX - rect.left - view.x) / view.zoom, y: (clientY - rect.top - view.y) / view.zoom },
      reach / view.zoom,
    );
  }

  async function erase(at: XY) {
    if (!data) {
      return;
    }
    const hit = featureAt(data.map.paths, data.map.labels, at);
    if (hit && "label" in hit) {
      await patch({ labels: data.map.labels.filter((label) => label.id !== hit.label.id) });
      return;
    }
    if (hit && "path" in hit) {
      await patch({ paths: data.map.paths.filter((path) => path.id !== hit.path.id) });
      return;
    }
    const pin = data.map.pins.find(
      (entry) => Math.abs(entry.x - at.x) <= 1 && Math.abs(entry.y - at.y) <= 1,
    );
    if (pin) {
      await patch({ pins: data.map.pins.filter((entry) => entry.id !== pin.id) });
    }
  }

  async function handleClick(clientX: number, clientY: number, pointerType = "mouse") {
    const at = tileAt(clientX, clientY);
    if (!at || !data) {
      return;
    }
    switch (mode) {
      case "pin":
      case "label":
        // The words are asked for in the app's own dialog; the answer lands
        // in the PromptDialog below.
        setAsking({ kind: mode, at });
        return;
      case "party":
        await patch({ partyXy: at });
        setMode("look");
        return;
      case "paint":
        // A paint press starts a stroke; the tiles land on release.
        strokeRef.current = { tiles: new Map([[`${at.x},${at.y}`, at]]) };
        setStrokeCount(1);
        return;
      case "place":
        // First tap picks a marker up, second puts it down.
        if (held) {
          const place = data.locations.find((entry) => entry.id === held);
          const answer = await patch({ anchor: { locationId: held, x: at.x, y: at.y } });
          const pins = (answer?.atlas ?? []).map((move) => move.pin || move.name);
          setFollowed(pins.length ? { locationId: held, name: place?.name ?? "", pins, before: place?.anchor ?? null } : null);
          setHeld(null);
          return;
        }
        setHeld(placeAt(clientX, clientY, pointerType)?.id ?? null);
        return;
      case "line":
        setPending((current) => [...current, at]);
        return;
      case "erase":
        await erase(at);
        return;
      default:
        return;
    }
  }

  // The drag adds tiles under the pointer; nothing is sent until release.
  function paintMove(clientX: number, clientY: number) {
    const stroke = strokeRef.current;
    if (!stroke) {
      return;
    }
    const at = tileAt(clientX, clientY);
    if (!at) {
      return;
    }
    const key = `${at.x},${at.y}`;
    if (!stroke.tiles.has(key) && stroke.tiles.size < MAX_STROKES) {
      stroke.tiles.set(key, at);
      setStrokeCount(stroke.tiles.size);
    }
  }

  async function paintEnd() {
    const stroke = strokeRef.current;
    strokeRef.current = null;
    setStrokeCount(0);
    if (!stroke || !data) {
      return;
    }
    const before = data.map.terrain;
    const payload = await patch({
      strokes: [...stroke.tiles.values()].map((at) => ({ x: at.x, y: at.y, brush, radius: brushRadius })),
    });
    if (payload) {
      paintUndo.remember(before);
      setStranded(payload.stranded ?? []);
    }
  }

  async function finishPath() {
    if (!data || pending.length < 2) {
      return;
    }
    const saved = await patch({
      paths: [...data.map.paths, { kind: pathKind, points: pending, label: pathLabel.trim() }],
    });
    if (saved) {
      setPending([]);
      setPathLabel("");
    }
  }

  function changeMode(next: OverworldMode) {
    setMode(next);
    setHeld(null);
    setFocused(null);
    setStranded([]);
    setPending([]);
  }

  async function answer(value: string) {
    const ask = asking;
    setAsking(null);
    if (!ask || !data) {
      return;
    }
    if (ask.kind === "pin") {
      await patch({
        pins: [...data.map.pins, { id: "", x: ask.at.x, y: ask.at.y, label: value.slice(0, 60) }],
      });
      setMode("look");
      return;
    }
    if (ask.kind === "label") {
      if (value.trim()) {
        await patch({
          labels: [...data.map.labels, { x: ask.at.x, y: ask.at.y, text: value.trim(), size: labelSize }],
        });
      }
      return;
    }
    if (value.trim()) {
      await patch({ rename: { locationId: ask.locationId, name: value.trim() } });
      setHeld(null);
    }
  }

  async function regenerate() {
    setRegenBusy(true);
    try {
      await patch({ regenerate: true });
    } finally {
      setRegenBusy(false);
    }
  }

  async function exportPng() {
    if (!data) {
      return;
    }
    setExporting(true);
    try {
      const failure = await saveOverworldPng(data, { genre, backdrop: backdropImage });
      if (failure) {
        setError(failure);
      }
    } finally {
      setExporting(false);
    }
  }

  async function importAzgaar(files: string[], size: OverworldSize) {
    setImporting(true);
    setImportNote("");
    setError("");
    try {
      const result = await importAzgaarFiles<OverworldData>(campaignId, files, size);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      setData(result.data);
      setImportNote(result.note);
    } finally {
      setImporting(false);
    }
  }

  paintUndo.track(data?.map.terrain ?? "");
  const focusedPlace = places.find((place) => place.id === focused) ?? null;
  const skin = data ? skinForGenre(genre) : null;
  const heldName = data?.locations.find((entry) => entry.id === held)?.name ?? "";
  const ask = askCopy(asking, labelSize, heldName);

  return (
    <div className="space-y-2">
      <SectionHead title="The region" glyph="system-region" />
      <div
        ref={containerRef}
        className="panel relative overflow-hidden rounded-lg"
        data-tour="region-canvas"
      >
        {loading ? (
          <p role="status" className="skeleton-block reveal flex aspect-[4/3] items-center justify-center gap-1.5 text-xs text-stone-400">
            <Loader2 className="size-3.5 animate-spin" /> Charting the region...
          </p>
        ) : (
          <canvas
            ref={canvasRef}
            className={cn("block w-full touch-none", mode === "look" ? "cursor-grab" : "cursor-crosshair")}
            onPointerDown={(event) => {
              if (mode !== "look") {
                if (mode === "paint") {
                  (event.target as HTMLElement).setPointerCapture(event.pointerId);
                }
                void handleClick(event.clientX, event.clientY, event.pointerType);
                return;
              }
              pressRef.current = event.isPrimary ? { x: event.clientX, y: event.clientY, moved: false } : null;
              down(event);
            }}
            onPointerMove={(event) => {
              if (strokeRef.current) {
                paintMove(event.clientX, event.clientY);
                return;
              }
              const press = pressRef.current;
              if (press && Math.hypot(event.clientX - press.x, event.clientY - press.y) > 6) {
                press.moved = true;
              }
              // A mouse names the dot it rests on; a finger has no hover.
              if (event.pointerType === "mouse" && event.buttons === 0) {
                const id = placeAt(event.clientX, event.clientY)?.id ?? null;
                if (id !== hovered) {
                  setHovered(id);
                }
              }
              move(event);
            }}
            onPointerLeave={() => setHovered(null)}
            onPointerUp={(event) => {
              if (strokeRef.current) {
                void paintEnd();
                return;
              }
              // A press that did not pan is a tap: it names the dot under it,
              // or puts the name away on a tap at nothing.
              const press = pressRef.current;
              pressRef.current = null;
              if (mode === "look" && press && !press.moved) {
                setFocused(placeAt(event.clientX, event.clientY, event.pointerType)?.id ?? null);
              }
              up(event);
            }}
            onPointerCancel={(event) => {
              strokeRef.current = null;
              pressRef.current = null;
              setStrokeCount(0);
              up(event);
            }}
          />
        )}
        {focusedPlace && mode === "look" ? (
          <p
            key={focusedPlace.id}
            role="status"
            data-testid="region-place-caption"
            className="reveal pointer-events-none absolute left-2 top-2 max-w-[78%] rounded-md border border-amber-500/30 bg-stone-950/85 px-2 py-1 text-xs leading-5 text-stone-300"
          >
            <span className="font-semibold text-amber-200">{focusedPlace.name}</span>
            {" · "}
            {focusedPlace.isCurrent ? "the party is here" : focusedPlace.visited ? "visited" : "not reached yet"}
            {focusedPlace.parts.length ? (
              <span className="block text-stone-400">Inside: {focusedPlace.parts.join(", ")}</span>
            ) : null}
          </p>
        ) : null}
        {!loading ? (
          <div className="absolute bottom-2 right-2 flex flex-col gap-1">
            <KitButton tone="secondary" onClick={() => zoomBy(1.25)} aria-label="Zoom in" className="size-10 bg-stone-950/85 px-0">
              <Plus className="size-4" />
            </KitButton>
            <KitButton tone="secondary" onClick={() => zoomBy(0.8)} aria-label="Zoom out" className="size-10 bg-stone-950/85 px-0">
              <Minus className="size-4" />
            </KitButton>
          </div>
        ) : null}
        {strokeCount ? (
          <span key={strokeCount} className="count-pop pointer-events-none absolute left-2 top-2 rounded-md border border-amber-500/30 bg-stone-950/85 px-1.5 py-0.5 text-[11px] text-amber-200">
            {strokeCount} {strokeCount === 1 ? "tile" : "tiles"}
          </span>
        ) : null}
      </div>
      {skin && !backdropImage ? <TileLegend skin={skin} /> : null}
      {steersStory && data ? (
        <>
          <ModeBar
            mode={mode}
            onMode={changeMode}
            partyPlaced={Boolean(data.map.partyXy)}
            onPartyTransit={() => void patch({ partyXy: null })}
            pinsCount={data.map.pins.length}
            onClearPins={() => void patch({ pins: [] })}
            regenBusy={regenBusy}
            onRegenerate={() => void regenerate()}
          />
          {held ? (
            <p className="reveal flex flex-wrap items-center gap-2 text-xs text-amber-200">
              Holding {heldName}. Tap where it belongs.
              <KitButton onClick={() => setAsking({ kind: "rename", locationId: held })}>Rename it</KitButton>
            </p>
          ) : null}
          {followed ? (
            <p role="status" className="reveal flex flex-wrap items-center gap-2 text-xs text-emerald-200" data-testid="region-pin-followed">
              {followed.pins.length === 1 ? `${followed.name}'s pin on the Atlas moved with it.` : `${followed.pins.length} Atlas pins moved with ${followed.name}.`}
              {followed.before ? (
                <KitButton
                  onClick={() => {
                    // Back where it stood; the pin follows it back.
                    const back = followed;
                    setFollowed(null);
                    void patch({ anchor: { locationId: back.locationId, x: back.before!.x, y: back.before!.y } });
                  }}
                >
                  Undo
                </KitButton>
              ) : null}
              <KitButton onClick={() => setFollowed(null)}>Dismiss</KitButton>
            </p>
          ) : null}
          {mode === "paint" && skin ? (
            <PaintTools
              skin={skin}
              brush={brush}
              onBrush={setBrush}
              radius={brushRadius}
              onRadius={setBrushRadius}
              stranded={stranded}
              undo={{
                canUndo: paintUndo.canUndo,
                canRedo: paintUndo.canRedo,
                onUndo: () => void paintUndo.undo(data.map.terrain),
                onRedo: () => void paintUndo.redo(data.map.terrain),
              }}
            />
          ) : null}
          {mode === "line" ? (
            <LineTools
              kind={pathKind}
              onKind={setPathKind}
              pendingCount={pending.length}
              label={pathLabel}
              onLabel={setPathLabel}
              onFinish={() => void finishPath()}
              onUndo={() => setPending((current) => current.slice(0, -1))}
              onCancel={() => setPending([])}
            />
          ) : null}
          {mode === "label" ? <LabelTools size={labelSize} onSize={setLabelSize} /> : null}
          {mode === "erase" ? (
            <p className="reveal text-xs text-stone-500">Tap a line, a label or a pin to take it off the map.</p>
          ) : null}
          <FileTools
            backdropPath={data.map.backdropPath}
            onBackdrop={(path) => void patch({ backdropPath: path })}
            onExport={() => void exportPng()}
            exporting={exporting}
            onImport={(files, size) => void importAzgaar(files, size)}
            importing={importing}
            importNote={importNote}
            mapSize={{ width: data.map.width, height: data.map.height }}
          />
          {error ? <PanelError>{error}</PanelError> : null}
          <OverworldAuthoring campaignId={campaignId} data={data} onData={setData} />
        </>
      ) : null}
      <p className="text-[11px] text-stone-500">
        Drag to pan, scroll or pinch to zoom, tap a place to name it. Locations appear as the party discovers them.
      </p>
      <PromptDialog
        open={asking !== null}
        onOpenChange={(open) => {
          if (!open) {
            setAsking(null);
          }
        }}
        title={ask.title}
        label={ask.label}
        defaultValue={ask.defaultValue}
        maxLength={ask.maxLength}
        allowEmpty={ask.allowEmpty}
        submitLabel={ask.submitLabel}
        onSubmit={(value) => void answer(value)}
      />
    </div>
  );
}
