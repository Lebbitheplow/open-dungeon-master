"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import { TILE } from "@/app/campaigns/[campaignId]/battleMapCells";
import type { ViewZone } from "@/lib/dm/zone-view";

// Spell areas on the live board (src/lib/battlemap/zones.ts): a web, a fog
// cloud, a wall of fire, Spirit Guardians' ring. Drawn under the figures and
// over the ground, each in its own look: a cloud is a soft drifting fill, a
// wall a glowing band, magical darkness a slow black, difficult ground a
// hatched tint, a ward a tint with a flowing edge. An area settles in when it
// is cast and fades out when it ends (the last frame is kept a beat so the
// fade plays). Nothing here decides a rule: the server sent the squares.

export const TONE: Record<ViewZone["tone"], string> = {
  fire: "#e0703a",
  frost: "#9fd3f0",
  gloom: "#1a1428",
  fog: "#cfd6de",
  storm: "#8fb7d9",
  nature: "#7fae55",
  radiant: "#f2d27a",
  force: "#b9a3f0",
  stone: "#c9b58c",
  poison: "#9bc16a",
  hush: "#8aa0b8",
  blade: "#e3ddd2",
};

// How long an ended area stays on screen while it fades (--dur-beat).
const EXIT_MS = 420;

// The outline of a set of squares: every edge with no square of the set on
// its other side, as one path.
export function outline(cells: number[], width: number): string {
  const set = new Set(cells);
  const parts: string[] = [];
  for (const cell of cells) {
    const x = (cell % width) * TILE;
    const y = Math.floor(cell / width) * TILE;
    const col = cell % width;
    if (!set.has(cell - width)) {
      parts.push(`M${x} ${y}h${TILE}`);
    }
    if (!set.has(cell + width)) {
      parts.push(`M${x} ${y + TILE}h${TILE}`);
    }
    if (col === 0 || !set.has(cell - 1)) {
      parts.push(`M${x} ${y}v${TILE}`);
    }
    if (col === width - 1 || !set.has(cell + 1)) {
      parts.push(`M${x + TILE} ${y}v${TILE}`);
    }
  }
  return parts.join("");
}

// The squares as one path of unit boxes, so a fill is one element.
export function area(cells: number[], width: number): string {
  return cells
    .map((cell) => `M${(cell % width) * TILE} ${Math.floor(cell / width) * TILE}h${TILE}v${TILE}h${-TILE}z`)
    .join("");
}

function centre(cells: number[], width: number): { x: number; y: number } {
  const xs = cells.map((cell) => (cell % width) * TILE + TILE / 2);
  const ys = cells.map((cell) => Math.floor(cell / width) * TILE + TILE / 2);
  return {
    x: (Math.min(...xs) + Math.max(...xs)) / 2,
    y: (Math.min(...ys) + Math.max(...ys)) / 2,
  };
}

// The zones on screen: the live ones, and the ones that just ended for as
// long as their fade lasts.
function useLeaving(zones: ViewZone[]): Array<ViewZone & { leaving?: boolean }> {
  const [leaving, setLeaving] = useState<ViewZone[]>([]);
  const previous = useRef<ViewZone[]>(zones);
  useEffect(() => {
    const now = new Set(zones.map((zone) => zone.id));
    const gone = previous.current.filter((zone) => !now.has(zone.id));
    previous.current = zones;
    if (!gone.length) {
      return;
    }
    setLeaving((current) => [...current.filter((zone) => !now.has(zone.id)), ...gone]);
    const timer = window.setTimeout(() => {
      setLeaving((current) => current.filter((zone) => !gone.some((entry) => entry.id === zone.id)));
    }, EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [zones]);
  return useMemo(() => [...zones, ...leaving.map((zone) => ({ ...zone, leaving: true }))], [zones, leaving]);
}

// The area's name on its top square, the whole line on hover. A player who
// only sees darkness learns it is Darkness here. The tag takes the pointer
// (the layer does not) to show its title, and carries its square's address,
// so a click on it is still a click on that square (BattleMapGrid's
// delegated handler reads data-tile-x/y).
function ZoneTag({ zone, width, color }: { zone: ViewZone; width: number; color: string }) {
  const at = Math.min(...zone.cells);
  const x = (at % width) * TILE;
  const y = Math.floor(at / width) * TILE;
  const size = TILE * 0.26;
  const text = zone.spell;
  const tagWidth = Math.min(TILE * 4, text.length * size * 0.56 + size);
  return (
    <g className="zone-section" pointerEvents="auto" data-tile-x={at % width} data-tile-y={Math.floor(at / width)}>
      <title>{zone.label}</title>
      <rect
        x={x + 2}
        y={y + 2}
        width={tagWidth}
        height={size * 1.5}
        rx={size * 0.75}
        fill="#0d0b1c"
        fillOpacity={0.82}
        stroke={color}
        strokeOpacity={0.7}
        strokeWidth={1}
        data-tile-x={at % width}
        data-tile-y={Math.floor(at / width)}
      />
      <text
        x={x + 2 + size / 2}
        y={y + 2 + size * 0.75}
        dy="0.35em"
        fontSize={size}
        fontWeight={600}
        fill={zone.tone === "gloom" ? "#d6cfc2" : color}
        data-tile-x={at % width}
        data-tile-y={Math.floor(at / width)}
      >
        {text}
      </text>
    </g>
  );
}

export const ZoneLayer = memo(function ZoneLayer({ zones, width }: { zones: ViewZone[] | undefined; width: number }) {
  const shown = useLeaving(zones ?? []);
  if (!shown.length) {
    return null;
  }
  return (
    <g data-layer="spell-zones" pointerEvents="none">
      <defs>
        <filter id="zone-soft" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation={5} />
        </filter>
        <pattern id="zone-hatch" width={8} height={8} patternUnits="userSpaceOnUse" patternTransform="rotate(35)">
          <line x1={0} y1={0} x2={0} y2={8} stroke="currentColor" strokeWidth={2} strokeOpacity={0.5} />
        </pattern>
      </defs>
      {shown.map((zone) => {
        const color = TONE[zone.tone] ?? TONE.hush;
        const mid = centre(zone.cells, width);
        const shape = area(zone.cells, width);
        return (
          <g
            key={zone.id}
            className={zone.leaving ? "zone-out" : "zone-in"}
            data-look={zone.look}
            style={{ color, transformOrigin: `${mid.x}px ${mid.y}px` }}
          >
            <title>{zone.label}</title>
            {zone.look === "cloud" ? (
              <path d={shape} fill={color} fillOpacity={0.55} filter="url(#zone-soft)" className="zone-drift" />
            ) : zone.look === "dark" ? (
              <path d={shape} fill={color} fillOpacity={0.88} className="zone-dark" />
            ) : zone.look === "light" ? (
              <path d={shape} fill={color} fillOpacity={0.14} className="zone-glow" />
            ) : zone.look === "wall" ? (
              <path d={shape} fill={color} fillOpacity={0.7} stroke={color} strokeWidth={2} className="zone-wall" />
            ) : zone.look === "ground" ? (
              <>
                <path d={shape} fill={color} fillOpacity={0.16} />
                <path d={shape} fill="url(#zone-hatch)" className="zone-shimmer" />
              </>
            ) : (
              <path d={shape} fill={color} fillOpacity={0.14} className="zone-glow" />
            )}
            {zone.hot.length ? <path d={area(zone.hot, width)} fill={color} fillOpacity={0.12} className="zone-glow" /> : null}
            <path
              d={outline(zone.cells, width)}
              fill="none"
              stroke={color}
              strokeOpacity={zone.look === "dark" ? 0.5 : 0.8}
              strokeWidth={1.5}
              strokeDasharray={zone.look === "wall" ? undefined : "6 4"}
              className={zone.look === "wall" ? undefined : "zone-edge"}
            />
            {zone.leaving ? null : <ZoneTag zone={zone} width={width} color={color} />}
            {/* A Wall of Ice's 10-foot sections, numbered as damage_object
                names them ("Wall of Ice section 2"); a broken one is gone
                from the list, so its badge pops out with it. */}
            {zone.sections?.map((section, index) => {
              const cx = (section.at % width) * TILE + TILE / 2;
              const cy = Math.floor(section.at / width) * TILE + TILE / 2;
              return (
                <g key={section.n} className="zone-section" style={{ animationDelay: `${index * 60}ms` }}>
                  <circle cx={cx} cy={cy} r={TILE * 0.3} fill="#0d0b1c" fillOpacity={0.85} stroke={color} strokeWidth={1.2} />
                  <text x={cx} y={cy} dy="0.35em" textAnchor="middle" fontSize={TILE * 0.34} fontWeight={600} fill={color}>
                    {section.n}
                  </text>
                </g>
              );
            })}
          </g>
        );
      })}
    </g>
  );
});
