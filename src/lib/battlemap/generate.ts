import {
  TERRAIN,
  tileIndex,
  type AmbientLight,
  type MapLight,
  type XY,
} from "@/lib/battlemap/types";

// Seeded procedural battle-map generation. Deterministic under the seed so
// a map can always be regenerated from its encounter. The scene keywords
// (DM battlefield hint, location layout, genre) steer terrain and lighting.

export type MapTheme = "cave" | "forest" | "swamp" | "riverside" | "interior" | "field";

export type GeneratedMap = {
  width: number;
  height: number;
  terrain: string;
  ambient: AmbientLight;
  theme: MapTheme;
  lights: MapLight[];
  pcSpawns: XY[];
  enemySpawns: XY[];
};

export type GenerateInput = {
  seed: number;
  width?: number;
  height?: number;
  genre?: string;
  locationName?: string;
  layoutDescription?: string;
  hint?: string;
  pcCount: number;
  enemyCount: number;
};

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

function pickTheme(text: string, rng: () => number): { theme: MapTheme; ambient: AmbientLight } {
  const has = (re: RegExp) => re.test(text);
  let theme: MapTheme = "field";
  if (has(/\bcave|cavern|dungeon|crypt|tomb|tunnel|mine|underdark|barrow\b/)) {
    theme = "cave";
  } else if (has(/\bswamp|marsh|bog|mire|fen\b/)) {
    theme = "swamp";
  } else if (has(/\bforest|wood|grove|jungle|thicket\b/)) {
    theme = "forest";
  } else if (has(/\briver|lake|shore|beach|sewer|canal|dock|harbor\b/)) {
    theme = "riverside";
  } else if (has(/\bstreet|alley|warehouse|tavern|inn|room|hall|temple|church|castle|keep|tower|deck|ship|manor|library\b/)) {
    theme = "interior";
  }
  let ambient: AmbientLight =
    theme === "cave" ? "dark" : theme === "interior" ? "dim" : "bright";
  if (has(/\bnight|midnight|moonlit|dark|darkness|pitch-black\b/)) {
    ambient = "dark";
  } else if (has(/\bdim|dusk|twilight|torchlit|candlelit|foggy|misty\b/)) {
    ambient = ambient === "dark" ? "dark" : "dim";
  } else if (has(/\bdaylight|noon|sunny|bright\b/)) {
    ambient = "bright";
  }
  // Unused rng draw keeps theme choice stable if branches change later.
  void rng;
  return { theme, ambient };
}

// Cellular-automata cave: random walls smoothed into organic pockets.
function carveCave(tiles: string[], width: number, height: number, rng: () => number) {
  const wall = (x: number, y: number) =>
    x <= 0 || y <= 0 || x >= width - 1 || y >= height - 1 || tiles[tileIndex(width, x, y)] === TERRAIN.wall;
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      if (rng() < 0.42) {
        tiles[tileIndex(width, x, y)] = TERRAIN.wall;
      }
    }
  }
  for (let pass = 0; pass < 4; pass += 1) {
    const next = [...tiles];
    for (let y = 1; y < height - 1; y += 1) {
      for (let x = 1; x < width - 1; x += 1) {
        let neighbors = 0;
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            if ((dx || dy) && wall(x + dx, y + dy)) {
              neighbors += 1;
            }
          }
        }
        next[tileIndex(width, x, y)] = neighbors >= 5 ? TERRAIN.wall : TERRAIN.floor;
      }
    }
    for (let i = 0; i < tiles.length; i += 1) {
      tiles[i] = next[i];
    }
  }
}

function scatterBlobs(
  tiles: string[],
  width: number,
  height: number,
  rng: () => number,
  ch: string,
  count: number,
  maxSize: number,
) {
  for (let n = 0; n < count; n += 1) {
    const cx = 2 + Math.floor(rng() * (width - 4));
    const cy = 2 + Math.floor(rng() * (height - 4));
    const size = 1 + Math.floor(rng() * maxSize);
    for (let dy = 0; dy < size; dy += 1) {
      for (let dx = 0; dx < size; dx += 1) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < width - 1 && y < height - 1) {
          tiles[tileIndex(width, x, y)] = ch;
        }
      }
    }
  }
}

// A water band crossing the map vertically with a 2-tile ford.
function carveRiver(tiles: string[], width: number, height: number, rng: () => number) {
  let x = Math.floor(width * (0.4 + rng() * 0.2));
  const fordY = 2 + Math.floor(rng() * (height - 5));
  for (let y = 0; y < height; y += 1) {
    for (let w = 0; w < 2; w += 1) {
      const col = Math.min(width - 2, Math.max(1, x + w));
      if (y !== fordY && y !== fordY + 1 && y > 0 && y < height - 1) {
        tiles[tileIndex(width, col, y)] = TERRAIN.water;
      }
    }
    if (rng() < 0.35) {
      x += rng() < 0.5 ? -1 : 1;
    }
  }
}

// Interior: pillars on a loose lattice plus one internal wall with a gap.
function carveInterior(tiles: string[], width: number, height: number, rng: () => number) {
  for (let y = 3; y < height - 3; y += 4) {
    for (let x = 3; x < width - 3; x += 4) {
      if (rng() < 0.6) {
        tiles[tileIndex(width, x, y)] = TERRAIN.wall;
      }
    }
  }
  const wallX = Math.floor(width * (0.35 + rng() * 0.3));
  const gapY = 1 + Math.floor(rng() * (height - 3));
  for (let y = 1; y < height - 1; y += 1) {
    if (Math.abs(y - gapY) > 1) {
      tiles[tileIndex(width, wallX, y)] = TERRAIN.wall;
    }
  }
}

// BFS flood from one open tile; used for the connectivity guarantee.
function reachableFrom(tiles: string[], width: number, height: number, start: XY): Set<number> {
  const seen = new Set<number>();
  const queue: XY[] = [start];
  seen.add(tileIndex(width, start.x, start.y));
  while (queue.length) {
    const { x, y } = queue.shift() as XY;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + dx;
      const ny = y + dy;
      const idx = tileIndex(width, nx, ny);
      if (
        nx > 0 && ny > 0 && nx < width - 1 && ny < height - 1 &&
        !seen.has(idx) && tiles[idx] !== TERRAIN.wall
      ) {
        seen.add(idx);
        queue.push({ x: nx, y: ny });
      }
    }
  }
  return seen;
}

function carveCorridor(tiles: string[], width: number, from: XY, to: XY) {
  let { x, y } = from;
  while (x !== to.x) {
    x += x < to.x ? 1 : -1;
    tiles[tileIndex(width, x, y)] = TERRAIN.floor;
  }
  while (y !== to.y) {
    y += y < to.y ? 1 : -1;
    tiles[tileIndex(width, x, y)] = TERRAIN.floor;
  }
}

// Pick `count` distinct open tiles near an edge column band.
function pickSpawns(
  tiles: string[],
  width: number,
  height: number,
  rng: () => number,
  colStart: number,
  colEnd: number,
  count: number,
  taken: Set<number>,
): XY[] {
  const open: XY[] = [];
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = colStart; x < colEnd; x += 1) {
      const idx = tileIndex(width, x, y);
      if (tiles[idx] === TERRAIN.floor && !taken.has(idx)) {
        open.push({ x, y });
      }
    }
  }
  // Deterministic shuffle.
  for (let i = open.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [open[i], open[j]] = [open[j], open[i]];
  }
  const picked = open.slice(0, count);
  for (const spot of picked) {
    taken.add(tileIndex(width, spot.x, spot.y));
  }
  return picked;
}

export function generateBattleMap(input: GenerateInput): GeneratedMap {
  const width = Math.min(24, Math.max(12, input.width ?? 20));
  const height = Math.min(18, Math.max(10, input.height ?? 15));
  const rng = mulberry32(input.seed);
  const text = [input.hint, input.layoutDescription, input.locationName, input.genre]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const { theme, ambient } = pickTheme(text, rng);

  const tiles: string[] = new Array(width * height).fill(TERRAIN.floor);
  for (let x = 0; x < width; x += 1) {
    tiles[tileIndex(width, x, 0)] = TERRAIN.wall;
    tiles[tileIndex(width, x, height - 1)] = TERRAIN.wall;
  }
  for (let y = 0; y < height; y += 1) {
    tiles[tileIndex(width, 0, y)] = TERRAIN.wall;
    tiles[tileIndex(width, width - 1, y)] = TERRAIN.wall;
  }

  if (theme === "cave") {
    carveCave(tiles, width, height, rng);
    scatterBlobs(tiles, width, height, rng, TERRAIN.difficult, 3, 2);
  } else if (theme === "forest") {
    scatterBlobs(tiles, width, height, rng, TERRAIN.wall, 8, 2);
    scatterBlobs(tiles, width, height, rng, TERRAIN.difficult, 5, 2);
  } else if (theme === "swamp") {
    scatterBlobs(tiles, width, height, rng, TERRAIN.water, 6, 3);
    scatterBlobs(tiles, width, height, rng, TERRAIN.difficult, 6, 2);
    scatterBlobs(tiles, width, height, rng, TERRAIN.wall, 4, 1);
  } else if (theme === "riverside") {
    carveRiver(tiles, width, height, rng);
    scatterBlobs(tiles, width, height, rng, TERRAIN.wall, 4, 2);
  } else if (theme === "interior") {
    carveInterior(tiles, width, height, rng);
  } else {
    scatterBlobs(tiles, width, height, rng, TERRAIN.wall, 5, 2);
    scatterBlobs(tiles, width, height, rng, TERRAIN.difficult, 3, 2);
  }
  if (/\brubble|ice|mud|sand|snow\b/.test(text)) {
    scatterBlobs(tiles, width, height, rng, TERRAIN.difficult, 5, 2);
  }

  // Spawns: party on one edge band, enemies on the other.
  const flip = rng() < 0.5;
  const band = Math.max(3, Math.floor(width / 4));
  const taken = new Set<number>();
  const pcRange: [number, number] = flip ? [width - 1 - band, width - 1] : [1, 1 + band];
  const enemyRange: [number, number] = flip ? [1, 1 + band] : [width - 1 - band, width - 1];
  let pcSpawns = pickSpawns(tiles, width, height, rng, pcRange[0], pcRange[1], input.pcCount, taken);
  let enemySpawns = pickSpawns(tiles, width, height, rng, enemyRange[0], enemyRange[1], input.enemyCount, taken);

  // Dense generation can starve an edge band; open the center as a fallback.
  if (pcSpawns.length < input.pcCount || enemySpawns.length < input.enemyCount) {
    scatterBlobs(tiles, width, height, () => 0.5, TERRAIN.floor, 0, 0);
    for (let y = Math.floor(height / 3); y < Math.ceil((2 * height) / 3); y += 1) {
      for (let x = 1; x < width - 1; x += 1) {
        tiles[tileIndex(width, x, y)] = TERRAIN.floor;
      }
    }
    pcSpawns = pcSpawns.length < input.pcCount
      ? pickSpawns(tiles, width, height, rng, pcRange[0], pcRange[1], input.pcCount, taken)
      : pcSpawns;
    enemySpawns = enemySpawns.length < input.enemyCount
      ? pickSpawns(tiles, width, height, rng, enemyRange[0], enemyRange[1], input.enemyCount, taken)
      : enemySpawns;
  }

  // Connectivity guarantee: every spawn must reach the first PC spawn.
  if (pcSpawns.length) {
    const reached = reachableFrom(tiles, width, height, pcSpawns[0]);
    for (const spot of [...pcSpawns.slice(1), ...enemySpawns]) {
      if (!reached.has(tileIndex(width, spot.x, spot.y))) {
        carveCorridor(tiles, width, pcSpawns[0], spot);
      }
    }
  }

  // Static lights only matter when the field is not already bright.
  const lights: MapLight[] = [];
  if (ambient !== "bright") {
    const count = 2 + Math.floor(rng() * 3);
    for (let n = 0; n < count; n += 1) {
      const x = Math.floor(width / 4) + Math.floor(rng() * (width / 2));
      const y = Math.floor(height / 4) + Math.floor(rng() * (height / 2));
      if (tiles[tileIndex(width, x, y)] !== TERRAIN.wall) {
        lights.push({ x, y, brightRadius: 4, dimRadius: 8 });
      }
    }
  }

  return { width, height, terrain: tiles.join(""), ambient, theme, lights, pcSpawns, enemySpawns };
}
