import { skinForGenre, tileJitter, type OverworldTile } from "@/lib/overworld/logic";

// Canvas drawing for the region map, lifted out of OverworldPanel so the
// panel has room for the DM's authoring controls. Nothing here touches
// React or the network: terrain, routes, pins, place markers and the party
// marker, in that order, into a context the caller has already transformed.

export const OVERWORLD_TILE = 16;

export type OverworldLocation = {
  id: string;
  name: string;
  visited: boolean;
  isCurrent: boolean;
  connections: string[];
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
    notes?: string;
  };
  locations: OverworldLocation[];
};

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
  options: { genre: string; pulse: number; selectedLocationId?: string | null },
) {
  const skin = skinForGenre(options.genre);
  const tile = OVERWORLD_TILE;
  const { width, height, terrain } = data.map;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const kind = (terrain[y * width + x] ?? "w") as OverworldTile;
      context.fillStyle = shade(skin[kind].fill, tileJitter(x, y));
      context.fillRect(x * tile, y * tile, tile, tile);
    }
  }

  // Routes: curves between anchors of connected locations, drawn once per pair.
  const anchorById = new Map(
    data.locations
      .filter((location) => location.anchor)
      .map((location) => [location.id, location.anchor as { x: number; y: number }] as const),
  );
  const idByName = new Map(
    data.locations.map((location) => [location.name.toLowerCase(), location.id] as const),
  );
  context.strokeStyle = "rgba(240, 220, 170, 0.45)";
  context.lineWidth = 1.5;
  context.setLineDash([5, 4]);
  const drawn = new Set<string>();
  for (const location of data.locations) {
    const from = anchorById.get(location.id);
    if (!from) {
      continue;
    }
    for (const connectionName of location.connections) {
      const targetId = idByName.get(connectionName.toLowerCase());
      const to = targetId ? anchorById.get(targetId) : null;
      if (!to || !targetId) {
        continue;
      }
      const key = [location.id, targetId].sort().join("|");
      if (drawn.has(key)) {
        continue;
      }
      drawn.add(key);
      const fromX = from.x * tile + tile / 2;
      const fromY = from.y * tile + tile / 2;
      const toX = to.x * tile + tile / 2;
      const toY = to.y * tile + tile / 2;
      const midX = (fromX + toX) / 2 + (fromY - toY) * 0.15;
      const midY = (fromY + toY) / 2 + (toX - fromX) * 0.15;
      context.beginPath();
      context.moveTo(fromX, fromY);
      context.quadraticCurveTo(midX, midY, toX, toY);
      context.stroke();
    }
  }
  context.setLineDash([]);

  // Lead pins under the location markers.
  for (const pin of data.map.pins) {
    const pinX = pin.x * tile + tile / 2;
    const pinY = pin.y * tile + tile / 2;
    context.fillStyle = "rgba(190, 120, 240, 0.9)";
    context.beginPath();
    context.arc(pinX, pinY, 4, 0, Math.PI * 2);
    context.fill();
    if (pin.label) {
      context.font = "10px sans-serif";
      context.fillStyle = "rgba(220, 190, 250, 0.95)";
      context.fillText(pin.label, pinX + 7, pinY + 3);
    }
  }

  // Locations: solid dots for visited, ghost dots for known-unvisited, pulse
  // ring on the party's current position, and a bright ring on whichever one
  // the DM has picked up to move.
  for (const location of data.locations) {
    const anchor = location.anchor;
    if (!anchor) {
      continue;
    }
    const markerX = anchor.x * tile + tile / 2;
    const markerY = anchor.y * tile + tile / 2;
    if (location.isCurrent) {
      const pulse = 6 + Math.sin(options.pulse / 12) * 2.5;
      context.strokeStyle = "rgba(250, 200, 90, 0.85)";
      context.lineWidth = 2;
      context.beginPath();
      context.arc(markerX, markerY, pulse, 0, Math.PI * 2);
      context.stroke();
    }
    if (options.selectedLocationId === location.id) {
      context.strokeStyle = "rgba(120, 220, 250, 0.95)";
      context.lineWidth = 2;
      context.beginPath();
      context.arc(markerX, markerY, 9, 0, Math.PI * 2);
      context.stroke();
    }
    context.fillStyle = location.visited
      ? "rgba(250, 225, 160, 0.95)"
      : "rgba(250, 225, 160, 0.4)";
    context.beginPath();
    context.arc(markerX, markerY, 4.5, 0, Math.PI * 2);
    context.fill();
    context.strokeStyle = "rgba(30, 25, 15, 0.8)";
    context.lineWidth = 1;
    context.stroke();
    context.font = "600 10px sans-serif";
    context.fillStyle = location.visited
      ? "rgba(250, 240, 220, 0.95)"
      : "rgba(250, 240, 220, 0.5)";
    context.fillText(location.name, markerX + 8, markerY - 6);
  }

  // The party marker, on top of everything: a party between two places has no
  // current location, which is exactly when the table most wants to see it.
  const party = data.map.partyXy;
  if (party) {
    const partyX = party.x * tile + tile / 2;
    const partyY = party.y * tile + tile / 2;
    context.fillStyle = "rgba(120, 220, 250, 0.95)";
    context.beginPath();
    context.moveTo(partyX, partyY - 6);
    context.lineTo(partyX + 5, partyY + 5);
    context.lineTo(partyX - 5, partyY + 5);
    context.closePath();
    context.fill();
    context.strokeStyle = "rgba(10, 25, 35, 0.9)";
    context.lineWidth = 1;
    context.stroke();
  }
}
