"use client";

import { EmptyState } from "@/components/EmptyState";
import { useMemo, type KeyboardEvent } from "react";
import { cn } from "@/lib/cn";
import { layoutGraph } from "@/lib/npcs/graph-layout";
import type { RelationGraph as Graph } from "@/lib/npcs/forge";

// The cast's relationships drawn (docs/vtt-parity-implementation-plan.md
// 5.5): portrait discs on a seeded force layout, edges with a mid-label,
// mutual edges solid, one-sided edges dashed, a dangling name as a ghost.
// Tap a node to open the NPC. Pure SVG; nothing moves after the first
// frame, so it costs nothing while the panel is up.

const WIDTH = 640;
const HEIGHT = 420;
const RADIUS = 20;

function describe(score: number): string {
  return score >= 2 ? "close" : score >= 1 ? "friendly" : score <= -2 ? "hates" : score <= -1 ? "wary" : "knows";
}

export function RelationGraph({
  graph,
  portraits,
  factionOf,
  onOpen,
  className,
}: {
  graph: Graph;
  // Face by name, for the discs.
  portraits: Map<string, string>;
  // Faction name by NPC name, for the translucent hulls.
  factionOf?: Map<string, string>;
  onOpen: (name: string) => void;
  className?: string;
}) {
  const layout = useMemo(
    () =>
      new Map(
        layoutGraph({
          nodes: graph.nodes.map((node) => node.name),
          edges: graph.edges.map((edge) => ({ from: edge.from, to: edge.to })),
          width: WIDTH,
          height: HEIGHT,
          spacing: 84,
        }).map((node) => [node.id, node]),
      ),
    [graph],
  );
  if (!graph.nodes.length) {
    return <EmptyState size="sm" art="board" title="Write two people who know each other and the map draws itself." />;
  }
  // A faction's hull: a soft disc around its members' centre, wide enough
  // to hold them all (docs/vtt-parity-implementation-plan.md section 6).
  const hulls: Array<{ name: string; x: number; y: number; r: number }> = [];
  if (factionOf) {
    const groups = new Map<string, Array<{ x: number; y: number }>>();
    for (const [npc, faction] of factionOf) {
      const at = layout.get(npc);
      if (faction && at) {
        (groups.get(faction) ?? groups.set(faction, []).get(faction))!.push(at);
      }
    }
    for (const [name, points] of groups) {
      const cx = points.reduce((sum, point) => sum + point.x, 0) / points.length;
      const cy = points.reduce((sum, point) => sum + point.y, 0) / points.length;
      const r = Math.max(RADIUS * 2, ...points.map((point) => Math.hypot(point.x - cx, point.y - cy) + RADIUS * 1.6));
      hulls.push({ name, x: cx, y: cy, r });
    }
  }
  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      role="img"
      aria-label="Who knows whom"
      className={cn("panel w-full rounded-lg", className)}
    >
      <defs>
        {graph.nodes.map((node) => {
          const face = portraits.get(node.name);
          return face ? (
            <pattern key={node.name} id={`face-${slug(node.name)}`} patternUnits="objectBoundingBox" width="1" height="1">
              <image href={face} width={RADIUS * 2} height={RADIUS * 2} preserveAspectRatio="xMidYMid slice" />
            </pattern>
          ) : null;
        })}
      </defs>
      {hulls.map((hull) => (
        <g key={`hull-${hull.name}`}>
          <circle cx={hull.x} cy={hull.y} r={hull.r} fill="rgba(212, 171, 58, 0.06)" stroke="rgba(212, 171, 58, 0.35)" strokeDasharray="6 4" />
          <text x={hull.x} y={hull.y - hull.r + 12} textAnchor="middle" className="fill-amber-300/80 text-[9px] uppercase tracking-wide">
            {hull.name}
          </text>
        </g>
      ))}
      {graph.edges.map((edge) => {
        const a = layout.get(edge.from);
        const b = layout.get(edge.to);
        if (!a || !b) {
          return null;
        }
        const warm = edge.score > 0;
        const cold = edge.score < 0;
        return (
          <g key={`${edge.from}-${edge.to}`}>
            <line
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke={cold ? "#b91c1c" : warm ? "#d4ab3a" : "#57534e"}
              strokeWidth={1.5}
              strokeDasharray={edge.mutual ? undefined : "5 4"}
              opacity={0.8}
            />
            <text
              x={(a.x + b.x) / 2}
              y={(a.y + b.y) / 2 - 4}
              textAnchor="middle"
              className="fill-stone-400 text-[9px]"
            >
              {edge.note || describe(edge.score)}
              {edge.backScore !== undefined && edge.backScore !== edge.score ? ` / ${describe(edge.backScore)}` : ""}
            </text>
          </g>
        );
      })}
      {graph.nodes.map((node) => {
        const at = layout.get(node.name);
        if (!at) {
          return null;
        }
        const face = portraits.get(node.name);
        return (
          <g
            key={node.name}
            transform={`translate(${at.x} ${at.y})`}
            {...(node.known
              ? {
                  role: "button",
                  tabIndex: 0,
                  "aria-label": `Open ${node.name}`,
                  onClick: () => onOpen(node.name),
                  onKeyDown: (event: KeyboardEvent<SVGGElement>) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onOpen(node.name);
                    }
                  },
                }
              : { "aria-label": `${node.name} (unwritten)` })}
            className={cn(node.known ? "cursor-pointer" : "cursor-default")}
          >
            <circle
              r={RADIUS}
              fill={face ? `url(#face-${slug(node.name)})` : node.known ? "#1c1917" : "#0c0a09"}
              stroke={node.known ? "#d4ab3a" : "#57534e"}
              strokeWidth={node.known ? 1.5 : 1}
              strokeDasharray={node.known ? undefined : "3 3"}
            />
            {!face ? (
              <text textAnchor="middle" dominantBaseline="central" className="fill-amber-100 font-display text-[13px]">
                {node.name.charAt(0).toUpperCase()}
              </text>
            ) : null}
            <text y={RADIUS + 12} textAnchor="middle" className={cn("text-[10px]", node.known ? "fill-stone-200" : "fill-stone-500")}>
              {node.name.length > 16 ? `${node.name.slice(0, 15)}…` : node.name}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}
