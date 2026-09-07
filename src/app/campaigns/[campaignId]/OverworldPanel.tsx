"use client";

import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { skinForGenre, type XY } from "@/lib/overworld/logic";
import type { OverworldBrush } from "@/lib/overworld/paint";
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

type Stranded = Array<{ id: string; name: string }>;

export function OverworldPanel({
  campaignId,
  genre,
  steersStory,
}: {
  campaignId: string;
  genre: string;
  steersStory: boolean;
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
  const pulseRef = useRef(0);
  const sizeRef = useRef("");
  const { view, fit, down, move, up } = useOverworldView(canvasRef, !loading);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/campaigns/${campaignId}/overworld`)
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => {
        if (!cancelled && payload) {
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
  }, [campaignId]);

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
    context.save();
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.translate(view.x, view.y);
    context.scale(view.zoom, view.zoom);
    drawOverworld(context, data, {
      genre,
      pulse: pulseRef.current,
      selectedLocationId: held,
      backdrop: backdropImage,
      pending: pending.length ? { kind: pathKind, points: pending } : null,
    });
    context.restore();
  }, [backdropImage, data, genre, held, pathKind, pending, view]);

  useEffect(() => {
    draw();
    const interval = setInterval(() => {
      pulseRef.current += 1;
      draw();
    }, 90);
    return () => clearInterval(interval);
  }, [draw]);

  // Size the canvas to its container; fit the map on first data and again
  // whenever the map changed size underneath the view.
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas || !data) {
      return;
    }
    const resize = () => {
      canvas.width = container.clientWidth;
      canvas.height = Math.max(320, Math.round(container.clientWidth * 0.72));
      const key = `${data.map.width}x${data.map.height}`;
      const changed = sizeRef.current !== "" && sizeRef.current !== key;
      sizeRef.current = key;
      fit(canvas, data.map.width * TILE, data.map.height * TILE, changed);
      draw();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    return () => observer.disconnect();
  }, [data, draw, fit]);

  // Returns the payload as well as storing it, because a paint answers with
  // more than the new map: it names the places it left in the sea.
  async function patch(body: Record<string, unknown>) {
    setError("");
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
    setData(payload);
    return payload as OverworldData & { stranded?: Stranded };
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

  // The place whose marker sits under this tile, if any.
  function locationAt(at: XY) {
    return (
      data?.locations.find(
        (location) =>
          location.anchor &&
          Math.abs(location.anchor.x - at.x) <= 1 &&
          Math.abs(location.anchor.y - at.y) <= 1,
      ) ?? null
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

  async function handleClick(clientX: number, clientY: number) {
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
      case "paint": {
        // One tile per tap. A tap already reaches every tile; the radius is
        // what makes it practical on a big grid.
        const payload = await patch({
          strokes: [{ x: at.x, y: at.y, brush, radius: brushRadius }],
        });
        setStranded(payload?.stranded ?? []);
        return;
      }
      case "place":
        // First tap picks a marker up, second puts it down.
        if (held) {
          await patch({ anchor: { locationId: held, x: at.x, y: at.y } });
          setHeld(null);
          return;
        }
        setHeld(locationAt(at)?.id ?? null);
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

  const skin = data ? skinForGenre(genre) : null;
  const heldName = data?.locations.find((entry) => entry.id === held)?.name ?? "";
  const ask = askCopy(asking, labelSize, heldName);

  return (
    <div className="space-y-2">
      <div
        ref={containerRef}
        className="relative overflow-hidden rounded-lg border border-stone-800"
        data-tour="region-canvas"
      >
        {loading ? (
          <p className="flex items-center gap-1 p-6 text-[11px] text-stone-500">
            <Loader2 className="size-3 animate-spin" /> Charting the region...
          </p>
        ) : (
          <canvas
            ref={canvasRef}
            className={cn("block w-full touch-none", mode === "look" ? "cursor-grab" : "cursor-crosshair")}
            onPointerDown={(event) => {
              if (mode !== "look") {
                void handleClick(event.clientX, event.clientY);
                return;
              }
              down(event);
            }}
            onPointerMove={move}
            onPointerUp={up}
            onPointerCancel={up}
          />
        )}
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
            <p className="flex items-center gap-2 text-[11px] text-amber-200">
              Holding {heldName}. Tap where it belongs.
              <button
                type="button"
                onClick={() => setAsking({ kind: "rename", locationId: held })}
                className="rounded border border-stone-700 px-1.5 py-0.5 text-stone-400 hover:bg-stone-900"
              >
                Rename it
              </button>
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
            <p className="text-[11px] text-stone-500">Tap a line, a label or a pin to take it off the map.</p>
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
          {error ? <p className="text-[11px] text-red-400">{error}</p> : null}
          <OverworldAuthoring campaignId={campaignId} data={data} onData={setData} />
        </>
      ) : null}
      <p className="text-[10px] text-stone-600">
        Drag to pan, scroll or pinch to zoom. Locations appear as the party discovers them.
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
