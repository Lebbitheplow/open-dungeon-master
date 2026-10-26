// How a region's places sit together (issue 548): which are parts of a
// bigger place and so stay off the region map, which routes the map draws
// once those parts fold into their places, and where a new place lands when
// the story says which way it lies. Pure and alias-free like logic.ts, so the
// scripts can load it directly; the rims are src/lib/db/locations.ts and
// src/lib/db/overworld.ts.

import { textKey } from "../language/text-logic.ts";
import { fnv1a, mulberry32, type XY } from "./logic.ts";

// A place's own word on what it belongs to: a name when it is part of that
// place, and null or "" when it is a place of its own ("" when the DM said
// so, which the model's partOf does not overturn). The word is written when
// the place is made (move_party's partOf, or the name rule below), by the DM
// from the area list, or once by the upgrade that brought this column
// (src/lib/db/place-parents-backfill.ts); nothing reads a parent off a name
// later, so adding a place never re-files the places already on the map.
export type PlaceRef = { id: string; name: string; parentName?: string | null };

// The place a new name opens with, as whole words: "Duskleaf Shrine Root
// Cellar" opens with "Duskleaf Shrine", "Thornhollow" does not open with
// "Thorn". The longest such place wins, so a cellar of a hall of a village
// files under the hall.
export function placeNamedInside<T extends { name: string }>(name: string, places: T[]): T | null {
  const key = textKey(name);
  let best: { place: T; length: number } | null = null;
  for (const place of places) {
    const other = textKey(place.name);
    if (!other || other.length >= key.length) {
      continue;
    }
    if (key.startsWith(`${other} `) && (!best || other.length > best.length)) {
      best = { place, length: other.length };
    }
  }
  return best?.place ?? null;
}

// For places already on record when parents arrived: each one the name rule
// files under another, as a map of id to that place's name. A part whose
// dot already stands far from its place's (more than `reach` tiles) is a
// place of its own that happens to share a name, the way a city and the
// keep a day's ride from it might, and is left alone.
export function parentsByName(
  places: Array<{ id: string; name: string }>,
  anchors: Record<string, XY> = {},
  reach = 12,
): Map<string, string> {
  const out = new Map<string, string>();
  for (const place of places) {
    const parent = placeNamedInside(place.name, places.filter((other) => other.id !== place.id));
    if (!parent) {
      continue;
    }
    const own = anchors[place.id];
    const theirs = anchors[parent.id];
    if (own && theirs && Math.max(Math.abs(own.x - theirs.x), Math.abs(own.y - theirs.y)) > reach) {
      continue;
    }
    out.set(place.id, parent.name);
  }
  return out;
}

// Each place's parent id, or null for a place of its own. A parent name that
// is no longer a place leaves the place on its own, and a loop (A in B, B in
// A, which renames can make) is cut where it closes, so every chain ends at a
// place of its own.
export function resolveParents(places: PlaceRef[]): Map<string, string | null> {
  const idByKey = new Map(places.map((place) => [textKey(place.name), place.id]));
  const parents = new Map<string, string | null>();
  for (const place of places) {
    const said = place.parentName;
    const parent = typeof said === "string" && said.trim() ? (idByKey.get(textKey(said)) ?? null) : null;
    parents.set(place.id, parent && parent !== place.id ? parent : null);
  }
  // Only the loop's own links are candidates, never the path that led in.
  for (const place of places) {
    const path = [place.id];
    let at = parents.get(place.id) ?? null;
    while (at) {
      if (path.includes(at)) {
        parents.set(path[path.length - 1], null);
        break;
      }
      path.push(at);
      at = parents.get(at) ?? null;
    }
  }
  return parents;
}

export type PlaceTree = {
  parentOf: Map<string, string | null>;
  // The place of its own a place is part of, itself when it is one.
  topOf: (id: string) => string;
  // Direct parts, in the order the places came in.
  childrenOf: Map<string, string[]>;
  // Every part below a place, nearest first.
  descendantsOf: (id: string) => string[];
};

export function placeTree(places: PlaceRef[]): PlaceTree {
  const parentOf = resolveParents(places);
  const childrenOf = new Map<string, string[]>();
  for (const place of places) {
    const parent = parentOf.get(place.id);
    if (parent) {
      childrenOf.set(parent, [...(childrenOf.get(parent) ?? []), place.id]);
    }
  }
  const topOf = (id: string) => {
    let at = id;
    // Bounded by the count: resolveParents already cut every loop.
    for (let step = 0; step <= places.length; step += 1) {
      const parent = parentOf.get(at);
      if (!parent) {
        return at;
      }
      at = parent;
    }
    return at;
  };
  const descendantsOf = (id: string) => {
    const out: string[] = [];
    const queue = [...(childrenOf.get(id) ?? [])];
    while (queue.length) {
      const next = queue.shift()!;
      if (!out.includes(next)) {
        out.push(next);
        queue.push(...(childrenOf.get(next) ?? []));
      }
    }
    return out;
  };
  return { parentOf, topOf, childrenOf, descendantsOf };
}

// The anchors of places of their own, which are the ones the map draws and
// so the ones a new place has to keep clear of. A part's old anchor (from
// before it was filed under its place) is kept, so that unfiling it puts it
// back where it stood, but it no longer takes up ground.
export function drawnAnchors(anchors: Record<string, XY>, tree: PlaceTree, except = ""): XY[] {
  return Object.entries(anchors)
    .filter(([id]) => id !== except && tree.topOf(id) === id)
    .map(([, at]) => at);
}

// A part's name under its place, for a list that already shows the place:
// "Hollowroot Vault Entrance Passage" under Hollowroot Vault reads
// "Entrance Passage". A name that does not start with its place's is kept
// whole, and so is one that would be left empty.
export function nameWithin(name: string, parentName: string): string {
  if (!parentName || !textKey(name).startsWith(`${textKey(parentName)} `)) {
    return name;
  }
  // The folded names agree word for word, so the part's own spelling loses
  // as many words as its place's name has, and any dash or colon after them.
  const dropped = parentName.trim().split(/\s+/).length;
  const rest = name
    .trim()
    .split(/\s+/)
    .slice(dropped)
    .join(" ")
    .replace(/^[\s,:;.\-–—]+/u, "")
    .trim();
  return rest || name;
}

// ---- which way and how far ----

// The eight points a DM says a place lies in, from the place the party set
// out from. North is the top of the map.
export const PLACE_DIRECTIONS = [
  "north",
  "northeast",
  "east",
  "southeast",
  "south",
  "southwest",
  "west",
  "northwest",
] as const;
export type PlaceDirection = (typeof PLACE_DIRECTIONS)[number];

// How far, in the words a DM uses, and the tiles each is on the region map.
// The map has no printed scale; these keep a day's walk a good stretch of a
// default 96-tile map and "nearby" clear of the place it is near, and they
// bracket the 4 to 7 tiles a place lands at when nothing was said.
export const PLACE_DISTANCES = ["nearby", "a few hours", "half a day", "a day", "several days"] as const;
export type PlaceDistance = (typeof PLACE_DISTANCES)[number];
const DISTANCE_TILES: Record<PlaceDistance, number> = {
  nearby: 3,
  "a few hours": 5,
  "half a day": 7,
  "a day": 11,
  "several days": 18,
};

const DIRECTION_WORDS: Record<string, PlaceDirection> = {
  n: "north",
  north: "north",
  ne: "northeast",
  northeast: "northeast",
  e: "east",
  east: "east",
  se: "southeast",
  southeast: "southeast",
  s: "south",
  south: "south",
  sw: "southwest",
  southwest: "southwest",
  w: "west",
  west: "west",
  nw: "northwest",
  northwest: "northwest",
};

// move_party's direction, one of the listed points (the enum the model is
// given), as it was sent or in the spellings of that same point ("north-
// east", "NE"); anything else is no direction at all, never a guess.
export function normalizeDirection(raw: unknown): PlaceDirection | null {
  if (typeof raw !== "string") {
    return null;
  }
  const folded = raw.toLowerCase().replace(/[^a-z]/g, "");
  return DIRECTION_WORDS[folded] ?? null;
}

// move_party's distance, one of the listed values whatever its case or
// spacing; anything else is no distance.
export function normalizeDistance(raw: unknown): PlaceDistance | null {
  if (typeof raw !== "string") {
    return null;
  }
  const folded = raw.toLowerCase().replace(/[\s_-]+/g, " ").trim();
  return (PLACE_DISTANCES as readonly string[]).includes(folded) ? (folded as PlaceDistance) : null;
}

const DIRECTION_ANGLE: Record<PlaceDirection, number> = {
  east: 0,
  southeast: Math.PI / 4,
  south: Math.PI / 2,
  southwest: (3 * Math.PI) / 4,
  west: Math.PI,
  northwest: (5 * Math.PI) / 4,
  north: (3 * Math.PI) / 2,
  northeast: (7 * Math.PI) / 4,
};

// The tile a place should stand on when the DM said which way and how far it
// lies from `from`. Either may be missing: no direction takes one hashed
// from the name (the old placement's), no distance takes half a day. A small
// turn and stretch hashed from the name keep three places "north, a day"
// from one village from standing in a file.
export function spotFrom(
  from: XY,
  hint: { direction?: PlaceDirection | null; distance?: PlaceDistance | null },
  name: string,
): XY {
  const rng = mulberry32(fnv1a(`spot:${textKey(name)}`));
  const angle = hint.direction
    ? DIRECTION_ANGLE[hint.direction] + (rng() - 0.5) * (Math.PI / 8)
    : rng() * Math.PI * 2;
  const tiles = DISTANCE_TILES[hint.distance ?? "half a day"] * (0.9 + rng() * 0.2);
  return {
    x: Math.round(from.x + Math.cos(angle) * tiles),
    y: Math.round(from.y + Math.sin(angle) * tiles),
  };
}

// ---- the routes the region map draws ----

export type RoutePlace = PlaceRef & { connections: string[]; anchor: XY | null };
export type Route = { a: string; b: string };

// Every connection, from every place and part, drawn between the places of
// their own it belongs to: the vault's entrance leading to the forest road is
// the vault's route. A route inside one place is dropped, each pair is drawn
// once, and a long route is left out when the map already draws the way
// through a third place on the path (A to C, when A to B to C runs about as
// far), so short hops read as a road and not a net.
export function regionRoutes(places: RoutePlace[], tree: PlaceTree = placeTree(places)): Route[] {
  const idByKey = new Map(places.map((place) => [textKey(place.name), place.id]));
  const anchorOf = new Map(places.map((place) => [place.id, place.anchor]));
  const pairs = new Map<string, Route>();
  for (const place of places) {
    const from = tree.topOf(place.id);
    for (const connection of place.connections) {
      const target = idByKey.get(textKey(connection));
      if (!target) {
        continue;
      }
      const to = tree.topOf(target);
      if (to === from || !anchorOf.get(from) || !anchorOf.get(to)) {
        continue;
      }
      const [a, b] = [from, to].sort();
      pairs.set(`${a}|${b}`, { a, b });
    }
  }
  const length = (route: Route) => {
    const one = anchorOf.get(route.a)!;
    const two = anchorOf.get(route.b)!;
    return Math.hypot(one.x - two.x, one.y - two.y);
  };
  // Shortest first, and a route is left out only when both legs of the way
  // round are routes already kept: so the way round is always drawn, and no
  // place loses its last route to a shortcut that was itself left out.
  const kept = new Map<string, Route>();
  const keptBetween = (a: string, b: string) => kept.get([a, b].sort().join("|"));
  for (const route of [...pairs.values()].sort((one, two) => length(one) - length(two))) {
    const direct = length(route);
    const ends = new Set([...kept.values()].flatMap((other) => [other.a, other.b]));
    const roundabout = [...ends].some((via) => {
      if (via === route.a || via === route.b) {
        return false;
      }
      const first = keptBetween(route.a, via);
      const second = keptBetween(via, route.b);
      return first && second && length(first) + length(second) <= direct * 1.15;
    });
    if (!roundabout) {
      kept.set(`${route.a}|${route.b}`, route);
    }
  }
  return [...kept.values()];
}
