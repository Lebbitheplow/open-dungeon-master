import type { MapTheme } from "@/lib/battlemap/generate";
import type { PlayerMapView } from "@/lib/battlemap/view";

// The terrain layer of the battle map: palettes, textures, wall decoration
// and the three stacked passes that make a row-major string of tile
// characters look like a place.
//
// Split out of BattleMapGrid.tsx, which now holds only the tokens and the
// things a person does to them. Nothing here reads game state beyond the
// projection it is handed, and nothing here decides what anyone may do.

export const TILE = 32;

// Per-theme tile palette: floor, wall, water, difficult ground, and the
// wall decoration drawn on top (trees for wilds, blocks for stonework).
export type Palette = {
  floor: string;
  floorAlt: string;
  wall: string;
  wallDeco: "tree" | "stone" | "rock";
  water: string;
  difficult: string;
};

export const PALETTES: Record<MapTheme, Palette> = {
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

// Lighten (positive) or darken (negative) a #rrggbb color by a fixed step.
export function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const clamp = (v: number) => Math.max(0, Math.min(255, v));
  const r = clamp(((n >> 16) & 255) + amt);
  const g = clamp(((n >> 8) & 255) + amt);
  const b = clamp((n & 255) + amt);
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

// Deterministic per-tile jitter so floors get a subtle hand-laid texture
// without re-rendering differently each time.
function tileNoise(x: number, y: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return n - Math.floor(n);
}

// A second salted hash for decoration jitter and scatter, so trees, boulders,
// and rubble stay put across re-renders but don't line up with tileNoise.
export function hashNoise(x: number, y: number, salt: number): number {
  const n = Math.sin((x + salt * 57.3) * 269.5 + (y - salt * 19.7) * 183.3) * 43758.5453;
  return n - Math.floor(n);
}

function WallDecoration({ kind, x, y }: { kind: Palette["wallDeco"]; x: number; y: number }) {
  const px = x * TILE;
  const py = y * TILE;
  if (kind === "tree") {
    const jx = (hashNoise(x, y, 1) - 0.5) * 4;
    const jy = (hashNoise(x, y, 2) - 0.5) * 4;
    return (
      <g pointerEvents="none" opacity={0.9}>
        <ellipse cx={px + TILE / 2} cy={py + TILE - 4} rx={TILE / 3} ry={3} fill="#000" opacity={0.35} />
        <circle cx={px + TILE / 2 + jx} cy={py + TILE / 2 - 2 + jy} r={TILE / 2.7} fill="#16240f" />
        <circle cx={px + TILE / 2 - 6 + jx} cy={py + TILE / 2 + 3 + jy} r={TILE / 4} fill="#233620" />
        <circle cx={px + TILE / 2 + 6 + jx} cy={py + TILE / 2 + jy} r={TILE / 5} fill="#2c4327" />
        <circle cx={px + TILE / 2 - 2 + jx} cy={py + TILE / 2 - 6 + jy} r={TILE / 6} fill="#375334" opacity={0.8} />
      </g>
    );
  }
  if (kind === "stone") {
    // Mortared block face with a thin bevel highlight under the top seam.
    return (
      <g pointerEvents="none">
        <line x1={px} y1={py + TILE / 2} x2={px + TILE} y2={py + TILE / 2} stroke="#0000006e" strokeWidth={1.5} />
        <line x1={px} y1={py + TILE / 2 + 1} x2={px + TILE} y2={py + TILE / 2 + 1} stroke="#ffffff10" strokeWidth={1} />
        <line x1={px + TILE / 3} y1={py} x2={px + TILE / 3} y2={py + TILE / 2} stroke="#0000006e" strokeWidth={1.5} />
        <line
          x1={px + (2 * TILE) / 3}
          y1={py + TILE / 2}
          x2={px + (2 * TILE) / 3}
          y2={py + TILE}
          stroke="#0000006e"
          strokeWidth={1.5}
        />
      </g>
    );
  }
  const jx = (hashNoise(x, y, 3) - 0.5) * 3;
  return (
    <g pointerEvents="none">
      <ellipse cx={px + TILE / 2} cy={py + TILE - 5} rx={TILE / 3} ry={3} fill="#000" opacity={0.3} />
      <polygon
        points={`${px + 5},${py + TILE - 6} ${px + TILE / 2 + jx},${py + 7} ${px + TILE - 5},${py + TILE - 6}`}
        fill="#2a2731"
        stroke="#0b0a10"
        strokeWidth={1}
      />
      <polygon
        points={`${px + 9},${py + TILE - 6} ${px + TILE / 2 + jx},${py + 11} ${px + TILE / 2 + 7},${py + TILE - 6}`}
        fill="#3a3644"
        opacity={0.6}
      />
    </g>
  );
}


// A map with a picture under it is drawn a different way: the art is the
// floor, so the terrain layer stops painting surfaces and starts marking
// only what the rules care about. Walls and rough ground get a translucent
// tint the eye can read as blocked without hiding what is underneath.
//
// Fog is unaffected, which is the point. Unexplored tiles keep their opaque
// black square, so the backdrop drawn beneath is covered exactly where the
// terrain would have been hidden and a player cannot see the dungeon they
// have not walked into (src/lib/battlemap/backdrop.ts).
function artTile(idx: number, px: number, py: number, ch: string, palette: Palette) {
  if (ch === "#") {
    return (
      <g key={idx} pointerEvents="none">
        <rect x={px} y={py} width={TILE} height={TILE} fill={palette.wall} opacity={0.45} />
        <rect
          x={px + 0.75}
          y={py + 0.75}
          width={TILE - 1.5}
          height={TILE - 1.5}
          fill="none"
          stroke="#000"
          strokeOpacity={0.55}
          strokeWidth={1.5}
        />
      </g>
    );
  }
  if (ch === "~") {
    return (
      <rect
        key={idx}
        x={px}
        y={py}
        width={TILE}
        height={TILE}
        fill={palette.water}
        opacity={0.4}
        pointerEvents="none"
      />
    );
  }
  if (ch === ",") {
    return (
      <rect
        key={idx}
        x={px}
        y={py}
        width={TILE}
        height={TILE}
        fill={palette.difficult}
        opacity={0.35}
        pointerEvents="none"
      />
    );
  }
  // Clear ground and doorways: the picture speaks for itself.
  return null;
}

export function buildCells(view: PlayerMapView, palette: Palette) {
  const { width, height } = view;
  const art = Boolean(view.backdrop);
  const visible = new Set(view.visible);
  const explored = new Set(view.explored);
  const reachable = new Set(view.reachable);
  const terrain = view.terrain;
  const charAt = (x: number, y: number) =>
    x < 0 || y < 0 || x >= width || y >= height ? " " : terrain[y * width + x];

  // Three stacked passes: terrain (with textures, cast shadows, decorations),
  // then the fractal grain, then fog dimming and the reachable overlay on top.
  const base: React.ReactNode[] = [];
  const fog: React.ReactNode[] = [];
  const reach: React.ReactNode[] = [];

  for (let idx = 0; idx < width * height; idx += 1) {
    const x = idx % width;
    const y = Math.floor(idx / width);
    const px = x * TILE;
    const py = y * TILE;
    const ch = terrain[idx];
    const isExplored = explored.has(idx);
    const isVisible = visible.has(idx);
    const isReachable = reachable.has(idx);

    if (!isExplored) {
      base.push(<rect key={idx} x={px} y={py} width={TILE} height={TILE} fill="#050505" />);
    } else if (art) {
      const tile = artTile(idx, px, py, ch, palette);
      if (tile) {
        base.push(tile);
      }
    } else if (ch === "#") {
      // Beveled wall block: dark base, lit inset, highlight on faces that
      // border explored floor so the wall reads as raised.
      const topOpen = charAt(x, y - 1) !== "#" && charAt(x, y - 1) !== " ";
      const leftOpen = charAt(x - 1, y) !== "#" && charAt(x - 1, y) !== " ";
      base.push(
        <g key={idx}>
          <rect x={px} y={py} width={TILE} height={TILE} fill={palette.wall} />
          <rect x={px + 1.5} y={py + 1.5} width={TILE - 3} height={TILE - 3} rx={2} fill={shade(palette.wall, 16)} />
          {topOpen ? (
            <line
              x1={px + 1}
              y1={py + 1.5}
              x2={px + TILE - 1}
              y2={py + 1.5}
              stroke={shade(palette.wall, 40)}
              strokeWidth={1.5}
              opacity={0.7}
            />
          ) : null}
          {leftOpen ? (
            <line
              x1={px + 1.5}
              y1={py + 1}
              x2={px + 1.5}
              y2={py + TILE - 1}
              stroke={shade(palette.wall, 32)}
              strokeWidth={1.5}
              opacity={0.6}
            />
          ) : null}
          <WallDecoration kind={palette.wallDeco} x={x} y={y} />
        </g>,
      );
    } else if (ch === "~") {
      // Layered water: gradient body, two wave passes, shore foam on land edges.
      const foam: React.ReactNode[] = [];
      if (charAt(x, y - 1) !== "~")
        foam.push(<line key="n" x1={px + 2} y1={py + 1.5} x2={px + TILE - 2} y2={py + 1.5} stroke="#bfe9ff55" strokeWidth={1.5} />);
      if (charAt(x, y + 1) !== "~")
        foam.push(<line key="s" x1={px + 2} y1={py + TILE - 1.5} x2={px + TILE - 2} y2={py + TILE - 1.5} stroke="#bfe9ff55" strokeWidth={1.5} />);
      if (charAt(x - 1, y) !== "~")
        foam.push(<line key="w" x1={px + 1.5} y1={py + 2} x2={px + 1.5} y2={py + TILE - 2} stroke="#bfe9ff55" strokeWidth={1.5} />);
      if (charAt(x + 1, y) !== "~")
        foam.push(<line key="e" x1={px + TILE - 1.5} y1={py + 2} x2={px + TILE - 1.5} y2={py + TILE - 2} stroke="#bfe9ff55" strokeWidth={1.5} />);
      base.push(
        <g key={idx} pointerEvents="none">
          <rect x={px} y={py} width={TILE} height={TILE} fill={`url(#water-${view.theme})`} />
          <path d={`M ${px + 3} ${py + 11} q 6 -4 12 0 t 14 0`} stroke="#ffffff2a" strokeWidth={1.5} fill="none" />
          <path d={`M ${px + 2} ${py + 22} q 7 4 13 0 t 13 0`} stroke="#ffffff18" strokeWidth={1.5} fill="none" />
          {foam}
        </g>,
      );
    } else if (ch === ",") {
      // Difficult ground: base tint plus a deterministic scatter of tufts.
      const tuft = palette.wallDeco === "tree" ? "#2f3d22" : "#413b30";
      const scatter: React.ReactNode[] = [];
      for (let k = 0; k < 5; k += 1) {
        const gx = px + 5 + hashNoise(x, y, 10 + k) * (TILE - 10);
        const gy = py + 6 + hashNoise(x, y, 20 + k) * (TILE - 10);
        const r = 1.4 + hashNoise(x, y, 30 + k) * 2;
        scatter.push(
          <g key={k}>
            <circle cx={gx} cy={gy} r={r} fill={tuft} opacity={0.7} />
            <circle cx={gx + 0.8} cy={gy - 0.8} r={r * 0.5} fill={shade(tuft, 20)} opacity={0.6} />
          </g>,
        );
      }
      base.push(
        <g key={idx} pointerEvents="none">
          <rect x={px} y={py} width={TILE} height={TILE} fill={palette.difficult} />
          {scatter}
        </g>,
      );
    } else {
      // Floor: tri-tone base, faint grout seam, occasional crack or speck.
      const n = tileNoise(x, y);
      const flBase = n > 0.66 ? shade(palette.floor, 6) : n > 0.33 ? palette.floor : palette.floorAlt;
      base.push(
        <g key={idx} pointerEvents="none">
          <rect x={px} y={py} width={TILE} height={TILE} fill={flBase} />
          <rect x={px} y={py} width={TILE} height={TILE} fill="none" stroke="#00000022" strokeWidth={1} />
          {n > 0.86 ? (
            <path d={`M ${px + 8} ${py + 7} l 6 5 l -3 6`} stroke="#00000030" strokeWidth={1} fill="none" />
          ) : n < 0.08 ? (
            <circle cx={px + n * 96 + 6} cy={py + 18} r={1.2} fill="#ffffff10" />
          ) : null}
        </g>,
      );
    }

    // Directional shadow cast onto explored floor from a wall to the N / W.
    // Skipped over a backdrop: the picture already has its own light, and a
    // second set of shadows on top of it reads as smudging.
    if (isExplored && !art && ch !== "#") {
      if (charAt(x, y - 1) === "#")
        base.push(<rect key={`sn-${idx}`} x={px} y={py} width={TILE} height={TILE * 0.55} fill="url(#castN)" pointerEvents="none" />);
      if (charAt(x - 1, y) === "#")
        base.push(<rect key={`sw-${idx}`} x={px} y={py} width={TILE * 0.5} height={TILE} fill="url(#castW)" pointerEvents="none" />);
    }

    if (isExplored && !isVisible) {
      fog.push(
        <rect key={`f-${idx}`} x={px} y={py} width={TILE} height={TILE} fill="#000" opacity={0.55} pointerEvents="none" />,
      );
    }

    if (isReachable) {
      reach.push(
        <rect
          key={`r-${idx}`}
          x={px + 2}
          y={py + 2}
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
        />,
      );
    }
  }

  return (
    <>
      {base}
      {art ? null : (
        <rect
          x={0}
          y={0}
          width={width * TILE}
          height={height * TILE}
          filter={`url(#grain-${view.theme})`}
          opacity={0.5}
          style={{ mixBlendMode: "overlay" }}
          pointerEvents="none"
        />
      )}
      {fog}
      {reach}
    </>
  );
}
