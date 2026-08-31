// Pure seeded overworld generation: a value-noise height/moisture field
// classified into six terrain tiles, genre reskins for the client legend,
// and deterministic anchor placement for locations. No DB access and no
// "@/" imports so scripts/test-overworld-generate.mjs can load it directly;
// the impure rim is src/lib/db/overworld.ts.

// Sized for long campaigns: anchors hop 4-7 tiles apart, so this grid
// comfortably holds a couple hundred discovered locations before crowding.
export const OVERWORLD_WIDTH = 96;
export const OVERWORLD_HEIGHT = 72;

// One char per tile, row-major, matching the battle-map encoding style.
export type OverworldTile = "w" | "p" | "f" | "h" | "m" | "s";

export type XY = { x: number; y: number };

// Same tiny deterministic primitives as the battle-map generator
// (src/lib/battlemap/generate.ts); duplicated here to stay alias-free.
export function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Coarse random lattice + bilinear interpolation = smooth value noise.
function noiseField(
  seed: number,
  width: number,
  height: number,
  cell: number,
): (x: number, y: number) => number {
  const cols = Math.ceil(width / cell) + 2;
  const rows = Math.ceil(height / cell) + 2;
  const rng = mulberry32(seed);
  const lattice: number[] = [];
  for (let i = 0; i < cols * rows; i += 1) {
    lattice.push(rng());
  }
  const at = (cx: number, cy: number) => lattice[cy * cols + cx];
  const smooth = (t: number) => t * t * (3 - 2 * t);
  return (x, y) => {
    const gx = x / cell;
    const gy = y / cell;
    const x0 = Math.floor(gx);
    const y0 = Math.floor(gy);
    const tx = smooth(gx - x0);
    const ty = smooth(gy - y0);
    const a = at(x0, y0);
    const b = at(x0 + 1, y0);
    const c = at(x0, y0 + 1);
    const d = at(x0 + 1, y0 + 1);
    return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
  };
}

// The dials a person gets over the classifier. Each is 0 to 1 with 0.5
// meaning "leave it alone": at the defaults every threshold below evaluates
// to the constant it was before this layer existed, so an existing campaign
// rerolling its map gets the same kind of world it always did.
//
// This is the parameter layer the plan asks for, and it is also why free
// text can steer the overworld at all: the terrain is value noise, so a
// description cannot become tiles directly, but it can become five numbers
// (src/lib/overworld/describe.ts).
export type OverworldParams = {
  // Higher drowns more of the map.
  seaLevel: number;
  // Higher raises more peaks, and with them the hills that skirt them.
  mountains: number;
  // Higher turns more damp ground to woodland.
  forests: number;
  // Higher dries the world out: fewer forests, fewer swamps, more plains.
  aridity: number;
  // Higher pulls the shoreline further in from the edge.
  coastline: number;
};

export const DEFAULT_OVERWORLD_PARAMS: OverworldParams = {
  seaLevel: 0.5,
  mountains: 0.5,
  forests: 0.5,
  aridity: 0.5,
  coastline: 0.5,
};

export const OVERWORLD_PARAM_LABELS: Record<keyof OverworldParams, string> = {
  seaLevel: "Sea level",
  mountains: "Mountains",
  forests: "Forests",
  aridity: "Aridity",
  coastline: "Coastline",
};

function dial(value: unknown, fallback: number): number {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }
  return Math.min(1, Math.max(0, number));
}

// Anything at all in, a usable parameter set out. Called at both boundaries
// (the PATCH body and the model's answer), because neither can be trusted to
// send five numbers in range.
export function normalizeOverworldParams(raw: unknown): OverworldParams {
  const source = (raw ?? {}) as Partial<Record<keyof OverworldParams, unknown>>;
  return {
    seaLevel: dial(source.seaLevel, DEFAULT_OVERWORLD_PARAMS.seaLevel),
    mountains: dial(source.mountains, DEFAULT_OVERWORLD_PARAMS.mountains),
    forests: dial(source.forests, DEFAULT_OVERWORLD_PARAMS.forests),
    aridity: dial(source.aridity, DEFAULT_OVERWORLD_PARAMS.aridity),
    coastline: dial(source.coastline, DEFAULT_OVERWORLD_PARAMS.coastline),
  };
}

// A described region, once a model has turned the sentence into dials. The
// places are names only: the terrain decides where they land, because the
// anchor placer already knows what ground a settlement can sit on.
export type OverworldPlan = {
  params: OverworldParams;
  places: Array<{ name: string; blurb: string }>;
  note: string;
};

// Reads the model's answer. Tolerant of code fences and of prose either
// side of the object, and strict about the shape: anything missing falls
// back to the default dial rather than to a guess.
export function parseOverworldPlan(text: string): OverworldPlan | null {
  const cleaned = String(text ?? "")
    .replace(/```[a-z]*\n?/gi, "")
    .replace(/```/g, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) {
    return null;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const source = raw as { params?: unknown; places?: unknown; note?: unknown };
  const places = Array.isArray(source.places)
    ? source.places
        .map((entry) => {
          if (typeof entry === "string") {
            return { name: entry.trim().slice(0, 80), blurb: "" };
          }
          const row = entry as { name?: unknown; blurb?: unknown };
          return {
            name: String(row?.name ?? "").trim().slice(0, 80),
            blurb: String(row?.blurb ?? "").trim().slice(0, 300),
          };
        })
        .filter((place) => place.name)
        .slice(0, 8)
    : [];
  return {
    params: normalizeOverworldParams(source.params ?? raw),
    places,
    note: String(source.note ?? "").trim().slice(0, 200),
  };
}

// Height + moisture, two octaves each, classified into tiles. Deterministic
// under the seed and the parameters. Edges shade toward water so the region
// reads as bounded.
export function generateOverworldTerrain(
  seed: number,
  width = OVERWORLD_WIDTH,
  height = OVERWORLD_HEIGHT,
  params: OverworldParams = DEFAULT_OVERWORLD_PARAMS,
): string {
  const elevation1 = noiseField(seed, width, height, 12);
  const elevation2 = noiseField(seed ^ 0x9e3779b9, width, height, 5);
  const moisture1 = noiseField(seed ^ 0x51ed270b, width, height, 10);
  const moisture2 = noiseField(seed ^ 0x2545f491, width, height, 4);
  // Every threshold is written so the default 0.5 reproduces the constant it
  // replaced: 0.34 water, 0.8 mountain, 0.66 hill, 0.66 swamp, 0.52 forest.
  const water = 0.14 + params.seaLevel * 0.4;
  const mountain = 0.9 - params.mountains * 0.2;
  const hill = mountain - 0.14;
  const swampMoisture = 0.66 + (params.aridity - 0.5) * 0.3;
  const forestMoisture = 0.52 + (0.5 - params.forests) * 0.3 + (params.aridity - 0.5) * 0.3;
  // Coastal rim scales with the map so bigger worlds keep proportional
  // shorelines instead of a thin border strip.
  const rim = Math.max(
    2,
    Math.round((Math.min(width, height) / 9) * (0.5 + params.coastline)),
  );
  const tiles: string[] = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let e = elevation1(x, y) * 0.68 + elevation2(x, y) * 0.32;
      const m = moisture1(x, y) * 0.7 + moisture2(x, y) * 0.3;
      // Falloff toward the map edge keeps coastlines on the rim.
      const edge = Math.min(x, y, width - 1 - x, height - 1 - y);
      if (edge < rim) {
        e *= 0.55 + (0.45 / rim) * edge;
      }
      let tile: OverworldTile;
      if (e < water) {
        tile = "w";
      } else if (e > mountain) {
        tile = "m";
      } else if (e > hill) {
        tile = "h";
      } else if (m > swampMoisture && e < water + 0.12) {
        tile = "s";
      } else if (m > forestMoisture) {
        tile = "f";
      } else {
        tile = "p";
      }
      tiles.push(tile);
    }
  }
  return tiles.join("");
}

export function tileAt(terrain: string, width: number, x: number, y: number): string {
  return terrain[y * width + x] ?? "w";
}

const UNANCHORABLE = new Set(["w", "m"]);

// Deterministic placement for a location's map anchor: 4-7 tiles from its
// connected anchor in a direction hashed from the name (map center for the
// first location), then an outward spiral to the nearest tile that is not
// water or mountain and not already taken.
export function placeAnchor(input: {
  terrain: string;
  width: number;
  height: number;
  existing: XY[];
  connected: XY | null;
  name: string;
}): XY {
  const { terrain, width, height, existing, connected, name } = input;
  const hash = fnv1a(name.toLowerCase());
  const rng = mulberry32(hash);
  let start: XY;
  if (connected) {
    const angle = rng() * Math.PI * 2;
    const distance = 4 + rng() * 3;
    start = {
      x: Math.round(connected.x + Math.cos(angle) * distance),
      y: Math.round(connected.y + Math.sin(angle) * distance),
    };
  } else if (existing.length) {
    const anchor = existing[existing.length - 1];
    const angle = rng() * Math.PI * 2;
    start = {
      x: Math.round(anchor.x + Math.cos(angle) * 6),
      y: Math.round(anchor.y + Math.sin(angle) * 6),
    };
  } else {
    start = { x: Math.floor(width / 2), y: Math.floor(height / 2) };
  }
  const clamp = (point: XY): XY => ({
    x: Math.min(width - 3, Math.max(2, point.x)),
    y: Math.min(height - 3, Math.max(2, point.y)),
  });
  const taken = (point: XY) =>
    existing.some((anchor) => Math.abs(anchor.x - point.x) <= 1 && Math.abs(anchor.y - point.y) <= 1);
  const usable = (point: XY) =>
    !UNANCHORABLE.has(tileAt(terrain, width, point.x, point.y)) && !taken(point);

  let candidate = clamp(start);
  if (usable(candidate)) {
    return candidate;
  }
  // Outward ring search; radius is bounded by the map, so this terminates.
  for (let radius = 1; radius < Math.max(width, height); radius += 1) {
    for (let dy = -radius; dy <= radius; dy += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) {
          continue;
        }
        candidate = clamp({ x: start.x + dx, y: start.y + dy });
        if (usable(candidate)) {
          return candidate;
        }
      }
    }
  }
  return clamp(start);
}

// Client legend + palette per genre; the same classifier drives every
// genre, only the skin changes. Default skin covers fantasy-adjacent
// genres; entries override label and fill per tile.
export type TileSkin = { label: string; fill: string };

const DEFAULT_SKIN: Record<OverworldTile, TileSkin> = {
  w: { label: "Water", fill: "#2c4a63" },
  p: { label: "Plains", fill: "#7a8f4e" },
  f: { label: "Forest", fill: "#48663c" },
  h: { label: "Hills", fill: "#8a7d55" },
  m: { label: "Mountains", fill: "#6e6a66" },
  s: { label: "Swamp", fill: "#55604a" },
};

const GENRE_SKINS: Record<string, Partial<Record<OverworldTile, TileSkin>>> = {
  dark_fantasy: {
    w: { label: "Black water", fill: "#1f3242" },
    p: { label: "Moors", fill: "#66703f" },
    f: { label: "Darkwood", fill: "#324733" },
    s: { label: "Mire", fill: "#43503c" },
  },
  horror: {
    w: { label: "Cold sea", fill: "#22303d" },
    p: { label: "Fields", fill: "#6c7247" },
    f: { label: "Old growth", fill: "#37462f" },
    s: { label: "Fog marsh", fill: "#4b5245" },
  },
  cyberpunk: {
    w: { label: "Canals", fill: "#173d4d" },
    p: { label: "Low blocks", fill: "#4d5560" },
    f: { label: "Sprawl", fill: "#3d4a56" },
    h: { label: "Uptown", fill: "#5d6672" },
    m: { label: "Arcologies", fill: "#787f8c" },
    s: { label: "Undercity", fill: "#3a4038" },
  },
  steampunk: {
    p: { label: "Farmland", fill: "#7d8b4d" },
    h: { label: "Foundry hills", fill: "#8d7c58" },
    m: { label: "Iron peaks", fill: "#71695f" },
  },
  post_apocalyptic: {
    w: { label: "Dead water", fill: "#3a4a4a" },
    p: { label: "Wastes", fill: "#94824f" },
    f: { label: "Ruins", fill: "#5c5f4c" },
    h: { label: "Dunes", fill: "#9a8a5e" },
    m: { label: "Crags", fill: "#6b6258" },
    s: { label: "Toxic bog", fill: "#5b6440" },
  },
};

export function skinForGenre(genre: string): Record<OverworldTile, TileSkin> {
  return { ...DEFAULT_SKIN, ...(GENRE_SKINS[genre] ?? {}) };
}

// Deterministic per-tile shade jitter so flat fills read as terrain.
export function tileJitter(x: number, y: number): number {
  const hash = fnv1a(`${x},${y}`);
  return ((hash % 1000) / 1000 - 0.5) * 0.12;
}
