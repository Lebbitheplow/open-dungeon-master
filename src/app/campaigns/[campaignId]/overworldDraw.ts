import { skinForGenre, tileJitter, type OverworldTile, type XY } from "@/lib/overworld/logic";
import type { OverworldLabel, OverworldPath, PathKind } from "@/lib/overworld/features";
import {
  drawNames,
  drawPlaceMarks,
  OVERWORLD_TILE,
  type DrawnNames,
} from "@/app/campaigns/[campaignId]/regionPlaces";

// Canvas drawing for the region map, lifted out of OverworldPanel so the
// panel has room for the DM's authoring controls. Nothing here touches
// React or the network: terrain, routes, pins, place markers, names and the
// party marker, in that order, into a context the caller has already
// transformed.
//
// Only places of their own are drawn (issue 548): a vault's entrance and its
// approach fold into the vault's one dot, and their routes become its. Dots
// and names keep one size on screen at any zoom, so zooming in spreads the
// dots apart and makes room for the names that had none.

export { OVERWORLD_TILE };

export type OverworldLocation = {
  id: string;
  name: string;
  visited: boolean;
  isCurrent: boolean;
  connections: string[];
  // The bigger place it is part of (src/lib/db/locations.ts). Absent from
  // an older server, where a name can still file a place under another.
  parentName?: string | null;
  anchor: { x: number; y: number } | null;
};

export type OverworldData = {
  map: {
    seed: number;
    width: number;
    height: number;
    terrain: string;
    pins: Array<{ id: string; x: number; y: number; label: string }>;
    partyXy: { x: number; y: number } | null;
    params: Record<string, number>;
    paths: OverworldPath[];
    labels: OverworldLabel[];
    backdropPath: string;
    notes?: string;
  };
  locations: OverworldLocation[];
};

export type DrawOptions = {
  genre: string;
  pulse: number;
  selectedLocationId?: string | null;
  // The backdrop, once the panel has loaded it. Drawn in place of the tiles.
  backdrop?: HTMLImageElement | null;
  // A road, river or border still being drawn: its points so far.
  pending?: { kind: PathKind; points: XY[] } | null;
  // Canvas pixels per map pixel, so dots and names keep their size on
  // screen. 1 for the exported picture.
  zoom?: number;
  // The place under the pointer and the one last tapped: their names show
  // whatever else is in the way, and their routes light up.
  hoveredLocationId?: string | null;
  focusedLocationId?: string | null;
  // The part of the map on screen, in map pixels; the whole map when absent
  // (the exported picture).
  visible?: { x: number; y: number; width: number; height: number } | null;
  // Every name printed, as near its dot as room allows: the exported picture,
  // where nobody can point at a dot to read one that waited.
  allNames?: boolean;
};

const PATH_STYLES: Record<PathKind, { stroke: string; width: number; dash: number[] }> = {
  road: { stroke: "rgba(214, 178, 110, 0.95)", width: 1.8, dash: [] },
  river: { stroke: "rgba(96, 168, 236, 0.95)", width: 2.4, dash: [] },
  border: { stroke: "rgba(232, 96, 96, 0.9)", width: 1.6, dash: [4, 3] },
};

function drawPath(
  context: CanvasRenderingContext2D,
  path: { kind: PathKind; points: XY[]; label?: string },
  tile: number,
  pending = false,
) {
  if (path.points.length === 0) {
    return;
  }
  const style = PATH_STYLES[path.kind];
  context.strokeStyle = style.stroke;
  context.lineWidth = style.width;
  context.lineJoin = "round";
  context.lineCap = "round";
  context.setLineDash(pending ? [2, 3] : style.dash);
  context.beginPath();
  path.points.forEach((point, index) => {
    const x = point.x * tile + tile / 2;
    const y = point.y * tile + tile / 2;
    if (index === 0) {
      context.moveTo(x, y);
    } else {
      context.lineTo(x, y);
    }
  });
  context.stroke();
  context.setLineDash([]);
  if (pending) {
    // Handles on every point, so the DM can see what a tap added.
    context.fillStyle = style.stroke;
    for (const point of path.points) {
      context.beginPath();
      context.arc(point.x * tile + tile / 2, point.y * tile + tile / 2, 2.5, 0, Math.PI * 2);
      context.fill();
    }
  }
  if (path.label) {
    const middle = path.points[Math.floor(path.points.length / 2)];
    context.font = "italic 10px sans-serif";
    context.fillStyle = "rgba(250, 240, 220, 0.85)";
    context.fillText(path.label, middle.x * tile + tile / 2 + 5, middle.y * tile + tile / 2 - 4);
  }
}

function drawLabels(context: CanvasRenderingContext2D, labels: OverworldLabel[], tile: number) {
  for (const label of labels) {
    const x = label.x * tile + tile / 2;
    const y = label.y * tile + tile / 2;
    const large = label.size === "large";
    context.font = large ? "700 20px serif" : "600 11px sans-serif";
    context.textAlign = "center";
    context.lineWidth = large ? 4 : 3;
    context.strokeStyle = "rgba(20, 16, 10, 0.75)";
    context.fillStyle = large ? "rgba(250, 236, 200, 0.9)" : "rgba(250, 240, 220, 0.95)";
    const text = large ? label.text.toUpperCase() : label.text;
    context.strokeText(text, x, y);
    context.fillText(text, x, y);
    context.textAlign = "start";
  }
}

// A drawn backdrop counts as loaded once the browser has its size.
function usable(image: HTMLImageElement | null | undefined): image is HTMLImageElement {
  return Boolean(image && image.complete && image.naturalWidth > 0);
}

// Shades a hex fill by a small factor (deterministic per tile).
function shade(hex: string, factor: number): string {
  const value = parseInt(hex.slice(1), 16);
  const channel = (offset: number) => {
    const raw = (value >> offset) & 0xff;
    return Math.min(255, Math.max(0, Math.round(raw * (1 + factor))));
  };
  return `rgb(${channel(16)}, ${channel(8)}, ${channel(0)})`;
}

export function drawOverworld(
  context: CanvasRenderingContext2D,
  data: OverworldData,
  options: DrawOptions,
): DrawnNames {
  const skin = skinForGenre(options.genre);
  const tile = OVERWORLD_TILE;
  const { width, height, terrain } = data.map;

  if (usable(options.backdrop)) {
    // The picture stands in for the tiles, stretched to the grid so a tap
    // lands on the same tile whichever of the two is showing.
    context.drawImage(options.backdrop, 0, 0, width * tile, height * tile);
  } else {
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const kind = (terrain[y * width + x] ?? "w") as OverworldTile;
        context.fillStyle = shade(skin[kind].fill, tileJitter(x, y));
        context.fillRect(x * tile, y * tile, tile, tile);
      }
    }
  }

  // Borders under rivers under roads: a road crossing a river reads as a
  // bridge, and a border is the faintest of the three.
  for (const kind of ["border", "river", "road"] as const) {
    for (const path of data.map.paths ?? []) {
      if (path.kind === kind) {
        drawPath(context, path, tile);
      }
    }
  }
  if (options.pending) {
    drawPath(context, options.pending, tile, true);
  }

  // Routes, pins and the places' dots (regionPlaces.ts), under the words
  // the DM wrote on the map.
  const { places, lit, px } = drawPlaceMarks(context, data, options);
  const centre = (at: XY): XY => ({ x: at.x * tile + tile / 2, y: at.y * tile + tile / 2 });

  drawLabels(context, data.map.labels ?? [], tile);

  // The party marker, on top of every dot: a party between two places has
  // no current location, which is exactly when the table most wants to see it.
  const party = data.map.partyXy ? centre(data.map.partyXy) : null;
  if (party) {
    context.fillStyle = "rgba(120, 220, 250, 0.95)";
    context.beginPath();
    context.moveTo(party.x, party.y - 6 * px);
    context.lineTo(party.x + 5 * px, party.y + 5 * px);
    context.lineTo(party.x - 5 * px, party.y + 5 * px);
    context.closePath();
    context.fill();
    context.strokeStyle = "rgba(10, 25, 35, 0.9)";
    context.lineWidth = 1 * px;
    context.stroke();
  }

  return drawNames(context, data, places, { lit, px, party, options });
}

// The whole map at one tile per OVERWORLD_TILE pixels, as a PNG. Drawn from
// scratch on its own canvas so the view's pan and zoom do not crop it.
export function renderOverworldPng(
  data: OverworldData,
  options: Pick<DrawOptions, "genre" | "backdrop">,
): Promise<Blob | null> {
  const canvas = document.createElement("canvas");
  canvas.width = data.map.width * OVERWORLD_TILE;
  canvas.height = data.map.height * OVERWORLD_TILE;
  const context = canvas.getContext("2d");
  if (!context) {
    return Promise.resolve(null);
  }
  drawOverworld(context, data, { ...options, pulse: 0, allNames: true });
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), "image/png"));
}

// Renders and hands the PNG to the browser as a download. Returns what went
// wrong, or null.
export async function saveOverworldPng(
  data: OverworldData,
  options: Pick<DrawOptions, "genre" | "backdrop">,
): Promise<string | null> {
  const blob = await renderOverworldPng(data, options);
  if (!blob) {
    return "The map would not render.";
  }
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `region-map-${data.map.seed}.png`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
  return null;
}
