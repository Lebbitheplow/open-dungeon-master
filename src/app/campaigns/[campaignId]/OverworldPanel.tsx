"use client";

import { Loader2, MapPin, RefreshCw, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import {
  skinForGenre,
  tileJitter,
  type OverworldTile,
} from "@/lib/overworld/logic";

type OverworldData = {
  map: {
    seed: number;
    width: number;
    height: number;
    terrain: string;
    pins: Array<{ id: string; x: number; y: number; label: string }>;
  };
  locations: Array<{
    id: string;
    name: string;
    visited: boolean;
    isCurrent: boolean;
    connections: string[];
    anchor: { x: number; y: number } | null;
  }>;
};

const TILE = 16;

// Shades a hex fill by a small factor (deterministic per tile).
function shade(hex: string, factor: number): string {
  const value = parseInt(hex.slice(1), 16);
  const channel = (offset: number) => {
    const raw = (value >> offset) & 0xff;
    return Math.min(255, Math.max(0, Math.round(raw * (1 + factor))));
  };
  return `rgb(${channel(16)}, ${channel(8)}, ${channel(0)})`;
}

// The overworld region map: seeded terrain canvas, known locations as
// anchors with routes from the connections graph, a pulsing party marker,
// and lead-placed pins. Pan with drag, zoom with the wheel.
export function OverworldPanel({
  campaignId,
  genre,
  isLead,
}: {
  campaignId: string;
  genre: string;
  isLead: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [data, setData] = useState<OverworldData | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState({ x: 0, y: 0, zoom: 1 });
  const [pinMode, setPinMode] = useState(false);
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
    const skin = skinForGenre(genre);
    const { width, height, terrain } = data.map;
    context.save();
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.translate(view.x, view.y);
    context.scale(view.zoom, view.zoom);

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const tile = (terrain[y * width + x] ?? "w") as OverworldTile;
        context.fillStyle = shade(skin[tile].fill, tileJitter(x, y));
        context.fillRect(x * TILE, y * TILE, TILE, TILE);
      }
    }

    // Routes: curves between anchors of connected locations, drawn once per
    // pair.
    const anchorById = new Map(
      data.locations
        .filter((location) => location.anchor)
        .map((location) => [location.id, location.anchor!] as const),
    );
    const idByName = new Map(
      data.locations.map((location) => [location.name.toLowerCase(), location.id] as const),
    );
    context.strokeStyle = "rgba(240, 220, 170, 0.45)";
    context.lineWidth = 1.5;
    context.setLineDash([5, 4]);
    const drawn = new Set<string>();
    for (const location of data.locations) {
      const from = anchorById.get(location.id);
      if (!from) {
        continue;
      }
      for (const connectionName of location.connections) {
        const targetId = idByName.get(connectionName.toLowerCase());
        const to = targetId ? anchorById.get(targetId) : null;
        if (!to || !targetId) {
          continue;
        }
        const key = [location.id, targetId].sort().join("|");
        if (drawn.has(key)) {
          continue;
        }
        drawn.add(key);
        const fromX = from.x * TILE + TILE / 2;
        const fromY = from.y * TILE + TILE / 2;
        const toX = to.x * TILE + TILE / 2;
        const toY = to.y * TILE + TILE / 2;
        const midX = (fromX + toX) / 2 + (fromY - toY) * 0.15;
        const midY = (fromY + toY) / 2 + (toX - fromX) * 0.15;
        context.beginPath();
        context.moveTo(fromX, fromY);
        context.quadraticCurveTo(midX, midY, toX, toY);
        context.stroke();
      }
    }
    context.setLineDash([]);

    // Lead pins under the location markers.
    for (const pin of data.map.pins) {
      const pinX = pin.x * TILE + TILE / 2;
      const pinY = pin.y * TILE + TILE / 2;
      context.fillStyle = "rgba(190, 120, 240, 0.9)";
      context.beginPath();
      context.arc(pinX, pinY, 4, 0, Math.PI * 2);
      context.fill();
      if (pin.label) {
        context.font = "10px sans-serif";
        context.fillStyle = "rgba(220, 190, 250, 0.95)";
        context.fillText(pin.label, pinX + 7, pinY + 3);
      }
    }

    // Locations: solid dots for visited, ghost dots for known-unvisited,
    // pulse ring on the party's current position.
    for (const location of data.locations) {
      const anchor = location.anchor;
      if (!anchor) {
        continue;
      }
      const markerX = anchor.x * TILE + TILE / 2;
      const markerY = anchor.y * TILE + TILE / 2;
      if (location.isCurrent) {
        const pulse = 6 + Math.sin(pulseRef.current / 12) * 2.5;
        context.strokeStyle = "rgba(250, 200, 90, 0.85)";
        context.lineWidth = 2;
        context.beginPath();
        context.arc(markerX, markerY, pulse, 0, Math.PI * 2);
        context.stroke();
      }
      context.fillStyle = location.visited
        ? "rgba(250, 225, 160, 0.95)"
        : "rgba(250, 225, 160, 0.4)";
      context.beginPath();
      context.arc(markerX, markerY, 4.5, 0, Math.PI * 2);
      context.fill();
      context.strokeStyle = "rgba(30, 25, 15, 0.8)";
      context.lineWidth = 1;
      context.stroke();
      context.font = "600 10px sans-serif";
      context.fillStyle = location.visited
        ? "rgba(250, 240, 220, 0.95)"
        : "rgba(250, 240, 220, 0.5)";
      context.fillText(location.name, markerX + 8, markerY - 6);
    }
    context.restore();
  }, [data, genre, view]);

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

  async function addPin(clientX: number, clientY: number) {
    const canvas = canvasRef.current;
    if (!canvas || !data) {
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor((clientX - rect.left - view.x) / view.zoom / TILE);
    const y = Math.floor((clientY - rect.top - view.y) / view.zoom / TILE);
    if (x < 0 || y < 0 || x >= data.map.width || y >= data.map.height) {
      return;
    }
    const label = window.prompt("Pin label (empty for a plain marker):") ?? "";
    const response = await fetch(`/api/campaigns/${campaignId}/overworld`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pins: [...data.map.pins, { id: "", x, y, label: label.slice(0, 60) }],
      }),
    });
    if (response.ok) {
      setData(await response.json());
    }
    setPinMode(false);
  }

  async function clearPins() {
    const response = await fetch(`/api/campaigns/${campaignId}/overworld`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pins: [] }),
    });
    if (response.ok) {
      setData(await response.json());
    }
  }

  async function regenerate() {
    setRegenBusy(true);
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/overworld`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ regenerate: true }),
      });
      if (response.ok) {
        setData(await response.json());
      }
    } finally {
      setRegenBusy(false);
    }
  }

  const skin = data ? skinForGenre(genre) : null;

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
            className={cn("block w-full touch-none", pinMode ? "cursor-crosshair" : "cursor-grab")}
            onPointerDown={(event) => {
              if (pinMode) {
                void addPin(event.clientX, event.clientY);
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
      {isLead && data ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setPinMode((current) => !current)}
            className={cn(
              "flex items-center gap-1 rounded border px-2 py-0.5 text-[11px]",
              pinMode
                ? "border-amber-700 bg-amber-950/50 text-amber-200"
                : "border-stone-700 text-stone-400 hover:bg-stone-900",
            )}
          >
            <MapPin className="size-3" /> {pinMode ? "Click the map..." : "Add pin"}
          </button>
          {data.map.pins.length ? (
            <button
              type="button"
              onClick={() => void clearPins()}
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
      ) : null}
      <p className="text-[10px] text-stone-600">
        Drag to pan, scroll or pinch to zoom. Locations appear as the party discovers them.
      </p>
    </div>
  );
}
