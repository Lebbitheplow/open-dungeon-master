"use client";

import { memo, useEffect, useMemo, useRef } from "react";
import { cn } from "@/lib/cn";
import type { MapTheme } from "@/lib/battlemap/generate";
import type { PlayerMapView } from "@/lib/battlemap/view";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// Pure SVG renderer for a player's fogged battle-map view, themed by the
// environment the generator picked. All game rules live server-side; this
// only draws what the projection says and reports tile clicks upward.

const TILE = 32;

// Per-theme tile palette: floor, wall, water, difficult ground, and the
// wall decoration drawn on top (trees for wilds, blocks for stonework).
type Palette = {
  floor: string;
  floorAlt: string;
  wall: string;
  wallDeco: "tree" | "stone" | "rock";
  water: string;
  difficult: string;
};

const PALETTES: Record<MapTheme, Palette> = {
  cave: {
    floor: "#26232b",
    floorAlt: "#2a2731",
    wall: "#0b0a10",
    wallDeco: "rock",
    water: "#173a4f",
    difficult: "#37323b",
  },
  forest: {
    floor: "#25301f",
    floorAlt: "#293524",
    wall: "#101a0d",
    wallDeco: "tree",
    water: "#1e3a5f",
    difficult: "#3a3d24",
  },
  swamp: {
    floor: "#2a2f22",
    floorAlt: "#2e3326",
    wall: "#151c11",
    wallDeco: "tree",
    water: "#2b3d33",
    difficult: "#3d3b26",
  },
  riverside: {
    floor: "#33302a",
    floorAlt: "#37342d",
    wall: "#191713",
    wallDeco: "rock",
    water: "#1d4b73",
    difficult: "#42402f",
  },
  interior: {
    floor: "#322a22",
    floorAlt: "#362e25",
    wall: "#14100c",
    wallDeco: "stone",
    water: "#1e3a5f",
    difficult: "#3f3a2d",
  },
  field: {
    floor: "#2c3324",
    floorAlt: "#303728",
    wall: "#1a1d14",
    wallDeco: "rock",
    water: "#1e3a5f",
    difficult: "#403d28",
  },
};

// Deterministic per-tile jitter so floors get a subtle hand-laid texture
// without re-rendering differently each time.
function tileNoise(x: number, y: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return n - Math.floor(n);
}

function WallDecoration({ kind, x, y }: { kind: Palette["wallDeco"]; x: number; y: number }) {
  const px = x * TILE;
  const py = y * TILE;
  if (kind === "tree") {
    return (
      <g pointerEvents="none" opacity={0.85}>
        <circle cx={px + TILE / 2} cy={py + TILE / 2 - 2} r={TILE / 3} fill="#1d2b17" />
        <circle cx={px + TILE / 2 - 5} cy={py + TILE / 2 + 3} r={TILE / 4.5} fill="#233620" />
        <circle cx={px + TILE / 2 + 5} cy={py + TILE / 2 + 2} r={TILE / 5} fill="#1a2814" />
      </g>
    );
  }
  if (kind === "stone") {
    return (
      <g pointerEvents="none" stroke="#2b241c" strokeWidth={1} opacity={0.8}>
        <line x1={px} y1={py + TILE / 2} x2={px + TILE} y2={py + TILE / 2} />
        <line x1={px + TILE / 3} y1={py} x2={px + TILE / 3} y2={py + TILE / 2} />
        <line x1={px + (2 * TILE) / 3} y1={py + TILE / 2} x2={px + (2 * TILE) / 3} y2={py + TILE} />
      </g>
    );
  }
  return (
    <g pointerEvents="none" opacity={0.7}>
      <polygon
        points={`${px + 6},${py + TILE - 7} ${px + TILE / 2},${py + 6} ${px + TILE - 6},${py + TILE - 7}`}
        fill="#221f26"
        stroke="#141218"
        strokeWidth={1}
      />
    </g>
  );
}

// Memoized: the session view re-renders on every SSE event (including each
// streamed narration token), and rebuilding width*height SVG cells each
// time is Firefox's slowest path. The click handler routes through a ref so
// the parent's inline closure never invalidates the memo.
export const BattleMapGrid = memo(
  function BattleMapGrid({
    view,
    sheets,
    onTileClick,
  }: {
    view: PlayerMapView;
    sheets: CharacterSheet[];
    onTileClick?: (x: number, y: number) => void;
  }) {
    const clickRef = useRef(onTileClick);
    useEffect(() => {
      clickRef.current = onTileClick;
    });
    const { width, height } = view;
    const palette = PALETTES[view.theme] ?? PALETTES.field;
    const portraitsByRef = new Map(
      sheets.filter((sheet) => sheet.portrait).map((sheet) => [sheet.id, sheet.portrait!.url]),
    );
    const currentName = view.currentTurnName.toLowerCase();

    // The terrain/fog/reachable cell layer only changes when the view
    // projection itself changes; token/light layers below stay cheap.
    const cells = useMemo(() => buildCells(view, palette), [view, palette]);

    // Delegated tile clicks: the memoized cell layer carries data attributes
    // instead of per-rect closures, so cells never rebuild for a new handler.
    function handleSvgClick(event: React.MouseEvent<SVGSVGElement>) {
      const target = event.target as SVGElement;
      const x = target.dataset?.tileX;
      const y = target.dataset?.tileY;
      if (x !== undefined && y !== undefined) {
        clickRef.current?.(Number(x), Number(y));
      }
    }

    return (
      <svg
        viewBox={`0 0 ${width * TILE} ${height * TILE}`}
        className="h-auto w-full select-none rounded-lg border border-stone-800 bg-stone-950"
        role="img"
        aria-label="Battle map"
        onClick={handleSvgClick}
      >
        <defs>
          <radialGradient id="torchglow">
            <stop offset="0%" stopColor="#fbbf24" stopOpacity={0.3} />
            <stop offset="70%" stopColor="#f59e0b" stopOpacity={0.1} />
            <stop offset="100%" stopColor="#f59e0b" stopOpacity={0} />
          </radialGradient>
          <radialGradient id="mapvignette">
            <stop offset="60%" stopColor="#000" stopOpacity={0} />
            <stop offset="100%" stopColor="#000" stopOpacity={0.4} />
          </radialGradient>
          {view.tokens.map((token) =>
            portraitsByRef.has(token.refId) ? (
              <clipPath key={`clip-${token.id}`} id={`token-clip-${token.id}`}>
                <circle
                  cx={token.x * TILE + TILE / 2}
                  cy={token.y * TILE + TILE / 2}
                  r={TILE / 2 - 4}
                />
              </clipPath>
            ) : null,
          )}
        </defs>
        {cells}
        {view.lights.map((light, index) => (
          <circle
            key={`light-${index}`}
            cx={light.x * TILE + TILE / 2}
            cy={light.y * TILE + TILE / 2}
            r={light.radius * TILE}
            fill="url(#torchglow)"
            pointerEvents="none"
          />
        ))}
        {view.tokens.map((token) => {
          const cx = token.x * TILE + TILE / 2;
          const cy = token.y * TILE + TILE / 2;
          const portrait = portraitsByRef.get(token.refId);
          const isCurrent =
            !token.down && currentName !== "" && token.name.toLowerCase() === currentName;
          const ring = token.down
            ? "#57534e"
            : token.mine
              ? "#fbbf24"
              : token.kind === "enemy"
                ? "#dc2626"
                : "#78716c";
          return (
            <g key={token.id} pointerEvents="none" opacity={token.down ? 0.75 : 1}>
              <ellipse
                cx={cx}
                cy={cy + TILE / 2 - 5}
                rx={TILE / 2.6}
                ry={3.5}
                fill="#000"
                opacity={0.35}
              />
              <circle
                cx={cx}
                cy={cy}
                r={TILE / 2 - 3}
                fill={token.kind === "enemy" ? "#450a0a" : "#1c1917"}
                stroke={ring}
                strokeWidth={token.mine || isCurrent ? 2.5 : 1.5}
                className={cn(isCurrent && "animate-pulse")}
              />
              {portrait ? (
                <image
                  href={portrait}
                  x={token.x * TILE + 4}
                  y={token.y * TILE + 4}
                  width={TILE - 8}
                  height={TILE - 8}
                  preserveAspectRatio="xMidYMid slice"
                  clipPath={`url(#token-clip-${token.id})`}
                  opacity={token.down ? 0.45 : 1}
                />
              ) : (
                <text
                  x={cx}
                  y={cy + 4.5}
                  textAnchor="middle"
                  fontSize={13}
                  fontWeight={700}
                  fill={token.down ? "#a8a29e" : token.kind === "enemy" ? "#fca5a5" : "#e7e5e4"}
                >
                  {token.name.charAt(0).toUpperCase()}
                </text>
              )}
              {token.down ? (
                <text
                  x={cx}
                  y={cy + 5}
                  textAnchor="middle"
                  fontSize={15}
                  fontWeight={700}
                  fill="#ef4444"
                >
                  ✕
                </text>
              ) : null}
            </g>
          );
        })}
        <rect
          x={0}
          y={0}
          width={width * TILE}
          height={height * TILE}
          fill="url(#mapvignette)"
          pointerEvents="none"
        />
      </svg>
    );
  },
  (prev, next) =>
    prev.view === next.view &&
    prev.sheets === next.sheets &&
    // Only presence matters; the handler itself is read through a ref.
    (prev.onTileClick === undefined) === (next.onTileClick === undefined),
);

function buildCells(view: PlayerMapView, palette: Palette) {
  const { width, height } = view;
  const visible = new Set(view.visible);
  const explored = new Set(view.explored);
  const reachable = new Set(view.reachable);

  return Array.from({ length: width * height }, (_, idx) => {
    const x = idx % width;
    const y = Math.floor(idx / width);
    const ch = view.terrain[idx];
    const isExplored = explored.has(idx);
    const isVisible = visible.has(idx);
    const isReachable = reachable.has(idx);
    const fill = !isExplored
      ? "#050505"
      : ch === "#"
        ? palette.wall
        : ch === "~"
          ? palette.water
          : ch === ","
            ? palette.difficult
            : tileNoise(x, y) > 0.5
              ? palette.floor
              : palette.floorAlt;
    return (
      <g key={idx}>
        <rect
          x={x * TILE}
          y={y * TILE}
          width={TILE}
          height={TILE}
          fill={fill}
          stroke="#00000055"
          strokeWidth={1}
        />
        {isExplored && ch === "#" ? <WallDecoration kind={palette.wallDeco} x={x} y={y} /> : null}
        {isExplored && ch === "~" ? (
          <path
            d={`M ${x * TILE + 6} ${y * TILE + TILE / 2} q 5 -4 10 0 t 10 0`}
            stroke="#ffffff33"
            strokeWidth={1.5}
            fill="none"
            pointerEvents="none"
          />
        ) : null}
        {isExplored && ch === "," ? (
          <g pointerEvents="none" fill="#00000040">
            <circle cx={x * TILE + 10} cy={y * TILE + 12} r={2} />
            <circle cx={x * TILE + 22} cy={y * TILE + 20} r={2.5} />
            <circle cx={x * TILE + 15} cy={y * TILE + 25} r={1.5} />
          </g>
        ) : null}
        {isExplored && !isVisible ? (
          <rect x={x * TILE} y={y * TILE} width={TILE} height={TILE} fill="#000" opacity={0.55} />
        ) : null}
        {isReachable ? (
          <rect
            x={x * TILE + 2}
            y={y * TILE + 2}
            width={TILE - 4}
            height={TILE - 4}
            rx={4}
            fill="#f59e0b"
            opacity={0.18}
            stroke="#f59e0b"
            strokeOpacity={0.45}
            className="cursor-pointer"
            data-tile-x={x}
            data-tile-y={y}
          />
        ) : null}
      </g>
    );
  });
}
