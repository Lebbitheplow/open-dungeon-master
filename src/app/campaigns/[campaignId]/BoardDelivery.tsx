"use client";

import { TILE } from "@/app/campaigns/[campaignId]/battleMapCells";
import { boltPoints, ringSpecs, type Presentation } from "@/lib/battlemap/delivery";
import type { XY } from "@/lib/battlemap/types";

// How an effect arrives, drawn from one row of the delivery table
// (src/lib/battlemap/delivery.ts, docs/visual-overhaul-plan.md 5.5): the
// thing that crosses the gap, then what happens at the target on the impact
// beat. Every shape is a class in src/app/styles/board.css delayed by the
// row's own number, so nothing here keeps a clock. SVG units throughout.

type Point = XY;

const late = (ms: number): React.CSSProperties => ({ animationDelay: `${ms}ms` });

// The piece that travels: a lobbed ember, a thrown shard, a bolt that is
// simply there, a column from above, or a weapon's crescent.
export function deliveryTravel({
  plan,
  from,
  to,
  seed,
}: {
  plan: Presentation;
  from: Point | null;
  to: Point;
  seed: number;
}): React.ReactNode[] {
  const { row, tone } = plan;
  const nodes: React.ReactNode[] = [];
  if ((row.mode === "lob" || row.mode === "straight") && from) {
    const angle = (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI;
    const span = Math.hypot(to.x - from.x, to.y - from.y);
    nodes.push(
      <g
        key="proj"
        className="fx-proj"
        data-mode={row.mode}
        style={
          {
            "--px": `${to.x - from.x}px`,
            "--py": `${to.y - from.y}px`,
            "--arc": `${Math.min(TILE, span * 0.18).toFixed(1)}px`,
            "--fx-delay": `${row.delay}ms`,
          } as React.CSSProperties
        }
      >
        <g transform={`translate(${from.x} ${from.y}) rotate(${angle})`}>
          <rect x={-14} y={-1.2} width={14} height={2.4} rx={1.2} fill={tone.color} opacity={0.55} />
          <circle r={3.2} fill={tone.edge} />
          <circle r={5.5} fill={tone.color} opacity={0.35} filter="url(#fx-soft)" />
        </g>
      </g>,
    );
  }
  if (row.mode === "bolt") {
    // With nobody to strike from, the bolt comes down out of the dark.
    const origin = from ?? { x: to.x - TILE * 0.7, y: to.y - TILE * 3.2 };
    const d = boltPoints(seed, origin, to)
      .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`)
      .join(" ");
    nodes.push(
      <g key="bolt" className="fx-bolt">
        <path d={d} fill="none" stroke={tone.color} strokeWidth={6} strokeLinejoin="round" opacity={0.3} filter="url(#fx-soft)" />
        <path d={d} fill="none" stroke={tone.edge} strokeWidth={1.6} strokeLinejoin="round" />
      </g>,
    );
  }
  if (row.mode === "beam") {
    const height = TILE * 4.5;
    nodes.push(
      <g key="beam">
        <linearGradient id={`beam-${seed}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={tone.color} stopOpacity={0} />
          <stop offset="40%" stopColor={tone.color} stopOpacity={0.8} />
          <stop offset="100%" stopColor={tone.edge} stopOpacity={0.95} />
        </linearGradient>
        <rect
          x={to.x - TILE * 0.3}
          y={to.y + TILE * 0.35 - height}
          width={TILE * 0.6}
          height={height}
          fill={`url(#beam-${seed})`}
          filter="url(#fx-soft)"
          className="fx-beam"
          style={late(Math.max(0, row.delay - 90))}
        />
      </g>,
    );
  }
  if (row.mode === "swing") {
    // A crescent across the target's near edge, facing the attacker.
    const angle = from ? Math.atan2(to.y - from.y, to.x - from.x) : -Math.PI / 2;
    const r = TILE * 0.62;
    const a0 = angle - 0.95;
    const a1 = angle + 0.95;
    const sx = to.x - Math.cos(a0) * r;
    const sy = to.y - Math.sin(a0) * r;
    const ex = to.x - Math.cos(a1) * r;
    const ey = to.y - Math.sin(a1) * r;
    const landed = plan.landing !== "none";
    nodes.push(
      <path
        key="swing"
        d={`M ${sx} ${sy} A ${r} ${r} 0 0 1 ${ex} ${ey}`}
        fill="none"
        stroke={landed ? tone.edge : "#d6cfc2"}
        strokeOpacity={landed ? 0.95 : 0.5}
        strokeWidth={landed ? 3.5 : 2}
        strokeLinecap="round"
        filter="url(#fx-soft)"
        className="fx-swing"
        style={{ transformOrigin: `${to.x}px ${to.y}px`, ...late(Math.max(0, row.delay - 110)) }}
      />,
    );
  }
  return nodes;
}

// What happens where it lands: the rim flash, the rings of a ring family,
// and the frost cold leaves behind.
export function deliveryImpact({ plan, to }: { plan: Presentation; to: Point }): React.ReactNode[] {
  const { row, tone } = plan;
  const nodes: React.ReactNode[] = [];
  if (plan.flash) {
    nodes.push(
      <circle
        key="flash"
        cx={to.x}
        cy={to.y}
        r={TILE / 2 - 1}
        fill={plan.flash.color}
        className="fx-hit-flash"
        style={{ mixBlendMode: "screen", ...late(plan.flash.at) }}
      />,
      <circle
        key="rim"
        cx={to.x}
        cy={to.y}
        r={TILE / 2 - 2}
        fill="none"
        stroke={plan.flash.color}
        strokeWidth={2.5}
        className="fx-flash"
        style={late(plan.flash.at)}
      />,
    );
  }
  for (const [index, ring] of ringSpecs(plan.rings).entries()) {
    nodes.push(
      <circle
        key={`ring-${index}`}
        cx={to.x}
        cy={to.y}
        r={ring.scale * TILE}
        fill="none"
        stroke={ring.edge ? tone.edge : tone.color}
        strokeWidth={2}
        className="fx-ring"
        style={{ animationDuration: `${ring.life}ms`, ...late(row.delay + ring.delay) }}
      />,
    );
  }
  if (plan.freeze) {
    nodes.push(
      <circle
        key="frost"
        cx={to.x}
        cy={to.y}
        r={TILE / 2 - 2}
        fill="#9fe3f5"
        className="fx-frost"
        style={late(row.delay)}
      />,
    );
  }
  return nodes;
}

// The miss chip: the word pops on the target at a tilt and stays for the
// effect's hold, so a whiff reads as clearly as a hit.
export function MissChip({ at, text, delay }: { at: Point; text: string; delay: number }) {
  const width = text.length * 5.4 + 10;
  return (
    <g className="board-miss" style={late(delay)}>
      <rect
        x={at.x - width / 2}
        y={at.y - TILE / 2 - 13}
        width={width}
        height={12}
        rx={3}
        fill="#080612"
        fillOpacity={0.9}
        stroke="#8f8aab"
        strokeOpacity={0.6}
        strokeWidth={0.75}
      />
      <text
        x={at.x}
        y={at.y - TILE / 2 - 4.2}
        textAnchor="middle"
        fontSize={8}
        fontWeight={700}
        fill="#d6cfc2"
        style={{ fontFamily: "var(--font-display), serif", letterSpacing: "0.12em", textTransform: "uppercase" }}
      >
        {text}
      </text>
    </g>
  );
}
