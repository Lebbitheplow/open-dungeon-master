"use client";

import { memo, useEffect, useMemo, useRef } from "react";
import { cn } from "@/lib/cn";
import {
  buildCells,
  PALETTES,
  shade,
  TILE,
} from "@/app/campaigns/[campaignId]/battleMapCells";
import { backdropRect } from "@/lib/battlemap/backdrop";
import type { PlayerMapView } from "@/lib/battlemap/view";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// Pure SVG renderer for a player's fogged battle-map view, themed by the
// environment the generator picked. All game rules live server-side; this
// only draws what the projection says and reports tile clicks upward.
//
// Terrain is drawn in layers so richer detail (beveled walls, cast shadows,
// layered water, a fractal-noise grain pass) never leaks past the fog: the
// projection blanks unexplored tiles to " ", so neighbour lookups below stop
// cleanly at explored edges.
//
// Everything above the terrain is an overlay the parent hands down: a
// measured template, a drag ruler, live pings, the token the DM has picked
// up. The grid draws them and reports clicks; it decides nothing.

export type MapOverlay = {
  // Tile indexes covered by a measured area (src/lib/battlemap/template.ts).
  template?: number[];
  // The drag ruler: the path a move would take and what it would cost.
  ruler?: { path: Array<{ x: number; y: number }>; label: string; overBudget: boolean } | null;
  // Somebody pointing at a tile. Ephemeral, so these arrive and expire.
  pings?: Array<{ x: number; y: number; by: string; at: number }>;
  // The token the DM is holding, waiting for a tile to put it on.
  selectedTokenId?: string | null;
};

// Memoized: the session view re-renders on every SSE event (including each
// streamed narration token), and rebuilding width*height SVG cells each
// time is Firefox's slowest path. The click handler routes through a ref so
// the parent's inline closure never invalidates the memo.
export const BattleMapGrid = memo(
  function BattleMapGrid({
    view,
    sheets,
    onTileClick,
    onTileHover,
    onTokenClick,
    everyTileClickable = false,
    overlay,
  }: {
    view: PlayerMapView;
    sheets: CharacterSheet[];
    onTileClick?: (x: number, y: number) => void;
    onTileHover?: (x: number, y: number | null) => void;
    onTokenClick?: (tokenId: string) => void;
    // Players may only click where they can walk, so the reachable overlay
    // is the whole clickable surface. A DM placing a token needs the rest of
    // the board too, which is what this turns on.
    everyTileClickable?: boolean;
    overlay?: MapOverlay;
  }) {
    const clickRef = useRef(onTileClick);
    const hoverRef = useRef(onTileHover);
    const tokenRef = useRef(onTokenClick);
    useEffect(() => {
      clickRef.current = onTileClick;
      hoverRef.current = onTileHover;
      tokenRef.current = onTokenClick;
    });
    // Touch has no hover, so the ruler and range previews the mouse gets for
    // free would never appear on a phone. Instead the first tap on a tile IS
    // the preview: it feeds the hover handler (the walk, its cost in feet, a
    // held piece's route) and commits nothing, and the second tap on the
    // same tile is the one that goes through. Only taps take this route, and
    // only when a hover handler is wired at all, so mouse and pen clicks and
    // every preview-less mode (pointing, placing, measuring) keep their
    // one-step feel.
    const pointerTypeRef = useRef("");
    const touchPreviewRef = useRef<{ x: number; y: number } | null>(null);
    // A new board must not inherit the old one's pending confirm tap.
    useEffect(() => {
      touchPreviewRef.current = null;
    }, [view.mapId]);
    const { width, height } = view;
    const palette = PALETTES[view.theme] ?? PALETTES.field;
    const portraitsByRef = new Map(
      sheets.filter((sheet) => sheet.portrait).map((sheet) => [sheet.id, sheet.portrait!.url]),
    );
    const currentName = view.currentTurnName.toLowerCase();

    // The terrain/fog/reachable cell layer only changes when the view
    // projection itself changes; token/light layers below stay cheap.
    const cells = useMemo(() => buildCells(view, palette), [view, palette]);

    // A transparent grid that makes every tile a click and hover target.
    // It sits UNDER the tokens so that clicking a figure still reaches the
    // figure, which is the whole point of picking one up.
    const catcher = useMemo(() => {
      if (!everyTileClickable) {
        return null;
      }
      const rects: React.ReactNode[] = [];
      for (let idx = 0; idx < width * height; idx += 1) {
        const x = idx % width;
        const y = Math.floor(idx / width);
        rects.push(
          <rect
            key={`hit-${idx}`}
            x={x * TILE}
            y={y * TILE}
            width={TILE}
            height={TILE}
            fill="transparent"
            className="cursor-crosshair"
            data-tile-x={x}
            data-tile-y={y}
          />,
        );
      }
      return <g>{rects}</g>;
    }, [everyTileClickable, width, height]);

    // Delegated tile clicks: the memoized cell layer carries data attributes
    // instead of per-rect closures, so cells never rebuild for a new handler.
    function readTile(event: React.MouseEvent<SVGSVGElement>) {
      const target = event.target as SVGElement;
      const x = target.dataset?.tileX;
      const y = target.dataset?.tileY;
      return x !== undefined && y !== undefined
        ? { x: Number(x), y: Number(y), tokenId: target.dataset?.tokenId }
        : { x: null, y: null, tokenId: target.dataset?.tokenId };
    }

    function handleSvgClick(event: React.MouseEvent<SVGSVGElement>) {
      const { x, y, tokenId } = readTile(event);
      if (tokenId) {
        tokenRef.current?.(tokenId);
        return;
      }
      if (x === null || y === null) {
        return;
      }
      // First tap previews, second commits; see the refs above. Browsers
      // fire compatibility mouse events on a tap, but not reliably, so the
      // hover handler is called here rather than trusted to have run.
      if (pointerTypeRef.current === "touch" && hoverRef.current) {
        const previewed = touchPreviewRef.current;
        if (!previewed || previewed.x !== x || previewed.y !== y) {
          touchPreviewRef.current = { x, y };
          hoverRef.current(x, y);
          return;
        }
        touchPreviewRef.current = null;
      }
      clickRef.current?.(x, y);
    }

    function handleSvgMove(event: React.MouseEvent<SVGSVGElement>) {
      if (!hoverRef.current) {
        return;
      }
      const { x, y } = readTile(event);
      if (x === null || y === null) {
        hoverRef.current(0, null);
        return;
      }
      hoverRef.current(x, y);
    }

    return (
      <svg
        viewBox={`0 0 ${width * TILE} ${height * TILE}`}
        className="h-auto w-full select-none rounded-lg border border-stone-800 bg-stone-950"
        role="img"
        aria-label="Battle map"
        onClick={handleSvgClick}
        onPointerDown={(event) => {
          pointerTypeRef.current = event.pointerType;
        }}
        onMouseMove={onTileHover ? handleSvgMove : undefined}
        onMouseLeave={onTileHover ? () => hoverRef.current?.(0, null) : undefined}
      >
        <defs>
          <radialGradient id="torchglow">
            <stop offset="0%" stopColor="#fbbf24" stopOpacity={0.3} />
            <stop offset="70%" stopColor="#f59e0b" stopOpacity={0.1} />
            <stop offset="100%" stopColor="#f59e0b" stopOpacity={0} />
          </radialGradient>
          <radialGradient id="mapvignette">
            <stop offset="55%" stopColor="#000" stopOpacity={0} />
            <stop offset="100%" stopColor="#000" stopOpacity={0.45} />
          </radialGradient>
          {/* Fractal grain overlaid on terrain for a hand-laid surface. */}
          <filter id={`grain-${view.theme}`} x="0" y="0" width="100%" height="100%">
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.9"
              numOctaves={2}
              seed={7}
              stitchTiles="stitch"
              result="n"
            />
            <feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.5 0" />
          </filter>
          <linearGradient id={`water-${view.theme}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={shade(palette.water, 26)} />
            <stop offset="100%" stopColor={shade(palette.water, -18)} />
          </linearGradient>
          <linearGradient id="castN" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#000" stopOpacity={0.5} />
            <stop offset="100%" stopColor="#000" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="castW" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#000" stopOpacity={0.42} />
            <stop offset="100%" stopColor="#000" stopOpacity={0} />
          </linearGradient>
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
        {/* The picture under the grid, drawn first so every terrain cell,
            every fog square and every token lands on top of it. Unexplored
            tiles are opaque, so the art is covered exactly where the fog
            covers the terrain (src/lib/battlemap/backdrop.ts). */}
        {view.backdrop ? (
          <image
            href={view.backdrop.path}
            {...backdropRect(view.backdrop.transform, width, height, TILE)}
            opacity={view.backdrop.transform.opacity}
            preserveAspectRatio="none"
            pointerEvents="none"
          />
        ) : null}
        {cells}
        {catcher}
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
          const held = overlay?.selectedTokenId === token.id;
          const ring = token.down
            ? "#57534e"
            : held
              ? "#fbbf24"
              : token.mine
                ? "#fbbf24"
                : RING_BY_KIND[token.kind];
          const hp = view.tokenHp?.[token.id];
          return (
            <g
              key={token.id}
              // Tokens only take clicks where somebody upstream wants them:
              // for a player the map is a floor to walk on, not a set of
              // pieces to pick up.
              pointerEvents={onTokenClick ? "auto" : "none"}
              data-token-id={onTokenClick ? token.id : undefined}
              className={cn(onTokenClick && "cursor-pointer")}
              opacity={token.down ? 0.75 : token.hidden ? 0.55 : 1}
            >
              <title>{token.name}</title>
              <ellipse
                cx={cx}
                cy={cy + TILE / 2 - 5}
                rx={TILE / 2.6}
                ry={3.5}
                fill="#000"
                opacity={0.35}
                pointerEvents="none"
              />
              {token.kind === "prop" ? (
                // A prop is a thing, not a person, so it is not a circle.
                <rect
                  x={cx - TILE / 2 + 4}
                  y={cy - TILE / 2 + 4}
                  width={TILE - 8}
                  height={TILE - 8}
                  rx={3}
                  fill="#221d18"
                  stroke={ring}
                  strokeWidth={1.5}
                  strokeDasharray={token.hidden ? "3 2" : undefined}
                />
              ) : (
                <circle
                  cx={cx}
                  cy={cy}
                  r={TILE / 2 - 3}
                  fill={FILL_BY_KIND[token.kind]}
                  stroke={ring}
                  strokeWidth={token.mine || isCurrent || held ? 2.5 : 1.5}
                  strokeDasharray={token.hidden ? "3 2" : undefined}
                  className={cn((isCurrent || held) && "animate-pulse")}
                />
              )}
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
                  pointerEvents="none"
                >
                  ✕
                </text>
              ) : null}
              {/* Real hit points, DM projection only: the server sends
                  tokenHp to nobody else (src/lib/battlemap/view.ts). */}
              {hp && hp.max > 0 ? (
                <g pointerEvents="none">
                  <rect
                    x={cx - TILE / 2 + 4}
                    y={cy + TILE / 2 - 6}
                    width={TILE - 8}
                    height={3}
                    rx={1.5}
                    fill="#0c0a09"
                    opacity={0.85}
                  />
                  <rect
                    x={cx - TILE / 2 + 4}
                    y={cy + TILE / 2 - 6}
                    width={Math.max(0, Math.min(1, hp.current / hp.max)) * (TILE - 8)}
                    height={3}
                    rx={1.5}
                    fill={hp.current / hp.max > 0.5 ? "#4ade80" : hp.current / hp.max > 0.25 ? "#facc15" : "#ef4444"}
                  />
                </g>
              ) : null}
              {token.hidden ? (
                <text
                  x={cx + TILE / 2 - 5}
                  y={cy - TILE / 2 + 9}
                  textAnchor="middle"
                  fontSize={9}
                  fill="#fbbf24"
                  pointerEvents="none"
                >
                  ●
                </text>
              ) : null}
            </g>
          );
        })}
        {/* Measured area. Drawn above the tokens so the DM can see who is
            standing in it without hunting for the outline. */}
        {overlay?.template?.length ? (
          <g pointerEvents="none">
            {overlay.template.map((idx) => (
              <rect
                key={`tpl-${idx}`}
                x={(idx % width) * TILE}
                y={Math.floor(idx / width) * TILE}
                width={TILE}
                height={TILE}
                fill="#f97316"
                opacity={0.26}
                stroke="#fb923c"
                strokeOpacity={0.5}
              />
            ))}
          </g>
        ) : null}
        {/* The drag ruler: the path a move would actually take, and its cost
            in feet, measured with the same pathfinder the server enforces. */}
        {overlay?.ruler && overlay.ruler.path.length ? (
          <g pointerEvents="none">
            <polyline
              points={overlay.ruler.path
                .map((step) => `${step.x * TILE + TILE / 2},${step.y * TILE + TILE / 2}`)
                .join(" ")}
              fill="none"
              stroke={overlay.ruler.overBudget ? "#ef4444" : "#fbbf24"}
              strokeWidth={2}
              strokeDasharray="5 3"
              strokeLinejoin="round"
            />
            {(() => {
              const last = overlay.ruler.path[overlay.ruler.path.length - 1];
              return (
                <>
                  <rect
                    x={last.x * TILE - 6}
                    y={last.y * TILE - 14}
                    width={44}
                    height={14}
                    rx={3}
                    fill="#0c0a09"
                    opacity={0.85}
                  />
                  <text
                    x={last.x * TILE + 16}
                    y={last.y * TILE - 4}
                    textAnchor="middle"
                    fontSize={10}
                    fontWeight={600}
                    fill={overlay.ruler.overBudget ? "#fca5a5" : "#fcd34d"}
                  >
                    {overlay.ruler.label}
                  </text>
                </>
              );
            })()}
          </g>
        ) : null}
        {/* Somebody pointing. The ring expands and fades on its own, so a
            ping needs no state beyond the moment it arrived. */}
        {overlay?.pings?.map((ping) => (
          <g key={`ping-${ping.at}-${ping.x}-${ping.y}`} pointerEvents="none">
            <circle
              cx={ping.x * TILE + TILE / 2}
              cy={ping.y * TILE + TILE / 2}
              r={TILE * 0.9}
              fill="none"
              stroke="#fbbf24"
              strokeWidth={2.5}
              className="animate-ping"
            />
            <text
              x={ping.x * TILE + TILE / 2}
              y={ping.y * TILE - 4}
              textAnchor="middle"
              fontSize={10}
              fontWeight={600}
              fill="#fcd34d"
            >
              {ping.by}
            </text>
          </g>
        ))}
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
    // The overlay is compared by reference, so a parent that rebuilds it
    // every render would defeat the memo. BattleMapPanel memoizes it.
    prev.overlay === next.overlay &&
    prev.everyTileClickable === next.everyTileClickable &&
    // Only presence matters; the handlers themselves are read through refs.
    (prev.onTileClick === undefined) === (next.onTileClick === undefined) &&
    (prev.onTileHover === undefined) === (next.onTileHover === undefined) &&
    (prev.onTokenClick === undefined) === (next.onTokenClick === undefined),
);

// Token colours by what the piece is. Props and NPCs are visibly not
// combatants, because the fastest way to misread a board is to think the
// barrel is a monster.
const RING_BY_KIND: Record<string, string> = {
  pc: "#78716c",
  enemy: "#dc2626",
  npc: "#38bdf8",
  prop: "#a8a29e",
};

const FILL_BY_KIND: Record<string, string> = {
  pc: "#1c1917",
  enemy: "#450a0a",
  npc: "#0c1a24",
  prop: "#221d18",
};

