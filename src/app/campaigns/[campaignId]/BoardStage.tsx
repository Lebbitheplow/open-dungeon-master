"use client";

import { memo } from "react";
import { cn } from "@/lib/cn";
import { TILE } from "@/app/campaigns/[campaignId]/battleMapCells";
import {
  CONDITION_GLYPHS,
  GLYPH_TONE_COLOR,
  glyphFor,
  MAX_BADGES,
} from "@/lib/battlemap/condition-glyphs";
import { HEALTH_RING, type HealthWord } from "@/lib/battlemap/health-words";
import type { Footprint } from "@/lib/battlemap/footprint";
import type { MapDrawing } from "@/lib/battlemap/scene";
import type { PlayerMapView } from "@/lib/battlemap/view";

// The stage layer of the live board (docs/vtt-parity-implementation-plan.md
// section 1.2): every figure with its footprint, health ring, condition
// badges, elevation and turn marker, the auras under them and the target
// lines over them. Pure SVG over the projection; nothing here decides a
// rule, and every mark states a fact the server sent.
//
// Tokens are positioned by a CSS transform on their group and keyed by id,
// so a move is a transition (`.token-move`, --dur-move with --ease-settle)
// rather than a redraw, and a token that leaves the board simply unmounts.

export type StageToken = PlayerMapView["tokens"][number];

const AURA_TONE: Record<string, string> = {
  ward: "#7fb8e6",
  harm: "#e0703a",
  bless: "#d4ab3a",
  neutral: "#d6cfc2",
};

// One <symbol> per condition glyph, referenced by <use> from every badge so
// forty tokens cost forty references and one set of paths; one clip circle
// per footprint size for the portraits; the gold glow behind the turn ring.
export const StageDefs = memo(function StageDefs() {
  return (
    <>
      {Object.values(CONDITION_GLYPHS).map((glyph) => (
        <symbol key={glyph.id} id={`cond-${glyph.id}`} viewBox="0 0 16 16">
          <path
            d={glyph.path}
            fill="none"
            stroke="currentColor"
            strokeWidth={1.6}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </symbol>
      ))}
      <symbol id="cond-effect" viewBox="0 0 16 16">
        <path
          d="M8 2a6 6 0 1 0 0 12A6 6 0 0 0 8 2zM8 5v4M8 11v.5"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.6}
          strokeLinecap="round"
        />
      </symbol>
      {([1, 2, 3, 4] as Footprint[]).map((footprint) => (
        <clipPath key={footprint} id={`token-clip-${footprint}`}>
          <circle
            cx={(footprint * TILE) / 2}
            cy={(footprint * TILE) / 2}
            r={(footprint * TILE) / 2 - 4}
          />
        </clipPath>
      ))}
      <filter id="turn-glow" x="-40%" y="-40%" width="180%" height="180%">
        <feGaussianBlur stdDeviation={3} result="blur" />
        <feColorMatrix
          in="blur"
          type="matrix"
          values="0 0 0 0 0.83  0 0 0 0 0.67  0 0 0 0 0.23  0 0 0 0.7 0"
          result="glow"
        />
        <feMerge>
          <feMergeNode in="glow" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
      <filter id="fx-soft" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation={1.5} />
      </filter>
    </>
  );
});

// Auras sit under the tokens: a ring at the effect's reach in its tone,
// breathing slowly (`.aura-ring`). Two on one token stack outward.
export const AuraLayer = memo(function AuraLayer({
  tokens,
  auras,
  footprints,
}: {
  tokens: StageToken[];
  auras: PlayerMapView["tokenAuras"];
  footprints: PlayerMapView["tokenFootprint"];
}) {
  const rings: React.ReactNode[] = [];
  for (const token of tokens) {
    const list = auras[token.id];
    if (!list?.length) {
      continue;
    }
    const footprint = footprints[token.id] ?? 1;
    const cx = token.x * TILE + (footprint * TILE) / 2;
    const cy = token.y * TILE + (footprint * TILE) / 2;
    list.forEach((aura, index) => {
      const color = AURA_TONE[aura.tone] ?? AURA_TONE.neutral;
      // The reach is measured from the creature's edge, so the ring adds
      // half the footprint to the radius.
      const radius = (aura.radiusFeet / 5) * TILE + (footprint * TILE) / 2 + index * 2;
      rings.push(
        <circle
          key={`${token.id}-${aura.id}`}
          cx={cx}
          cy={cy}
          r={radius}
          fill={color}
          fillOpacity={0.08}
          stroke={color}
          strokeOpacity={0.55}
          strokeWidth={1.5}
          className="aura-ring"
          pointerEvents="none"
        />,
      );
    });
  }
  return rings.length ? <g data-layer="auras">{rings}</g> : null;
});

// A hairline from each attacker to each of its targets this round: ember
// when an enemy is attacking, gold when the party is.
export const TargetLines = memo(function TargetLines({
  tokens,
  targets,
  footprints,
}: {
  tokens: StageToken[];
  targets: PlayerMapView["targets"];
  footprints: PlayerMapView["tokenFootprint"];
}) {
  const byId = new Map(tokens.map((token) => [token.id, token]));
  const lines: React.ReactNode[] = [];
  const centre = (token: StageToken) => {
    const footprint = footprints[token.id] ?? 1;
    return {
      x: token.x * TILE + (footprint * TILE) / 2,
      y: token.y * TILE + (footprint * TILE) / 2,
    };
  };
  for (const [attackerId, targetIds] of Object.entries(targets)) {
    const attacker = byId.get(attackerId);
    if (!attacker) {
      continue;
    }
    const from = centre(attacker);
    const color = attacker.kind === "enemy" ? "#e0703a" : "#d4ab3a";
    for (const targetId of targetIds) {
      const target = byId.get(targetId);
      if (!target) {
        continue;
      }
      const to = centre(target);
      lines.push(
        <line
          key={`${attackerId}-${targetId}`}
          x1={from.x}
          y1={from.y}
          x2={to.x}
          y2={to.y}
          stroke={color}
          strokeOpacity={0.45}
          strokeWidth={1}
          strokeDasharray="2 3"
          pointerEvents="none"
        />,
      );
    }
  }
  return lines.length ? <g data-layer="targets">{lines}</g> : null;
});

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

export type TokenFigureProps = {
  token: StageToken;
  portrait?: string;
  footprint: Footprint;
  health?: HealthWord;
  conditions?: Array<{ id: string; label: string; rounds?: number }>;
  elevation?: "flying" | "burrowing";
  isCurrent: boolean;
  held: boolean;
  hp?: { current: number; max: number };
  // Tapped by the parent's delegated click handler when set.
  clickable: boolean;
  // Whether this seat sees real numbers; the health ring is for everyone
  // else, and for the DM too when there is no bar.
  showsNumbers: boolean;
};

// One figure. Drawn in its own coordinate space (0,0 is the top-left of
// its anchor tile) and placed by the transform on the group, so moving it
// animates and the drawing code never thinks about where it is.
export const TokenFigure = memo(function TokenFigure({
  token,
  portrait,
  footprint,
  health,
  conditions,
  elevation,
  isCurrent,
  held,
  hp,
  clickable,
  showsNumbers,
}: TokenFigureProps) {
  const size = footprint * TILE;
  const cx = size / 2;
  const cy = size / 2;
  const radius = size / 2 - 3;
  const dead = health === "dead";
  const down = token.down || health === "down";
  const ring = down
    ? "#57534e"
    : held || token.mine
      ? "#fbbf24"
      : RING_BY_KIND[token.kind];
  const healthColor = health ? HEALTH_RING[health] : null;
  const badges = (conditions ?? []).slice(0, MAX_BADGES);
  const extra = (conditions ?? []).length - badges.length;
  const lift = elevation === "flying" ? -3 : 0;
  const title = [
    token.name,
    health ? health.replace(/^\w/, (c) => c.toUpperCase()) : null,
    ...(conditions ?? []).map((c) => (c.rounds ? `${c.label} (${c.rounds})` : c.label)),
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <g
      pointerEvents={clickable ? "auto" : "none"}
      data-token-id={clickable ? token.id : undefined}
      className={cn("token-move", clickable && "cursor-pointer")}
      style={{ transform: `translate(${token.x * TILE}px, ${token.y * TILE}px)` }}
      opacity={dead ? 0.55 : down ? 0.75 : token.hidden ? 0.55 : 1}
    >
      <title>{title}</title>
      {/* Ground shadow: wider and softer when the figure is in the air. */}
      <ellipse
        cx={cx}
        cy={cy + size / 2 - 5}
        rx={elevation === "flying" ? size / 2.2 : size / 2.6}
        ry={elevation === "flying" ? 4.5 : 3.5}
        fill="#000"
        opacity={elevation === "flying" ? 0.22 : 0.35}
        pointerEvents="none"
      />
      <g style={{ transform: `translateY(${lift}px)` }}>
        {/* Footprint plate for anything larger than one square. */}
        {footprint > 1 ? (
          <rect
            x={2}
            y={2}
            width={size - 4}
            height={size - 4}
            rx={8}
            fill={FILL_BY_KIND[token.kind]}
            fillOpacity={0.55}
            stroke={ring}
            strokeOpacity={0.5}
            strokeWidth={1}
            strokeDasharray={elevation === "burrowing" ? "3 2" : undefined}
          />
        ) : null}
        {/* The current turn: a gold ring with a slow walking dash and a soft
            glow behind it. The only loop on a token. */}
        {isCurrent && !down ? (
          <circle
            cx={cx}
            cy={cy}
            r={radius + 3}
            fill="none"
            stroke="#d4ab3a"
            strokeWidth={2}
            strokeDasharray="6 6"
            className="turn-ring"
            filter="url(#turn-glow)"
            pointerEvents="none"
          />
        ) : null}
        {token.kind === "prop" ? (
          <rect
            x={4}
            y={4}
            width={size - 8}
            height={size - 8}
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
            r={radius}
            fill={FILL_BY_KIND[token.kind]}
            stroke={ring}
            strokeWidth={token.mine || held ? 2.5 : 1.5}
            strokeDasharray={token.hidden || elevation === "burrowing" ? "3 2" : undefined}
          />
        )}
        {portrait ? (
          <image
            href={portrait}
            x={4}
            y={4}
            width={size - 8}
            height={size - 8}
            preserveAspectRatio="xMidYMid slice"
            clipPath={`url(#token-clip-${footprint})`}
            opacity={down ? 0.45 : 1}
            style={dead ? { filter: "grayscale(1)" } : undefined}
          />
        ) : (
          <text
            x={cx}
            y={cy + 4.5 * Math.min(2, footprint)}
            textAnchor="middle"
            fontSize={13 * Math.min(2, footprint)}
            fontWeight={700}
            fill={down ? "#a8a29e" : token.kind === "enemy" ? "#fca5a5" : "#e7e5e4"}
          >
            {token.name.charAt(0).toUpperCase()}
          </text>
        )}
        {/* The health ring: a word as a colour for everyone; the DM seat
            keeps the bar below and gets the ring too. Down is a dashed grey. */}
        {healthColor && token.kind !== "prop" && !dead ? (
          <circle
            cx={cx}
            cy={cy}
            r={radius}
            fill="none"
            stroke={healthColor}
            strokeWidth={2}
            strokeDasharray={down ? "3 3" : undefined}
            strokeOpacity={0.9}
            pointerEvents="none"
            style={{ transition: "stroke var(--dur-beat) var(--ease-snap)" }}
          />
        ) : null}
        {down ? (
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
        {/* Real hit points, DM projection only (src/lib/battlemap/view.ts). */}
        {showsNumbers && hp && hp.max > 0 ? (
          <g pointerEvents="none">
            <rect x={4} y={size - 6} width={size - 8} height={3} rx={1.5} fill="#0c0a09" opacity={0.85} />
            <rect
              x={4}
              y={size - 6}
              width={Math.max(0, Math.min(1, hp.current / hp.max)) * (size - 8)}
              height={3}
              rx={1.5}
              fill={hp.current / hp.max > 0.5 ? "#4ade80" : hp.current / hp.max > 0.25 ? "#facc15" : "#ef4444"}
              style={{ transition: "width var(--dur-beat) var(--ease-settle)" }}
            />
          </g>
        ) : null}
        {/* Condition badges along the lower edge, four at most, then a count. */}
        {badges.length ? (
          <g pointerEvents="none">
            {badges.map((condition, index) => {
              const glyph = glyphFor(condition.label);
              const badgeSize = 12;
              const total = badges.length + (extra > 0 ? 1 : 0);
              const startX = cx - (total * (badgeSize + 1)) / 2;
              const bx = startX + index * (badgeSize + 1);
              const by = size - badgeSize - (showsNumbers && hp ? 8 : 4);
              return (
                <g key={`${condition.id}-${index}`} className="fx-pop">
                  <circle
                    cx={bx + badgeSize / 2}
                    cy={by + badgeSize / 2}
                    r={badgeSize / 2 + 1}
                    fill="#0c0a09"
                    fillOpacity={0.9}
                    stroke={GLYPH_TONE_COLOR[glyph.tone]}
                    strokeOpacity={0.6}
                    strokeWidth={0.75}
                  />
                  <use
                    href={`#cond-${glyph.id}`}
                    x={bx + 1.5}
                    y={by + 1.5}
                    width={badgeSize - 3}
                    height={badgeSize - 3}
                    color={GLYPH_TONE_COLOR[glyph.tone]}
                  />
                </g>
              );
            })}
            {extra > 0 ? (
              <text
                x={cx + (badges.length * 13) / 2 + 4}
                y={size - 6}
                fontSize={8}
                fontWeight={700}
                fill="#e7e5e4"
                textAnchor="middle"
              >
                +{extra}
              </text>
            ) : null}
          </g>
        ) : null}
        {/* Elevation glyph: a wing when flying, a mound when burrowing. */}
        {elevation ? (
          <use
            href={`#cond-${elevation}`}
            x={size - 13}
            y={2}
            width={11}
            height={11}
            color="#d6cfc2"
            pointerEvents="none"
          />
        ) : null}
        {token.hidden ? (
          <text x={size - 5} y={9} textAnchor="middle" fontSize={9} fill="#fbbf24" pointerEvents="none">
            ●
          </text>
        ) : null}
      </g>
    </g>
  );
});

// Freehand marks (docs/vtt-parity-implementation-plan.md section 3.6): a
// soft 2 px line with a 6 px halo at twenty percent in the author's tone.
// The sketch in progress is drawn the same way so what you see is what
// lands. Points are tile units; the layer scales them here.
export const DRAWING_TONE: Record<MapDrawing["tone"], string> = {
  gold: "#d4ab3a",
  ember: "#e0703a",
  sky: "#7fb8e6",
  moss: "#7ed6a4",
  bone: "#d6cfc2",
};

function drawingPath(drawing: Pick<MapDrawing, "kind" | "points">): React.ReactNode {
  const pts = drawing.points.map((p) => ({ x: p.x * TILE, y: p.y * TILE }));
  if (pts.length < 2) {
    return null;
  }
  if (drawing.kind === "stroke") {
    const d = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
    return <path d={d} fill="none" strokeLinecap="round" strokeLinejoin="round" />;
  }
  const a = pts[0];
  const b = pts[pts.length - 1];
  if (drawing.kind === "rect") {
    return (
      <rect
        x={Math.min(a.x, b.x)}
        y={Math.min(a.y, b.y)}
        width={Math.abs(b.x - a.x)}
        height={Math.abs(b.y - a.y)}
        rx={4}
        fill="none"
      />
    );
  }
  if (drawing.kind === "ellipse") {
    return (
      <ellipse
        cx={(a.x + b.x) / 2}
        cy={(a.y + b.y) / 2}
        rx={Math.abs(b.x - a.x) / 2}
        ry={Math.abs(b.y - a.y) / 2}
        fill="none"
      />
    );
  }
  // An arrow: the shaft and a small head.
  const angle = Math.atan2(b.y - a.y, b.x - a.x);
  const head = 9;
  const hx1 = b.x - Math.cos(angle - 0.5) * head;
  const hy1 = b.y - Math.sin(angle - 0.5) * head;
  const hx2 = b.x - Math.cos(angle + 0.5) * head;
  const hy2 = b.y - Math.sin(angle + 0.5) * head;
  return (
    <path
      d={`M ${a.x} ${a.y} L ${b.x} ${b.y} M ${hx1} ${hy1} L ${b.x} ${b.y} L ${hx2} ${hy2}`}
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  );
}

export const DrawingLayer = memo(function DrawingLayer({
  drawings,
  sketch,
}: {
  drawings: MapDrawing[];
  sketch?: Pick<MapDrawing, "kind" | "points" | "tone"> | null;
}) {
  const all = sketch && sketch.points.length >= 2 ? [...drawings, { ...sketch, id: "sketch", dmOnly: false }] : drawings;
  if (!all.length) {
    return null;
  }
  return (
    <g data-layer="drawings" pointerEvents="none">
      {all.map((drawing) => {
        const color = DRAWING_TONE[drawing.tone] ?? DRAWING_TONE.gold;
        const shape = drawingPath(drawing);
        if (!shape) {
          return null;
        }
        return (
          <g key={drawing.id} className={drawing.id === "sketch" ? undefined : "fx-pop"}>
            <g stroke={color} strokeOpacity={0.2} strokeWidth={6}>
              {shape}
            </g>
            <g stroke={color} strokeOpacity={drawing.dmOnly ? 0.7 : 0.95} strokeWidth={2} strokeDasharray={drawing.dmOnly ? "5 3" : undefined}>
              {shape}
            </g>
          </g>
        );
      })}
    </g>
  );
});
