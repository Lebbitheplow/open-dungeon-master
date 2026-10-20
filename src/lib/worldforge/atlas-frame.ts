import { DEFAULT_FRAME, parseRef, readFrame, without, type AtlasMap, type MapFrame, type Pin, type WorldDoc, type XY } from "@/lib/worldforge/model";

// Where an Atlas pin stands on the playable Region map, and back (audit
// finding WF-09). Pure: the server keeps bound pins and Region places in
// step with it, and the Atlas can show the same answer before anything is
// saved.
//
// Three spaces meet here. A pin is placed 0..1 across the box the map is
// shown in, its surface. The picture fills that box by its frame
// (src/lib/worldforge/model.ts MapFrame): cropped to cover it, or
// letterboxed inside it. The Region map stretches the same picture over
// its grid edge to edge (src/app/campaigns/[campaignId]/overworldDraw.ts),
// so a point on the picture is a fixed point on the grid whichever shape
// either of them has.

export type Cell = { x: number; y: number };
export type GridSize = { width: number; height: number };

export function frameOf(atlas: Pick<AtlasMap, "frame"> | null | undefined): MapFrame {
  return atlas?.frame ?? DEFAULT_FRAME;
}

// How much of the picture's width and height one surface width and height
// span. Below 1 the picture is cropped on that axis; above 1 it is
// letterboxed.
function span(frame: MapFrame): XY {
  const picture = frame.image || frame.surface;
  const wider = frame.surface / picture;
  return frame.fit === "cover"
    ? { x: Math.min(1, wider), y: Math.min(1, 1 / wider) }
    : { x: Math.max(1, wider), y: Math.max(1, 1 / wider) };
}

export function surfaceToPicture(frame: MapFrame, at: XY): XY {
  const k = span(frame);
  return { x: 0.5 + (at.x - 0.5) * k.x, y: 0.5 + (at.y - 0.5) * k.y };
}

export function pictureToSurface(frame: MapFrame, at: XY): XY {
  const k = span(frame);
  return { x: 0.5 + (at.x - 0.5) / k.x, y: 0.5 + (at.y - 0.5) / k.y };
}

const EDGE = 1e-9;
const inside = (at: XY) => at.x >= -EDGE && at.x <= 1 + EDGE && at.y >= -EDGE && at.y <= 1 + EDGE;
const clampCell = (value: number, size: number) => Math.min(size - 1, Math.max(0, Math.floor(value * size)));

// The Region cell under a pin. `onPicture` is false for a pin in a
// letterbox's empty band, which lands on the nearest edge cell.
export function pinToRegion(frame: MapFrame, at: XY, grid: GridSize): { cell: Cell; onPicture: boolean } {
  const picture = surfaceToPicture(frame, at);
  return { cell: { x: clampCell(picture.x, grid.width), y: clampCell(picture.y, grid.height) }, onPicture: inside(picture) };
}

// Where a pin stands for a Region cell: the middle of the cell, back
// through the frame. `onSurface` is false for a cell in the part of the
// picture a cropped map does not show; the pin waits at the nearest edge.
export function regionToPin(frame: MapFrame, cell: Cell, grid: GridSize): { at: XY; onSurface: boolean } {
  const surface = pictureToSurface(frame, { x: (cell.x + 0.5) / grid.width, y: (cell.y + 0.5) / grid.height });
  const fit = (value: number) => Math.round(Math.min(1, Math.max(0, value)) * 10_000) / 10_000;
  return { at: { x: fit(surface.x), y: fit(surface.y) }, onSurface: inside(surface) };
}

// The map that stands over the Region, if one does.
export function regionMapOf(doc: Pick<WorldDoc, "maps">): AtlasMap | null {
  return doc.maps.find((atlas) => atlas.role === "region") ?? null;
}

// The pins bound to a place on the Region: on the Region's map, and still
// naming the place they were bound for.
export function boundPins(doc: Pick<WorldDoc, "maps" | "pins">): Pin[] {
  const atlas = regionMapOf(doc);
  if (!atlas) return [];
  return doc.pins.filter((pin) => pin.mapId === atlas.id && pin.regionLink && pin.regionLink === pin.ref && parseRef(pin.ref)?.shelf === "location");
}

// The pin's place, as a location id.
export function placeIdOf(pin: Pick<Pin, "ref">): string {
  const parsed = parseRef(pin.ref);
  return parsed?.shelf === "location" ? parsed.id : "";
}

// A map's role and frame and a pin's binding belong to the explicit Region
// steps (src/lib/db/atlas-region.ts), not to the editor's saves: whatever a
// save sends for them, each row keeps what it had. A pin that now names
// another place, or has moved to another map, loses its binding; a map
// whose picture was replaced keeps its frame but forgets the old picture's
// measured shape.
export function keepRegionFields(before: Pick<WorldDoc, "maps" | "pins">, after: WorldDoc): WorldDoc {
  const maps = new Map(before.maps.map((atlas) => [atlas.id, atlas]));
  const pins = new Map(before.pins.map((pin) => [pin.id, pin]));
  return {
    ...after,
    maps: after.maps.map((atlas) => {
      const rest = without(atlas, "role", "frame");
      const was = maps.get(atlas.id);
      const frame = was?.frame && was.image !== atlas.image ? readFrame({ ...was.frame, image: 0 }) : was?.frame;
      return { ...rest, ...(was?.role === "region" ? { role: "region" as const } : {}), ...(frame ? { frame } : {}) };
    }),
    pins: after.pins.map((pin) => {
      const rest = without(pin, "regionLink");
      const was = pins.get(pin.id);
      return was?.regionLink && was.regionLink === rest.ref && was.mapId === rest.mapId ? { ...rest, regionLink: was.regionLink } : rest;
    }),
  };
}
