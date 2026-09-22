"use client";

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { cn } from "@/lib/cn";
import {
  buildCells,
  PALETTES,
  shade,
  TILE,
} from "@/app/campaigns/[campaignId]/battleMapCells";
import {
  AuraLayer,
  DrawingLayer,
  StageDefs,
  TargetLines,
  TokenFigure,
} from "@/app/campaigns/[campaignId]/BoardStage";
import {
  AimLayer,
  AimScrim,
  MoteLayer,
  StageLayerDefs,
  tokenCentre,
  TurnSpotlight,
  type AimOverlay,
} from "@/app/campaigns/[campaignId]/BoardStageLayers";
import { recoilFor, seedOf, type Shake } from "@/lib/battlemap/delivery";
import type { MapDrawing, MapLabel } from "@/lib/battlemap/scene";
import { FxLayer, useFxPlayer } from "@/app/campaigns/[campaignId]/BoardFx";
import { ParticleCanvas, type ParticleHandle } from "@/components/ParticleCanvas";
import { backdropRect } from "@/lib/battlemap/backdrop";
import type { FxEvent } from "@/lib/battlemap/fx-plan";
import type { PlayerMapView } from "@/lib/battlemap/view";
import type { CharacterSheet } from "@/lib/schemas/sheet";

const NO_FX: FxEvent[] = [];
const NOOP = () => {};

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
  // A drawing in progress, so it lands where it was seen.
  sketch?: Pick<MapDrawing, "kind" | "points" | "tone"> | null;
  // A target being chosen: the scrim, the reticles, the ember arc.
  aim?: AimOverlay | null;
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
    fx = NO_FX,
    onFxPlayed = NOOP,
    onLabelClick,
    painted = null,
    faces,
    onTokenHover,
  }: {
    view: PlayerMapView;
    sheets: CharacterSheet[];
    // The painted picture of this board, the canvas it was painted on, or
    // null while the drawn terrain stands in for it (usePaintedMap.ts).
    // Never set on a map that carries its own backdrop.
    painted?: HTMLCanvasElement | null;
    // A face for every token that has one, by the token's refId: a portrait,
    // a placeholder plate, a monster's art. A token without one falls back to
    // its initial (docs/visual-overhaul-plan.md 5.1).
    faces?: Map<string, string>;
    onTileClick?: (x: number, y: number) => void;
    onTileHover?: (x: number, y: number | null) => void;
    onTokenClick?: (tokenId: string) => void;
    // The pointer came to rest on a figure, or left it: the hover plate.
    onTokenHover?: (tokenId: string | null) => void;
    // Players may only click where they can walk, so the reachable overlay
    // is the whole clickable surface. A DM placing a token needs the rest of
    // the board too, which is what this turns on.
    everyTileClickable?: boolean;
    overlay?: MapOverlay;
    // Effects the server planned and this board has yet to play; the grid
    // reports each one back once it has (src/lib/battlemap/fx-plan.ts).
    fx?: FxEvent[];
    onFxPlayed?: (ids: string[]) => void;
    // A label with a reference was tapped (a lore entry, an NPC).
    onLabelClick?: (label: MapLabel) => void;
  }) {
    const clickRef = useRef(onTileClick);
    const hoverRef = useRef(onTileHover);
    const tokenRef = useRef(onTokenClick);
    const labelRef = useRef(onLabelClick);
    const tokenHoverRef = useRef(onTokenHover);
    const hoveredTokenRef = useRef<string | null>(null);
    // The painted canvas is placed by hand: React never renders it, only the
    // foreignObject slot it sits in, so a repaint is one element swap and no
    // encode. The slot is sized in board units and the canvas fills it
    // (usePaintedMap.ts styles it), which is exactly how the <image> that
    // used to sit here was stretched.
    const paintedSlotRef = useRef<HTMLDivElement | null>(null);
    useLayoutEffect(() => {
      const slot = paintedSlotRef.current;
      if (!slot || slot.firstChild === painted) {
        return;
      }
      slot.textContent = "";
      if (painted) {
        slot.appendChild(painted);
      }
    }, [painted]);
    useEffect(() => {
      clickRef.current = onTileClick;
      hoverRef.current = onTileHover;
      tokenRef.current = onTokenClick;
      labelRef.current = onLabelClick;
      tokenHoverRef.current = onTokenHover;
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
    const portraitsByRef = useMemo(() => {
      const byRef = new Map(faces ?? []);
      // An uploaded portrait always wins over a plate.
      for (const sheet of sheets) {
        if (sheet.portrait) byRef.set(sheet.id, sheet.portrait.url);
      }
      return byRef;
    }, [faces, sheets]);
    const currentName = view.currentTurnName.toLowerCase();

    // The particle canvas sits over the SVG in the same frame; effects are
    // planned in SVG units and converted at burst time from the frame's
    // rendered width, so zoom and layout never need to be known here.
    const frameRef = useRef<HTMLDivElement | null>(null);
    const particlesRef = useRef<ParticleHandle | null>(null);
    const onParticles = useCallback((handle: ParticleHandle | null) => {
      particlesRef.current = handle;
    }, []);
    const toCanvas = useCallback(
      (svgX: number, svgY: number) => {
        const frame = frameRef.current;
        const scale = frame ? frame.clientWidth / (width * TILE) : 1;
        return { x: svgX * scale, y: svgY * scale };
      },
      [width],
    );
    // Stage shake on a landed blow: translate only, on the frame, through the
    // animation API so no React state moves and nothing re-renders. The
    // player never asks for one under reduced motion or low effects.
    const onShake = useCallback((shake: Shake, delay: number, struck: FxEvent) => {
      const frame = frameRef.current;
      if (!frame?.animate) {
        return;
      }
      const px = shake.px;
      frame.animate(
        [
          { transform: "translate(0, 0)" },
          { transform: `translate(${px}px, ${-px * 0.45}px)`, offset: 0.12 },
          { transform: `translate(${-px}px, ${px * 0.45}px)`, offset: 0.25 },
          { transform: `translate(${px}px, 0)`, offset: 0.38 },
          { transform: `translate(${-px * 0.6}px, ${-px * 0.3}px)`, offset: 0.5 },
          { transform: `translate(${px * 0.4}px, 0)`, offset: 0.62 },
          { transform: `translate(${-px * 0.2}px, 0)`, offset: 0.75 },
          { transform: "translate(0, 0)" },
        ],
        { duration: shake.ms, delay, easing: "cubic-bezier(0.45, 0, 0.55, 1)" },
      );
      // On the same beat each struck figure kicks away from the blow and its
      // health ring swells (the mockup's card-recoil and hit-ring). The
      // `translate` and `rotate` properties leave the figure's own transform,
      // and the move transition on it, alone.
      const tiles = struck.to ? (Array.isArray(struck.to) ? struck.to : [struck.to]) : [];
      const ids = struck.toTokenId ? (Array.isArray(struck.toTokenId) ? struck.toTokenId : [struck.toTokenId]) : [];
      ids.forEach((id, index) => {
        const tile = tiles[index] ?? tiles[0];
        const outcome = struck.outcomes?.[index];
        if (!id || !tile || outcome === "save" || outcome === "miss") {
          return;
        }
        const figure = frame.querySelector(`[data-fx-token="${CSS.escape(id)}"]`);
        const recoil = recoilFor(struck.from, tile, shake);
        if (!figure || !recoil) {
          return;
        }
        const timing = { duration: recoil.ms, delay, easing: "cubic-bezier(0.2, 0.9, 0.25, 1)" };
        figure.animate(
          [
            { translate: "0 0", rotate: "0deg" },
            { translate: `${recoil.dx}px ${recoil.dy}px`, rotate: `${recoil.deg}deg`, offset: 0.3 },
            { translate: "0 0", rotate: "0deg" },
          ],
          timing,
        );
        figure
          .querySelector("[data-health-ring]")
          ?.animate([{ strokeWidth: 2 }, { strokeWidth: 6, offset: 0.4 }, { strokeWidth: 2 }], timing);
      });
    }, []);
    const activeFx = useFxPlayer(fx, onFxPlayed, particlesRef, toCanvas, onShake);

    // The figure whose turn it is, for the spotlight and the gold ring.
    const currentToken = useMemo(() => {
      if (view.board !== "fight") {
        return null;
      }
      return (
        view.tokens.find((token) =>
          view.turn
            ? view.turn.tokenId === token.id
            : !token.down && currentName !== "" && token.name.toLowerCase() === currentName,
        ) ?? null
      );
    }, [view.board, view.tokens, view.turn, currentName]);
    const aimFrom = overlay?.aim ? view.tokens.find((token) => token.id === overlay.aim?.fromTokenId) : null;
    const spotToken = aimFrom ?? currentToken;
    const spotAt = spotToken ? tokenCentre(spotToken, view.tokenFootprint) : null;
    const boardSeed = useMemo(() => seedOf(view.mapId), [view.mapId]);

    // The terrain/fog/reachable cell layer only changes when the view
    // projection itself changes; token/light layers below stay cheap.
    const isPainted = Boolean(painted) && !view.backdrop;
    const cells = useMemo(() => buildCells(view, palette, isPainted), [view, palette, isPainted]);

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
      // A figure is a group; the click lands on its circle or portrait, so
      // the id is found on the nearest ancestor that carries it.
      const tokenId =
        target.dataset?.tokenId ??
        (target.closest?.("[data-token-id]") as SVGElement | null)?.dataset?.tokenId;
      return x !== undefined && y !== undefined
        ? { x: Number(x), y: Number(y), tokenId }
        : { x: null, y: null, tokenId };
    }

    function handleSvgClick(event: React.MouseEvent<SVGSVGElement>) {
      const pin = (event.target as SVGElement).closest?.("[data-label-index]") as SVGElement | null;
      if (pin?.dataset.labelIndex !== undefined && labelRef.current) {
        const label = view.labels[Number(pin.dataset.labelIndex)];
        if (label) {
          labelRef.current(label);
          return;
        }
      }
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

    function handleTokenHover(event: React.MouseEvent<SVGSVGElement>) {
      if (!tokenHoverRef.current) {
        return;
      }
      const figure = (event.target as SVGElement).closest?.("[data-token-id]") as SVGElement | null;
      const id = figure?.dataset.tokenId ?? null;
      // Reported only when it changes, so a moving pointer costs the parent
      // nothing while it stays on one figure.
      if (id !== hoveredTokenRef.current) {
        hoveredTokenRef.current = id;
        tokenHoverRef.current(id);
      }
    }

    function handleSvgMove(event: React.MouseEvent<SVGSVGElement>) {
      handleTokenHover(event);
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
      <div ref={frameRef} className="relative">
      <svg
        viewBox={`0 0 ${width * TILE} ${height * TILE}`}
        className="h-auto w-full select-none rounded-lg border border-stone-800 bg-stone-950"
        role="img"
        aria-label="Battle map"
        onClick={handleSvgClick}
        onPointerDown={(event) => {
          pointerTypeRef.current = event.pointerType;
        }}
        onMouseMove={onTileHover || onTokenHover ? handleSvgMove : undefined}
        onMouseLeave={
          onTileHover || onTokenHover
            ? () => {
                hoverRef.current?.(0, null);
                if (hoveredTokenRef.current !== null) {
                  hoveredTokenRef.current = null;
                  tokenHoverRef.current?.(null);
                }
              }
            : undefined
        }
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
          <StageDefs />
          <StageLayerDefs />
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
        ) : painted ? (
          // The painted board: the same layer, drawn from the terrain itself,
          // so it needs no register and no tint (render/painted.ts). The
          // canvas goes into the slot above, not through an image URL.
          <foreignObject x={0} y={0} width={width * TILE} height={height * TILE} pointerEvents="none">
            <div ref={paintedSlotRef} style={{ width: "100%", height: "100%" }} />
          </foreignObject>
        ) : null}
        {cells}
        {/* The DM's overlay, the annotated picture, in the backdrop's
            register. Only the DM's projection carries it. */}
        {view.overlayPath ? (
          <image
            href={view.overlayPath}
            {...(view.backdrop
              ? backdropRect(view.backdrop.transform, width, height, TILE)
              : { x: 0, y: 0, width: width * TILE, height: height * TILE })}
            opacity={0.85}
            preserveAspectRatio="none"
            pointerEvents="none"
          />
        ) : null}
        {catcher}
        {view.lights.map((light, index) => (
          <circle
            key={`light-${index}`}
            cx={light.x * TILE + TILE / 2}
            cy={light.y * TILE + TILE / 2}
            r={light.radius * TILE}
            fill="url(#torchglow)"
            pointerEvents="none"
            // Torchlight gutters; each torch on its own phase.
            className="board-torch"
            style={{ animationDelay: `${-((index * 1.3) % 4.1).toFixed(1)}s` }}
          />
        ))}
        {/* The stage dressing (BoardStageLayers.tsx): dust in the light, then
            the spotlight on whoever's turn it is, deepened while aiming. */}
        {view.board === "fight" ? <MoteLayer seed={boardSeed} width={width} height={height} /> : null}
        <TurnSpotlight at={spotAt} width={width} height={height} aiming={Boolean(overlay?.aim)} />
        {overlay?.aim ? <AimScrim width={width} height={height} /> : null}
        {/* The stage: auras under the figures, the figures, then the lines
            between attackers and their targets (BoardStage.tsx). */}
        <AuraLayer tokens={view.tokens} auras={view.tokenAuras} footprints={view.tokenFootprint} />
        {view.tokens.map((token) => {
          const isCurrent = view.turn
            ? view.turn.tokenId === token.id
            : !token.down && currentName !== "" && token.name.toLowerCase() === currentName;
          return (
            <TokenFigure
              key={token.id}
              token={token}
              // A prop the DM stamped from the catalogue shows that object's
              // painted art (public/assets/props/objects), not a letter.
              portrait={token.stamp ? `/assets/props/objects/${token.stamp}.webp` : portraitsByRef.get(token.refId)}
              footprint={view.tokenFootprint[token.id] ?? 1}
              health={view.tokenHealth[token.id]}
              conditions={view.tokenConditions[token.id]}
              elevation={view.tokenElevation[token.id]}
              isCurrent={isCurrent}
              held={overlay?.selectedTokenId === token.id}
              hp={view.tokenHp?.[token.id]}
              clickable={Boolean(onTokenClick)}
              showsNumbers={Boolean(view.tokenHp)}
              // Aiming at one figure: the others that could have been chosen
              // step back, so the eye follows the arc.
              dimmed={Boolean(
                overlay?.aim?.hoverId &&
                  overlay.aim.hoverId !== token.id &&
                  overlay.aim.targetIds.includes(token.id),
              )}
            />
          );
        })}
        <TargetLines tokens={view.tokens} targets={view.targets} footprints={view.tokenFootprint} />
        {overlay?.aim ? <AimLayer aim={overlay.aim} tokens={view.tokens} footprints={view.tokenFootprint} /> : null}
        <DrawingLayer drawings={view.drawings} sketch={overlay?.sketch} />
        {/* The scene layer (src/lib/battlemap/scene.ts): labels where the
            projection allows them, and for the DM the state of every shut
            door, as a badge on the door glyph they alone still see. */}
        {view.labels.map((label, index) => (
          <g
            key={`label-${label.x}-${label.y}`}
            pointerEvents={label.ref && onLabelClick ? "auto" : "none"}
            data-label-index={label.ref && onLabelClick ? index : undefined}
            className={cn(label.ref && onLabelClick && "cursor-pointer")}
          >
            {label.ref ? (
              // A pin: the label opens something when tapped.
              <path
                d={`M ${label.x * TILE + TILE / 2} ${label.y * TILE + TILE / 2 + 2} l -4 -6 a 4 4 0 1 1 8 0 z`}
                fill="#d4ab3a"
                stroke="#0c0a09"
                strokeWidth={1}
              />
            ) : (
              <circle
                cx={label.x * TILE + TILE / 2}
                cy={label.y * TILE + TILE / 2}
                r={3}
                fill={label.dmOnly ? "#a78bfa" : "#fbbf24"}
              />
            )}
            <text
              x={label.x * TILE + TILE / 2}
              y={label.y * TILE + TILE / 2 - 6}
              textAnchor="middle"
              fontSize={11}
              fill={label.dmOnly ? "#c4b5fd" : "#fde68a"}
              stroke="#000"
              strokeWidth={3}
              paintOrder="stroke"
              style={{ fontFamily: "sans-serif" }}
            >
              {label.text}
            </text>
          </g>
        ))}
        {view.doors
          ? Object.entries(view.doors).map(([key, state]) => {
              const [dx, dy] = key.split(",").map(Number);
              return (
                <g key={`door-${key}`} pointerEvents="none">
                  <rect
                    x={dx * TILE + TILE * 0.55}
                    y={dy * TILE + TILE * 0.05}
                    width={TILE * 0.4}
                    height={TILE * 0.4}
                    rx={2}
                    fill={state === "locked" ? "#f59e0b" : "#a78bfa"}
                  />
                  <text
                    x={dx * TILE + TILE * 0.75}
                    y={dy * TILE + TILE * 0.25 + 4}
                    textAnchor="middle"
                    fontSize={10}
                    fontWeight="bold"
                    fill="#0c0a09"
                    style={{ fontFamily: "sans-serif" }}
                  >
                    {state === "locked" ? "L" : "S"}
                  </text>
                </g>
              );
            })
          : null}
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
        <FxLayer active={activeFx} />
      </svg>
      <ParticleCanvas className="rounded-lg" onReady={onParticles} />
      </div>
    );
  },
  (prev, next) =>
    prev.view === next.view &&
    prev.sheets === next.sheets &&
    prev.painted === next.painted &&
    prev.faces === next.faces &&
    // The overlay is compared by reference, so a parent that rebuilds it
    // every render would defeat the memo. BattleMapPanel memoizes it.
    prev.overlay === next.overlay &&
    prev.fx === next.fx &&
    prev.everyTileClickable === next.everyTileClickable &&
    (prev.onLabelClick === undefined) === (next.onLabelClick === undefined) &&
    // Only presence matters; the handlers themselves are read through refs.
    (prev.onTileClick === undefined) === (next.onTileClick === undefined) &&
    (prev.onTileHover === undefined) === (next.onTileHover === undefined) &&
    (prev.onTokenClick === undefined) === (next.onTokenClick === undefined) &&
    (prev.onTokenHover === undefined) === (next.onTokenHover === undefined),
);
