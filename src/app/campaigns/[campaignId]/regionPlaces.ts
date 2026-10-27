import type { XY } from "@/lib/overworld/logic";
import { nameWithin, placeTree, regionRoutes, type PlaceTree } from "@/lib/overworld/places";
import { layoutLabels, type Box, type LabelRequest } from "@/lib/overworld/label-layout";
import type { DrawOptions, OverworldData, OverworldLocation } from "@/app/campaigns/[campaignId]/overworldDraw";

// The region map's places (issue 548), lifted out of overworldDraw.ts: which
// dots it draws (places of their own, each standing for the parts filed
// under it), the routes between them, the dots themselves, and every name
// laid out so none prints over another. Sizes are in screen pixels, so
// zooming in spreads the dots and makes room for names that had none.

export const OVERWORLD_TILE = 16;

// A dot on the region map: a place of its own, standing for every part filed
// under it. It counts as visited, or as where the party is, when any of its
// parts is.
export type RegionPlace = {
  id: string;
  name: string;
  anchor: XY;
  visited: boolean;
  isCurrent: boolean;
  // The parts' names as read under this place ("Entrance Passage").
  parts: string[];
};

export function regionPlaces(locations: OverworldLocation[], tree: PlaceTree = placeTree(locations)): RegionPlace[] {
  const byId = new Map(locations.map((location) => [location.id, location]));
  return locations.flatMap((location) => {
    if (!location.anchor || tree.topOf(location.id) !== location.id) {
      return [];
    }
    const parts = tree.descendantsOf(location.id).flatMap((id) => byId.get(id) ?? []);
    return [
      {
        id: location.id,
        name: location.name,
        anchor: location.anchor,
        visited: location.visited || parts.some((part) => part.visited),
        isCurrent: location.isCurrent || parts.some((part) => part.isCurrent),
        parts: parts.map((part) => nameWithin(part.name, location.name)),
      },
    ];
  });
}

// The place whose dot is nearest a point in map pixels, within `reach` map
// pixels of it.
export function regionPlaceAt(places: RegionPlace[], at: XY, reach: number): RegionPlace | null {
  let best: RegionPlace | null = null;
  let bestDistance = reach;
  for (const place of places) {
    const distance = Math.hypot(
      place.anchor.x * OVERWORLD_TILE + OVERWORLD_TILE / 2 - at.x,
      place.anchor.y * OVERWORLD_TILE + OVERWORLD_TILE / 2 - at.y,
    );
    if (distance <= bestDistance) {
      best = place;
      bestDistance = distance;
    }
  }
  return best;
}

// What the names came to, for the panel's own checks: which places have
// their name on the map, and which wait for a zoom or a pointer.
export type DrawnNames = { shown: string[]; hidden: string[] };

// Sizes on screen, in CSS pixels; multiplied by `px` into map pixels.
const DOT = 4.5;
const NAME_FONT = 11;
const NAME_LINE = 13;

// Routes, pins and dots, under the words the DM wrote on the map. What it
// worked out is what the names are laid out from.
export function drawPlaceMarks(
  context: CanvasRenderingContext2D,
  data: OverworldData,
  options: DrawOptions,
): { places: RegionPlace[]; lit: Set<string>; px: number } {
  const tile = OVERWORLD_TILE;
  // One CSS pixel on screen, in map pixels.
  const px = 1 / (options.zoom ?? 1);
  const centre = (at: XY): XY => ({ x: at.x * tile + tile / 2, y: at.y * tile + tile / 2 });
  const tree = placeTree(data.locations);
  const places = regionPlaces(data.locations, tree);
  const lit = new Set(
    [
      options.hoveredLocationId,
      options.focusedLocationId,
      options.selectedLocationId,
      ...places.filter((place) => place.isCurrent).map((place) => place.id),
    ].filter((id): id is string => Boolean(id)),
  );
  const visited = new Set(places.filter((place) => place.visited).map((place) => place.id));

  drawRoutes(context, data.locations, tree, { lit, visited, px });

  // Lead pins under the location markers.
  for (const pin of data.map.pins) {
    const at = centre(pin);
    context.fillStyle = "rgba(190, 120, 240, 0.9)";
    context.beginPath();
    context.arc(at.x, at.y, 4 * px, 0, Math.PI * 2);
    context.fill();
  }

  // Places: solid dots for visited, ghost dots for known-unvisited, a ring
  // round a place with parts inside it, a pulse ring on the party's current
  // place, a soft ring on the one pointed at or tapped, and a bright ring on
  // whichever one the DM has picked up to move.
  for (const place of places) {
    const at = centre(place.anchor);
    if (place.isCurrent) {
      context.strokeStyle = "rgba(250, 200, 90, 0.85)";
      context.lineWidth = 2 * px;
      context.beginPath();
      context.arc(at.x, at.y, (7 + Math.sin(options.pulse / 12) * 2.5) * px, 0, Math.PI * 2);
      context.stroke();
    }
    if (options.selectedLocationId === place.id) {
      context.strokeStyle = "rgba(120, 220, 250, 0.95)";
      context.lineWidth = 2 * px;
      context.beginPath();
      context.arc(at.x, at.y, 10 * px, 0, Math.PI * 2);
      context.stroke();
    } else if (place.id === options.hoveredLocationId || place.id === options.focusedLocationId) {
      context.strokeStyle = "rgba(250, 240, 220, 0.8)";
      context.lineWidth = 1.5 * px;
      context.beginPath();
      context.arc(at.x, at.y, 8.5 * px, 0, Math.PI * 2);
      context.stroke();
    }
    if (place.parts.length) {
      context.strokeStyle = place.visited ? "rgba(250, 225, 160, 0.7)" : "rgba(250, 225, 160, 0.35)";
      context.lineWidth = 1 * px;
      context.beginPath();
      context.arc(at.x, at.y, (DOT + 2.5) * px, 0, Math.PI * 2);
      context.stroke();
    }
    context.fillStyle = place.visited ? "rgba(250, 225, 160, 0.95)" : "rgba(250, 225, 160, 0.4)";
    context.beginPath();
    context.arc(at.x, at.y, DOT * px, 0, Math.PI * 2);
    context.fill();
    context.strokeStyle = "rgba(30, 25, 15, 0.8)";
    context.lineWidth = 1 * px;
    context.stroke();
  }

  return { places, lit, px };
}

// Routes between places of their own, rolled up from every part's
// connections and thinned to the hops a road would take
// (src/lib/overworld/places.ts regionRoutes). A route reads by how much it
// matters now: bright from the place the party is at or the one being
// looked at, plain from a visited place, faint between two unvisited ones.
function drawRoutes(
  context: CanvasRenderingContext2D,
  locations: OverworldLocation[],
  tree: PlaceTree,
  look: { lit: Set<string>; visited: Set<string>; px: number },
) {
  const tile = OVERWORLD_TILE;
  const anchorOf = new Map(locations.map((location) => [location.id, location.anchor]));
  const tone = (route: { a: string; b: string }) =>
    look.lit.has(route.a) || look.lit.has(route.b) ? 2 : look.visited.has(route.a) || look.visited.has(route.b) ? 1 : 0;
  const routes = regionRoutes(locations, tree).sort((one, two) => tone(one) - tone(two));
  context.lineCap = "round";
  for (const route of routes) {
    const from = anchorOf.get(route.a);
    const to = anchorOf.get(route.b);
    if (!from || !to) {
      continue;
    }
    const level = tone(route);
    context.strokeStyle = ["rgba(240, 220, 170, 0.22)", "rgba(240, 220, 170, 0.5)", "rgba(250, 225, 160, 0.85)"][level];
    context.lineWidth = (level === 2 ? 2 : 1.5) * look.px;
    context.setLineDash([5 * look.px, 4 * look.px]);
    const fromX = from.x * tile + tile / 2;
    const fromY = from.y * tile + tile / 2;
    const toX = to.x * tile + tile / 2;
    const toY = to.y * tile + tile / 2;
    // A gentle bow, the same way for the same pair whichever end is listed.
    const midX = (fromX + toX) / 2 + (fromY - toY) * 0.12;
    const midY = (fromY + toY) / 2 + (toX - fromX) * 0.12;
    context.beginPath();
    context.moveTo(fromX, fromY);
    context.quadraticCurveTo(midX, midY, toX, toY);
    context.stroke();
  }
  context.setLineDash([]);
}

// The words already on the map that a place's name must not cover: the
// DM's own labels and the names of their roads and rivers.
function wordBoxes(context: CanvasRenderingContext2D, data: OverworldData): Box[] {
  const tile = OVERWORLD_TILE;
  const boxes: Box[] = [];
  for (const label of data.map.labels ?? []) {
    const large = label.size === "large";
    context.font = large ? "700 20px serif" : "600 11px sans-serif";
    const text = large ? label.text.toUpperCase() : label.text;
    const width = context.measureText(text).width;
    const size = large ? 20 : 11;
    boxes.push({ x: label.x * tile + tile / 2 - width / 2, y: label.y * tile + tile / 2 - size, width, height: size * 1.2 });
  }
  context.font = "italic 10px sans-serif";
  for (const path of data.map.paths ?? []) {
    if (!path.label || !path.points.length) {
      continue;
    }
    const middle = path.points[Math.floor(path.points.length / 2)];
    boxes.push({ x: middle.x * tile + tile / 2 + 5, y: middle.y * tile + tile / 2 - 14, width: context.measureText(path.label).width, height: 12 });
  }
  return boxes;
}

// Every place's name and every pin's label, laid out so none covers another
// (src/lib/overworld/label-layout.ts): where the party is first, then
// visited places, pins, and places not yet reached. The place pointed at,
// tapped or held shows its name whatever is in the way, over a dark plate.
export function drawNames(
  context: CanvasRenderingContext2D,
  data: OverworldData,
  places: RegionPlace[],
  look: { lit: Set<string>; px: number; party: XY | null; options: DrawOptions },
): DrawnNames {
  const tile = OVERWORLD_TILE;
  const { px, options } = look;
  const centre = (at: XY): XY => ({ x: at.x * tile + tile / 2, y: at.y * tile + tile / 2 });
  const forced = new Set(
    [options.hoveredLocationId, options.focusedLocationId, options.selectedLocationId].filter(Boolean),
  );
  // Names stay on the part of the map on screen: one whose dot is off it
  // waits, and one by the edge turns inward rather than running off it.
  const extent = { x: 0, y: 0, width: data.map.width * tile, height: data.map.height * tile };
  const seen = options.visible ?? extent;
  const bounds = {
    x: Math.max(extent.x, seen.x),
    y: Math.max(extent.y, seen.y),
    width: Math.min(extent.x + extent.width, seen.x + seen.width) - Math.max(extent.x, seen.x),
    height: Math.min(extent.y + extent.height, seen.y + seen.height) - Math.max(extent.y, seen.y),
  };
  const onScreen = (at: XY) =>
    at.x >= bounds.x && at.y >= bounds.y && at.x <= bounds.x + bounds.width && at.y <= bounds.y + bounds.height;
  const obstacles: Array<Box & { owner?: string }> = [
    ...wordBoxes(context, data),
    ...places.map((place) => {
      const at = centre(place.anchor);
      const radius = (place.parts.length ? DOT + 3 : DOT + 1) * px;
      return { owner: place.id, x: at.x - radius, y: at.y - radius, width: radius * 2, height: radius * 2 };
    }),
    ...data.map.pins.map((pin) => {
      const at = centre(pin);
      return { owner: `pin:${pin.id}`, x: at.x - 4 * px, y: at.y - 4 * px, width: 8 * px, height: 8 * px };
    }),
    ...(look.party ? [{ x: look.party.x - 6 * px, y: look.party.y - 7 * px, width: 12 * px, height: 13 * px }] : []),
  ];
  const requests: LabelRequest[] = [
    ...places.filter((place) => onScreen(centre(place.anchor))).map((place) => {
      const at = centre(place.anchor);
      return {
        id: place.id,
        text: place.name,
        x: at.x,
        y: at.y,
        radius: (place.parts.length ? DOT + 2.5 : DOT) * px,
        rank: place.isCurrent ? 0 : place.visited ? 1 : 3,
        // Where the party is always has its name, and so does every place
        // in the exported picture, which no one can point at.
        force: forced.has(place.id) || place.isCurrent || Boolean(options.allNames),
      };
    }),
    ...data.map.pins
      .filter((pin) => pin.label && onScreen(centre(pin)))
      .map((pin) => ({ id: `pin:${pin.id}`, text: pin.label, ...centre(pin), radius: 4 * px, rank: 2, force: Boolean(options.allNames) })),
  ];
  context.font = `600 ${NAME_FONT * px}px sans-serif`;
  const { placed, hidden } = layoutLabels(requests, {
    measure: (text) => context.measureText(text).width,
    height: NAME_LINE * px,
    gap: 4 * px,
    pad: 3 * px,
    obstacles,
    bounds,
  });
  const byId = new Map(places.map((place) => [place.id, place]));
  context.textBaseline = "middle";
  context.lineJoin = "round";
  for (const label of placed) {
    const place = byId.get(label.id);
    const middleY = label.box.y + label.box.height / 2;
    if (forced.has(label.id)) {
      context.fillStyle = "rgba(12, 10, 8, 0.82)";
      const plate = { x: label.box.x - 3 * px, y: label.box.y - 1 * px, width: label.box.width + 6 * px, height: label.box.height + 2 * px };
      context.beginPath();
      if (typeof context.roundRect === "function") {
        context.roundRect(plate.x, plate.y, plate.width, plate.height, 3 * px);
      } else {
        context.rect(plate.x, plate.y, plate.width, plate.height);
      }
      context.fill();
    }
    context.lineWidth = 3 * px;
    context.strokeStyle = "rgba(20, 16, 10, 0.8)";
    context.strokeText(label.text, label.box.x, middleY);
    context.fillStyle = !place
      ? "rgba(220, 190, 250, 0.95)"
      : place.isCurrent
        ? "rgba(255, 214, 130, 1)"
        : place.visited || forced.has(label.id)
          ? "rgba(250, 240, 220, 0.95)"
          : "rgba(250, 240, 220, 0.62)";
    context.fillText(label.text, label.box.x, middleY);
  }
  context.textBaseline = "alphabetic";
  return {
    shown: placed.filter((label) => byId.has(label.id)).map((label) => label.id),
    hidden: hidden.filter((id) => byId.has(id)),
  };
}

