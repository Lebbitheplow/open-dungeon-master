"use client";

import { useEffect, useRef, type CSSProperties } from "react";
import type { MapTheme } from "@/lib/battlemap/generate";
import type { MapSkin } from "@/lib/battlemap/skins";
import type { AmbientLight, MapLight, XY } from "@/lib/battlemap/types";
import { FLAT_TONES } from "@/app/campaigns/[campaignId]/mapUi";
import { usePaintedGround } from "@/app/campaigns/[campaignId]/useMapPaint";
import { FLOOD, floodProgress, floodRings, sweepMs } from "@/app/workshop/maps/forge";

// The forge's preview: the rolled map, painted by the renderer the table
// plays on, drawing itself in (docs/visual-overhaul-plan.md 4.1). Tiles flood
// out from the centre a ring at a time, a gold sweep crosses once, the spawn
// discs pop near the end, the torches breathe. It is one canvas rather than
// three hundred nodes because the picture is one picture: each tile's piece
// of it is drawn growing into its square. Under reduced motion or low effects
// the whole map simply fades in.

export type ForgeMap = {
  width: number;
  height: number;
  terrain: string;
  theme: MapTheme;
  ambient: AmbientLight;
  lights: MapLight[];
  pcSpawns?: XY[];
  enemySpawns?: XY[];
};

const CELL = 28;
const DARK: Record<AmbientLight, number> = { bright: 0, dim: 0.34, dark: 0.58 };

function calm(): boolean {
  return (
    window.matchMedia("(prefers-reduced-motion: reduce)").matches || document.documentElement.dataset.effects === "low"
  );
}

// --ease-settle, near enough, for a value the canvas has to compute itself.
function settle(t: number): number {
  return 1 - Math.pow(1 - t, 4);
}

export function ForgePreview({
  map,
  genre,
  skin,
  seedKey,
  rollId,
  stretch = 1,
}: {
  map: ForgeMap;
  genre: string | null | undefined;
  skin?: MapSkin | null;
  // Stable per roll, so the same seed always dresses the same way.
  seedKey: string;
  // Changes with every roll and every restore; the reveal starts again on it.
  rollId: number;
  // Above 1 slows the flood: a roll brought back from the history takes its time.
  stretch?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const startRef = useRef<{ rollId: number; at: number } | null>(null);
  const ground = usePaintedGround({
    width: map.width,
    height: map.height,
    terrain: map.terrain,
    theme: map.theme,
    genre,
    seedKey,
    skin,
    cell: CELL,
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) {
      return;
    }
    const { width, height, terrain } = map;
    canvas.width = width * CELL;
    canvas.height = height * CELL;
    if (startRef.current?.rollId !== rollId) {
      startRef.current = { rollId, at: performance.now() };
    }
    const started = startRef.current.at;
    const { rings, last } = floodRings(width, height);
    const total = (last * FLOOD.ringMs + FLOOD.tileMs) * stretch;
    const still = calm();
    let frame = 0;

    const paint = (now: number) => {
      const elapsed = still ? total : (now - started) / stretch;
      context.clearRect(0, 0, canvas.width, canvas.height);
      const picture = ground && ground.terrain === terrain ? ground.canvas : null;
      const sx = picture ? picture.width / width : 0;
      const sy = picture ? picture.height / height : 0;
      for (let index = 0; index < terrain.length; index += 1) {
        const p = floodProgress(rings[index], elapsed);
        if (p <= 0) {
          continue;
        }
        const x = index % width;
        const y = Math.floor(index / width);
        const size = CELL * (0.2 + 0.8 * settle(p));
        const left = x * CELL + (CELL - size) / 2;
        const top = y * CELL + (CELL - size) / 2;
        context.globalAlpha = Math.min(1, p / 0.7);
        if (picture) {
          context.drawImage(picture, x * sx, y * sy, sx, sy, left, top, size, size);
        } else {
          context.fillStyle = FLAT_TONES[terrain[index]] ?? "#2a2724";
          context.fillRect(left, top, size, size);
        }
      }
      context.globalAlpha = 1;
      // The place's own light: a wash of dark with the torches burnt out of it.
      const dark = DARK[map.ambient];
      if (dark > 0) {
        const shade = Math.min(1, elapsed / total) * dark;
        context.fillStyle = `rgba(6, 4, 16, ${shade})`;
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.globalCompositeOperation = "lighter";
        for (const light of map.lights) {
          const cx = (light.x + 0.5) * CELL;
          const cy = (light.y + 0.5) * CELL;
          const reach = light.dimRadius * CELL;
          const glow = context.createRadialGradient(cx, cy, 0, cx, cy, reach);
          glow.addColorStop(0, `rgba(251, 191, 36, ${0.18 * (shade / dark)})`);
          glow.addColorStop(1, "rgba(251, 191, 36, 0)");
          context.fillStyle = glow;
          context.fillRect(cx - reach, cy - reach, reach * 2, reach * 2);
        }
        context.globalCompositeOperation = "source-over";
      }
      if (elapsed < total) {
        frame = requestAnimationFrame(paint);
      }
    };
    frame = requestAnimationFrame(paint);
    return () => cancelAnimationFrame(frame);
  }, [map, ground, rollId, stretch]);

  const sweep = sweepMs(map.width, map.height) * stretch;
  const at = (spot: XY): CSSProperties => ({
    left: `${((spot.x + 0.5) / map.width) * 100}%`,
    top: `${((spot.y + 0.5) / map.height) * 100}%`,
    width: `${(0.62 / map.width) * 100}%`,
  });

  return (
    <div
      key={rollId}
      className="map-fade-in relative w-full overflow-hidden rounded-lg border border-stone-800 bg-stone-950"
      style={{ aspectRatio: `${map.width} / ${map.height}` }}
    >
      <canvas ref={canvasRef} aria-label="The rolled map" role="img" className="block size-full" />
      <div
        aria-hidden="true"
        // As wide as the map: its travel is a share of its own width, so a
        // narrower band would stop a third of the way across.
        className="map-sweep pointer-events-none absolute inset-0 opacity-0"
        style={
          {
            "--map-sweep-ms": `${sweep}ms`,
            background: "linear-gradient(100deg, transparent 32%, rgba(227, 193, 92, 0.8) 50%, transparent 68%)",
          } as CSSProperties
        }
      />
      {map.lights.map((light, index) => (
        <span
          key={`light-${index}`}
          aria-hidden="true"
          className="map-torch pointer-events-none absolute aspect-square -translate-x-1/2 -translate-y-1/2 rounded-full bg-amber-400 shadow-[0_0_10px_rgba(251,191,36,0.9)]"
          // Each torch breathes out of step with the last.
          style={{ ...at(light), width: `${(0.3 / map.width) * 100}%`, animationDelay: `${index * 420}ms` }}
        />
      ))}
      {[...(map.pcSpawns ?? []).map((spot) => ({ spot, foe: false })), ...(map.enemySpawns ?? []).map((spot) => ({ spot, foe: true }))].map(
        (entry, index) => (
          <span
            key={`spawn-${index}`}
            aria-hidden="true"
            className={
              entry.foe
                ? "map-disc pointer-events-none absolute aspect-square -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-red-500/90 bg-red-950/50"
                : "map-disc pointer-events-none absolute aspect-square -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-amber-400/90 bg-amber-950/30"
            }
            style={{ ...at(entry.spot), animationDelay: `${Math.round(sweep * 0.7) + index * 60}ms` }}
          />
        ),
      )}
    </div>
  );
}
