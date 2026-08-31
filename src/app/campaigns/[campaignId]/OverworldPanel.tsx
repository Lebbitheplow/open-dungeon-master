"use client";

import { Brush, Loader2, MapPin, Move, RefreshCw, Users, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { skinForGenre, type OverworldTile } from "@/lib/overworld/logic";
import {
  MAX_BRUSH_RADIUS,
  OVERWORLD_BRUSHES,
  OVERWORLD_BRUSH_LABELS,
  OVERWORLD_BRUSH_TILES,
  type OverworldBrush,
} from "@/lib/overworld/paint";
import { OverworldAuthoring } from "@/app/campaigns/[campaignId]/OverworldAuthoring";
import {
  drawOverworld,
  OVERWORLD_TILE as TILE,
  type OverworldData,
} from "@/app/campaigns/[campaignId]/overworldDraw";

// The overworld region map: seeded terrain canvas, known locations as
// anchors with routes from the connections graph, a pulsing party marker,
// and lead-placed pins. Pan with drag, zoom with the wheel.
//
// Whoever steers the story also authors it: pins, the party marker, dragging
// a place to where it belongs, renaming it, and the dials the terrain is
// rolled under (OverworldAuthoring). Everything else is read-only.

// What a click on the canvas means right now.
type Mode = "look" | "pin" | "party" | "place" | "paint";

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
  const [view, setView] = useState({ x: 0, y: 0, zoom: 1 });
  const [mode, setMode] = useState<Mode>("look");
  const [brush, setBrush] = useState<OverworldBrush>("plains");
  const [brushRadius, setBrushRadius] = useState(1);
  // Named after the paint, not after the failure: these are places the DM
  // just put under water or under a peak. The server reports them and moves
  // nothing, because a lighthouse on a reef is a decision.
  const [stranded, setStranded] = useState<Array<{ id: string; name: string }>>([]);
  const [held, setHeld] = useState<string | null>(null);
  const [regenBusy, setRegenBusy] = useState(false);
  const dragRef = useRef<{ x: number; y: number; startX: number; startY: number } | null>(null);
  // Active pointers by id, for two-finger pinch zoom on touch screens.
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const pinchRef = useRef<{ dist: number; mid: { x: number; y: number } } | null>(null);
  const pulseRef = useRef(0);

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
    });
    context.restore();
  }, [data, genre, held, view]);

  useEffect(() => {
    draw();
    const interval = setInterval(() => {
      pulseRef.current += 1;
      draw();
    }, 90);
    return () => clearInterval(interval);
  }, [draw]);

  // Size the canvas to its container and center the map on first data.
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas || !data) {
      return;
    }
    const resize = () => {
      canvas.width = container.clientWidth;
      canvas.height = Math.max(320, Math.round(container.clientWidth * 0.72));
      setView((current) => {
        if (current.x || current.y) {
          return current;
        }
        const mapWidth = data.map.width * TILE;
        const mapHeight = data.map.height * TILE;
        const zoom = Math.min(canvas.width / mapWidth, canvas.height / mapHeight);
        return {
          zoom,
          x: (canvas.width - mapWidth * zoom) / 2,
          y: (canvas.height - mapHeight * zoom) / 2,
        };
      });
      draw();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    return () => observer.disconnect();
  }, [data, draw]);

  // Wheel zoom needs a native non-passive listener: React's onWheel is
  // passive, so it cannot preventDefault and the whole side panel scrolls
  // under the cursor. Attached once the canvas exists.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const pointX = event.clientX - rect.left;
      const pointY = event.clientY - rect.top;
      setView((current) => {
        const zoom = Math.min(4, Math.max(0.4, current.zoom * (event.deltaY < 0 ? 1.15 : 0.87)));
        const scale = zoom / current.zoom;
        return {
          zoom,
          x: pointX - (pointX - current.x) * scale,
          y: pointY - (pointY - current.y) * scale,
        };
      });
    };
    canvas.addEventListener("wheel", handleWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", handleWheel);
  }, [loading]);

  // Returns the payload as well as storing it, because a paint answers with
  // more than the new map: it names the places it left in the sea.
  async function patch(body: Record<string, unknown>) {
    const response = await fetch(`/api/campaigns/${campaignId}/overworld`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      return null;
    }
    const payload = await response.json();
    setData(payload);
    return payload;
  }

  // Canvas pixels to map tiles, or null outside the grid.
  function tileAt(clientX: number, clientY: number) {
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
  function locationAt(at: { x: number; y: number }) {
    return (
      data?.locations.find(
        (location) =>
          location.anchor &&
          Math.abs(location.anchor.x - at.x) <= 1 &&
          Math.abs(location.anchor.y - at.y) <= 1,
      ) ?? null
    );
  }

  async function handleClick(clientX: number, clientY: number) {
    const at = tileAt(clientX, clientY);
    if (!at || !data) {
      return;
    }
    if (mode === "pin") {
      const label = window.prompt("Pin label (empty for a plain marker):") ?? "";
      await patch({ pins: [...data.map.pins, { id: "", x: at.x, y: at.y, label: label.slice(0, 60) }] });
      setMode("look");
      return;
    }
    if (mode === "party") {
      await patch({ partyXy: at });
      setMode("look");
      return;
    }
    if (mode === "paint") {
      // One tile per click. Dragging a brush across a canvas is a bigger
      // interaction than this panel has, and a click already reaches every
      // tile; the radius is what makes it practical on a 96x72 grid.
      const payload = await patch({
        strokes: [{ x: at.x, y: at.y, brush, radius: brushRadius }],
      });
      setStranded(
        (payload as { stranded?: Array<{ id: string; name: string }> } | null)?.stranded ?? [],
      );
      return;
    }
    if (mode === "place") {
      // First click picks a marker up, second puts it down.
      if (held) {
        await patch({ anchor: { locationId: held, x: at.x, y: at.y } });
        setHeld(null);
        return;
      }
      setHeld(locationAt(at)?.id ?? null);
    }
  }

  async function renameHeld() {
    const location = data?.locations.find((entry) => entry.id === held);
    if (!location) {
      return;
    }
    const name = window.prompt("What is this place called?", location.name);
    if (!name?.trim()) {
      return;
    }
    await patch({ rename: { locationId: location.id, name: name.trim() } });
    setHeld(null);
  }

  async function regenerate() {
    setRegenBusy(true);
    try {
      await patch({ regenerate: true });
    } finally {
      setRegenBusy(false);
    }
  }

  const skin = data ? skinForGenre(genre) : null;
  const heldName = data?.locations.find((entry) => entry.id === held)?.name ?? "";

  return (
    <div className="space-y-2">
      <div ref={containerRef} className="relative overflow-hidden rounded-lg border border-stone-800">
        {loading ? (
          <p className="flex items-center gap-1 p-6 text-[11px] text-stone-500">
            <Loader2 className="size-3 animate-spin" /> Charting the region...
          </p>
        ) : (
          <canvas
            ref={canvasRef}
            className={cn(
              "block w-full touch-none",
              mode === "look" ? "cursor-grab" : "cursor-crosshair",
            )}
            onPointerDown={(event) => {
              if (mode !== "look") {
                void handleClick(event.clientX, event.clientY);
                return;
              }
              pointersRef.current.set(event.pointerId, {
                x: event.clientX,
                y: event.clientY,
              });
              (event.target as HTMLElement).setPointerCapture(event.pointerId);
              if (pointersRef.current.size === 2) {
                // Second finger down: the drag becomes a pinch.
                dragRef.current = null;
                const [a, b] = [...pointersRef.current.values()];
                pinchRef.current = {
                  dist: Math.hypot(a.x - b.x, a.y - b.y),
                  mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
                };
              } else if (pointersRef.current.size === 1) {
                dragRef.current = {
                  x: view.x,
                  y: view.y,
                  startX: event.clientX,
                  startY: event.clientY,
                };
              }
            }}
            onPointerMove={(event) => {
              if (!pointersRef.current.has(event.pointerId)) {
                return;
              }
              pointersRef.current.set(event.pointerId, {
                x: event.clientX,
                y: event.clientY,
              });
              const pinch = pinchRef.current;
              if (pinch && pointersRef.current.size >= 2) {
                const [a, b] = [...pointersRef.current.values()];
                const dist = Math.hypot(a.x - b.x, a.y - b.y);
                const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
                const canvas = canvasRef.current;
                if (!canvas || dist < 1) {
                  return;
                }
                const rect = canvas.getBoundingClientRect();
                const midX = mid.x - rect.left;
                const midY = mid.y - rect.top;
                const ratio = dist / pinch.dist;
                setView((current) => {
                  const zoom = Math.min(4, Math.max(0.4, current.zoom * ratio));
                  const scale = zoom / current.zoom;
                  // Zoom around the midpoint, then follow its movement.
                  return {
                    zoom,
                    x: midX - (midX - current.x) * scale + (mid.x - pinch.mid.x),
                    y: midY - (midY - current.y) * scale + (mid.y - pinch.mid.y),
                  };
                });
                pinchRef.current = { dist, mid };
                return;
              }
              const drag = dragRef.current;
              if (drag) {
                setView((current) => ({
                  ...current,
                  x: drag.x + event.clientX - drag.startX,
                  y: drag.y + event.clientY - drag.startY,
                }));
              }
            }}
            onPointerUp={(event) => {
              pointersRef.current.delete(event.pointerId);
              if (pointersRef.current.size < 2) {
                pinchRef.current = null;
              }
              dragRef.current = null;
            }}
            onPointerCancel={(event) => {
              pointersRef.current.delete(event.pointerId);
              if (pointersRef.current.size < 2) {
                pinchRef.current = null;
              }
              dragRef.current = null;
            }}
          />
        )}
      </div>
      {skin ? (
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {(Object.keys(skin) as OverworldTile[]).map((tile) => (
            <span key={tile} className="flex items-center gap-1 text-[10px] text-stone-500">
              <span
                className="inline-block size-2.5 rounded-sm"
                style={{ backgroundColor: skin[tile].fill }}
              />
              {skin[tile].label}
            </span>
          ))}
        </div>
      ) : null}
      {steersStory && data ? (
        <>
          <div className="flex flex-wrap items-center gap-1.5">
            {([
              ["pin", "Add pin", MapPin],
              ["party", "Place the party", Users],
              ["place", "Move a place", Move],
              ["paint", "Paint terrain", Brush],
            ] as const).map(([value, label, Icon]) => (
              <button
                key={value}
                type="button"
                onClick={() => {
                  setMode((current) => (current === value ? "look" : value));
                  setHeld(null);
                  setStranded([]);
                }}
                className={cn(
                  "flex items-center gap-1 rounded border px-2 py-0.5 text-[11px]",
                  mode === value
                    ? "border-amber-700 bg-amber-950/50 text-amber-200"
                    : "border-stone-700 text-stone-400 hover:bg-stone-900",
                )}
              >
                <Icon className="size-3" /> {mode === value ? "Click the map..." : label}
              </button>
            ))}
            {data.map.partyXy ? (
              <button
                type="button"
                onClick={() => void patch({ partyXy: null })}
                className="rounded border border-stone-700 px-2 py-0.5 text-[11px] text-stone-400 hover:bg-stone-900"
              >
                Party is in transit
              </button>
            ) : null}
            {data.map.pins.length ? (
              <button
                type="button"
                onClick={() => void patch({ pins: [] })}
                className="flex items-center gap-1 rounded border border-stone-700 px-2 py-0.5 text-[11px] text-stone-400 hover:bg-stone-900"
              >
                <X className="size-3" /> Clear pins
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => void regenerate()}
              disabled={regenBusy}
              title="Reroll the terrain. Locations keep their spots where the new ground allows."
              className="flex items-center gap-1 rounded border border-stone-700 px-2 py-0.5 text-[11px] text-stone-400 hover:bg-stone-900 disabled:opacity-50"
            >
              {regenBusy ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <RefreshCw className="size-3" />
              )}
              Regenerate
            </button>
          </div>
          {held ? (
            <p className="flex items-center gap-2 text-[11px] text-amber-200">
              Holding {heldName}. Click where it belongs.
              <button
                type="button"
                onClick={() => void renameHeld()}
                className="rounded border border-stone-700 px-1.5 py-0.5 text-stone-400 hover:bg-stone-900"
              >
                Rename it
              </button>
            </p>
          ) : null}
          {mode === "paint" && skin ? (
            <div className="space-y-1.5 rounded border border-stone-800 bg-stone-950/50 p-2">
              <div className="flex flex-wrap items-center gap-1">
                {OVERWORLD_BRUSHES.map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setBrush(value)}
                    className={cn(
                      "flex items-center gap-1 rounded border px-2 py-0.5 text-[11px]",
                      brush === value
                        ? "border-amber-700 bg-amber-950/50 text-amber-200"
                        : "border-stone-700 text-stone-400 hover:bg-stone-900",
                    )}
                  >
                    <span
                      className="size-2.5 rounded-sm"
                      style={{ backgroundColor: skin[OVERWORLD_BRUSH_TILES[value]].fill }}
                    />
                    {OVERWORLD_BRUSH_LABELS[value]}
                  </button>
                ))}
              </div>
              <label className="flex items-center gap-2 text-[11px] text-stone-400">
                Brush size
                <input
                  type="range"
                  min={0}
                  max={MAX_BRUSH_RADIUS}
                  value={brushRadius}
                  onChange={(event) => setBrushRadius(Number(event.target.value))}
                  className="w-28 accent-amber-400"
                />
                <span className="text-stone-500">
                  {brushRadius === 0 ? "one tile" : `${brushRadius * 2 + 1} across`}
                </span>
              </label>
              {stranded.length ? (
                <p className="text-[11px] text-amber-300/90">
                  {stranded.map((place) => place.name).filter(Boolean).join(", ")}{" "}
                  {stranded.length === 1 ? "is" : "are"} now standing in sea or on a peak. The
                  marker stays where you put it; move it with Move a place if that was not the
                  idea.
                </p>
              ) : null}
            </div>
          ) : null}
          <OverworldAuthoring campaignId={campaignId} data={data} onData={setData} />
        </>
      ) : null}
      <p className="text-[10px] text-stone-600">
        Drag to pan, scroll or pinch to zoom. Locations appear as the party discovers them.
      </p>
    </div>
  );
}
