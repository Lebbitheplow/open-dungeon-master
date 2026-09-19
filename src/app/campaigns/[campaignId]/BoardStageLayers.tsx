"use client";

import { memo } from "react";
import { TILE } from "@/app/campaigns/[campaignId]/battleMapCells";
import { seededUnit } from "@/lib/battlemap/delivery";
import type { StageToken } from "@/app/campaigns/[campaignId]/BoardStage";
import type { PlayerMapView } from "@/lib/battlemap/view";

// The stage dressing of the live board (docs/visual-overhaul-plan.md 5.1):
// the spotlight that follows the turn, the dust in the torchlight, and the
// aim layer (scrim, range ring, reticles, the ember arc) while a target is
// being chosen. Pure SVG inside the grid; nothing here decides a rule. The
// loops are CSS (src/app/styles/board.css) and stop under low effects.

export function tokenCentre(token: StageToken, footprints: PlayerMapView["tokenFootprint"]) {
  const footprint = footprints[token.id] ?? 1;
  return {
    x: token.x * TILE + (footprint * TILE) / 2,
    y: token.y * TILE + (footprint * TILE) / 2,
    footprint,
  };
}

export const StageLayerDefs = memo(function StageLayerDefs() {
  return (
    <>
      <radialGradient id="turn-spot">
        <stop offset="0%" stopColor="#000" stopOpacity={0} />
        <stop offset="34%" stopColor="#000" stopOpacity={0} />
        <stop offset="100%" stopColor="#000" stopOpacity={0.42} />
      </radialGradient>
      <radialGradient id="aim-spot">
        <stop offset="0%" stopColor="#000" stopOpacity={0} />
        <stop offset="30%" stopColor="#000" stopOpacity={0} />
        <stop offset="100%" stopColor="#000" stopOpacity={0.78} />
      </radialGradient>
      <marker id="aim-head" viewBox="0 0 10 10" refX={8} refY={5} markerWidth={7} markerHeight={7} orient="auto-start-reverse">
        <path d="M 0 0 L 10 5 L 0 10 z" fill="#ff9d5c" />
      </marker>
    </>
  );
});

// The spotlight: one oversized rect with a fixed gradient, slid so its centre
// sits on the figure whose turn it is. Sliding a transform is a transition;
// re-centring a gradient would be a redraw with no in-between.
export const TurnSpotlight = memo(function TurnSpotlight({
  at,
  width,
  height,
  aiming,
}: {
  at: { x: number; y: number } | null;
  width: number;
  height: number;
  aiming: boolean;
}) {
  if (!at) {
    return null;
  }
  const w = width * TILE;
  const h = height * TILE;
  const span = Math.max(w, h) * 2.2;
  return (
    <rect
      x={-span / 2}
      y={-span / 2}
      width={span}
      height={span}
      fill={aiming ? "url(#aim-spot)" : "url(#turn-spot)"}
      pointerEvents="none"
      className="board-spot"
      style={{ transform: `translate(${at.x}px, ${at.y}px)` }}
      data-layer="spotlight"
    />
  );
});

const MOTE_COUNT = 18;

// Dust in the light: eighteen motes on a CSS clock, placed from the board's
// id so they do not jump when the view re-renders.
export const MoteLayer = memo(function MoteLayer({
  seed,
  width,
  height,
}: {
  seed: number;
  width: number;
  height: number;
}) {
  const w = width * TILE;
  const h = height * TILE;
  return (
    <g pointerEvents="none" data-layer="motes">
      {Array.from({ length: MOTE_COUNT }, (_, i) => {
        const x = seededUnit(seed, i, 1) * w;
        const y = h * 0.2 + seededUnit(seed, i, 2) * h * 0.8;
        const dur = 7 + seededUnit(seed, i, 3) * 8;
        return (
          <circle
            key={i}
            cx={x}
            cy={y}
            r={0.8 + seededUnit(seed, i, 4) * 1.2}
            fill="#f4e0a6"
            fillOpacity={0.16}
            className="board-mote"
            style={
              {
                animationDuration: `${dur.toFixed(1)}s`,
                animationDelay: `${(-seededUnit(seed, i, 5) * dur).toFixed(1)}s`,
                "--dx": `${(seededUnit(seed, i, 6) * 24 - 12).toFixed(0)}px`,
                "--dy": `${(-30 - seededUnit(seed, i, 7) * 40).toFixed(0)}px`,
              } as React.CSSProperties
            }
          />
        );
      })}
    </g>
  );
});

// What is being aimed: who is aiming, who may be chosen, which of them the
// pointer is on, and (when the held card knows it) how far it reaches and
// what to print over each target. The board draws it and decides nothing.
export type AimOverlay = {
  fromTokenId: string;
  targetIds: string[];
  hoverId?: string | null;
  rangeTiles?: number;
  labels?: Record<string, string>;
};

function reticleTicks(cx: number, cy: number, r: number): string {
  const inner = r - 3;
  const outer = r + 5;
  return [0, 1, 2, 3]
    .map((i) => {
      const a = (i * Math.PI) / 2;
      return `M ${cx + Math.cos(a) * inner} ${cy + Math.sin(a) * inner} L ${cx + Math.cos(a) * outer} ${cy + Math.sin(a) * outer}`;
    })
    .join(" ");
}

export const AimLayer = memo(function AimLayer({
  aim,
  tokens,
  footprints,
}: {
  aim: AimOverlay;
  tokens: StageToken[];
  footprints: PlayerMapView["tokenFootprint"];
}) {
  const byId = new Map(tokens.map((token) => [token.id, token]));
  const from = byId.get(aim.fromTokenId);
  if (!from) {
    return null;
  }
  const origin = tokenCentre(from, footprints);
  const hovered = aim.hoverId ? byId.get(aim.hoverId) : undefined;
  const nodes: React.ReactNode[] = [];
  if (aim.rangeTiles) {
    nodes.push(
      <circle
        key="range"
        cx={origin.x}
        cy={origin.y}
        r={aim.rangeTiles * TILE + TILE / 2}
        fill="none"
        stroke="#d4ab3a"
        strokeOpacity={0.38}
        strokeWidth={1.5}
        strokeDasharray="7 7"
        className="board-spot"
      />,
    );
  }
  aim.targetIds.forEach((id, index) => {
    const token = byId.get(id);
    if (!token) {
      return;
    }
    const c = tokenCentre(token, footprints);
    // 64 px on the mockup's 32 px tile, 84 px for a large footprint.
    const r = c.footprint > 1 ? (c.footprint * TILE) / 2 + 5 : TILE / 2 + 4;
    const lit = aim.hoverId === id;
    const label = aim.labels?.[id];
    nodes.push(
      <g key={`ret-${id}`} className="fx-pop" style={{ animationDelay: `${index * 40}ms`, transformOrigin: `${c.x}px ${c.y}px` }}>
        <circle
          cx={c.x}
          cy={c.y}
          r={r}
          fill="none"
          stroke="#e0703a"
          strokeWidth={lit ? 2.5 : 2}
          strokeOpacity={lit ? 1 : 0.75}
          strokeDasharray="4 5"
          className="board-reticle"
        />
        <path d={reticleTicks(c.x, c.y, r)} stroke="#ff9d5c" strokeWidth={2} strokeLinecap="round" fill="none" />
        {label ? (
          <text
            x={c.x}
            y={c.y - r - 6}
            textAnchor="middle"
            fontSize={8}
            fill="#ffbe8f"
            stroke="#080612"
            strokeWidth={3}
            paintOrder="stroke"
            style={{ fontFamily: "var(--font-mono), monospace" }}
          >
            {label}
          </text>
        ) : null}
      </g>,
    );
  });
  if (hovered) {
    const to = tokenCentre(hovered, footprints);
    const span = Math.hypot(to.x - origin.x, to.y - origin.y);
    const mx = (origin.x + to.x) / 2;
    const my = (origin.y + to.y) / 2 - span * 0.22;
    const d = `M ${origin.x} ${origin.y} Q ${mx} ${my} ${to.x} ${to.y}`;
    // A soft cone of attention from the aimer to whoever is under the
    // pointer. Keyed by the target so it fades in again when the aim moves.
    const angle = Math.atan2(to.y - origin.y, to.x - origin.x);
    const far = span + TILE * 0.8;
    const edge = (a: number) => `${(origin.x + Math.cos(a) * far).toFixed(1)} ${(origin.y + Math.sin(a) * far).toFixed(1)}`;
    nodes.unshift(
      <path
        key={`cone-${hovered.id}`}
        d={`M ${origin.x} ${origin.y} L ${edge(angle - 0.26)} L ${edge(angle + 0.26)} Z`}
        fill="#ffbe8f"
        className="board-cone"
      />,
    );
    nodes.push(
      <g key="arc">
        <path d={d} fill="none" stroke="#e0703a" strokeOpacity={0.25} strokeWidth={9} strokeLinecap="round" filter="url(#fx-soft)" />
        <path
          d={d}
          fill="none"
          stroke="#ff9d5c"
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeDasharray="10 6"
          className="board-arrow"
          markerEnd="url(#aim-head)"
        />
      </g>,
    );
  }
  return (
    <g pointerEvents="none" data-layer="aim">
      {nodes}
    </g>
  );
});

// The dim under the figures while aiming, so the ground recedes and the
// figures that may be chosen do not.
export function AimScrim({ width, height }: { width: number; height: number }) {
  return (
    <rect
      x={0}
      y={0}
      width={width * TILE}
      height={height * TILE}
      fill="#07050f"
      // fillOpacity, not opacity: the fade-in animates opacity to one.
      fillOpacity={0.3}
      pointerEvents="none"
      className="board-spot"
      style={{ animationDuration: "var(--dur-quick)" }}
    />
  );
}
