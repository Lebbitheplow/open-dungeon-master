// The placed objects of a map as one list the editors can select from
// (docs/vtt-parity-implementation-plan.md sections 10.1 and 10.8): labels,
// props, lights, door states, zones and drawings. Pure: every function
// returns the new lists for the caller to save whole, so the selection
// model, the objects panel and the undo ring all speak the same shape.

import type { MapLight, XY } from "@/lib/battlemap/types";
import type {
  DoorStates,
  LightZone,
  MapDrawing,
  MapLabel,
  MapProp,
} from "@/lib/battlemap/scene";
import { doorKey, parseDoorKey } from "@/lib/battlemap/scene";

export type MapObjects = {
  labels: MapLabel[];
  props: MapProp[];
  lights: MapLight[];
  doors: DoorStates;
  zones: LightZone[];
  drawings: MapDrawing[];
};

export type ObjectKind = keyof MapObjects;

// A handle to one object: its kind and where it stands (or its index for
// the two kinds without a single tile).
export type ObjectRef =
  | { kind: "labels"; x: number; y: number }
  | { kind: "props"; x: number; y: number }
  | { kind: "lights"; x: number; y: number }
  | { kind: "doors"; x: number; y: number }
  | { kind: "zones"; index: number }
  | { kind: "drawings"; id: string };

export const OBJECT_LABELS: Record<ObjectKind, string> = {
  labels: "Label",
  props: "Prop",
  lights: "Light",
  doors: "Door",
  zones: "Light zone",
  drawings: "Drawing",
};

export function emptyObjects(): MapObjects {
  return { labels: [], props: [], lights: [], doors: {}, zones: [], drawings: [] };
}

export function refKey(ref: ObjectRef): string {
  switch (ref.kind) {
    case "zones":
      return `zones:${ref.index}`;
    case "drawings":
      return `drawings:${ref.id}`;
    default:
      return `${ref.kind}:${ref.x},${ref.y}`;
  }
}

export function sameRef(a: ObjectRef | null, b: ObjectRef | null): boolean {
  return a !== null && b !== null && refKey(a) === refKey(b);
}

// What stands on a tile, smallest thing first: a label or a prop or a
// light before the zone that happens to cover the tile.
export function objectAt(objects: MapObjects, x: number, y: number): ObjectRef | null {
  if (objects.labels.some((entry) => entry.x === x && entry.y === y)) {
    return { kind: "labels", x, y };
  }
  if (objects.props.some((entry) => entry.x === x && entry.y === y)) {
    return { kind: "props", x, y };
  }
  if (objects.lights.some((entry) => entry.x === x && entry.y === y)) {
    return { kind: "lights", x, y };
  }
  if (objects.doors[doorKey(x, y)]) {
    return { kind: "doors", x, y };
  }
  for (let index = objects.zones.length - 1; index >= 0; index -= 1) {
    const zone = objects.zones[index];
    if (x >= zone.x0 && x <= zone.x1 && y >= zone.y0 && y <= zone.y1) {
      return { kind: "zones", index };
    }
  }
  return null;
}

// Every object, in a stable reading order for the objects panel.
export function listObjects(objects: MapObjects): Array<{ ref: ObjectRef; name: string; detail: string; dmOnly: boolean }> {
  const out: Array<{ ref: ObjectRef; name: string; detail: string; dmOnly: boolean }> = [];
  for (const label of objects.labels) {
    out.push({
      ref: { kind: "labels", x: label.x, y: label.y },
      name: label.text,
      detail: `Label at ${label.x},${label.y}${label.ref ? ` (opens ${label.ref.kind})` : ""}`,
      dmOnly: label.dmOnly,
    });
  }
  for (const prop of objects.props) {
    out.push({
      ref: { kind: "props", x: prop.x, y: prop.y },
      name: prop.name,
      detail: `${prop.kind === "npc" ? "Bystander" : "Prop"} at ${prop.x},${prop.y}`,
      dmOnly: false,
    });
  }
  for (const light of objects.lights) {
    out.push({
      ref: { kind: "lights", x: light.x, y: light.y },
      name: `Light ${light.brightRadius * 5} ft`,
      detail: `at ${light.x},${light.y}, dim to ${light.dimRadius * 5} ft`,
      dmOnly: false,
    });
  }
  for (const [key, state] of Object.entries(objects.doors)) {
    const at = parseDoorKey(key);
    if (at) {
      out.push({ ref: { kind: "doors", ...at }, name: `${state === "locked" ? "Locked" : "Secret"} door`, detail: `at ${at.x},${at.y}`, dmOnly: true });
    }
  }
  objects.zones.forEach((zone, index) => {
    out.push({
      ref: { kind: "zones", index },
      name: zone.kind === "light" ? `${zone.ambient} zone` : zone.kind.replace("_", " "),
      detail: `${zone.x0},${zone.y0} to ${zone.x1},${zone.y1}`,
      dmOnly: false,
    });
  });
  for (const drawing of objects.drawings) {
    out.push({
      ref: { kind: "drawings", id: drawing.id },
      name: `${drawing.kind} in ${drawing.tone}`,
      detail: `${drawing.points.length} points`,
      dmOnly: drawing.dmOnly,
    });
  }
  return out;
}

export function removeObjects(objects: MapObjects, refs: ObjectRef[]): MapObjects {
  const keys = new Set(refs.map(refKey));
  const next: MapObjects = {
    labels: objects.labels.filter((entry) => !keys.has(refKey({ kind: "labels", x: entry.x, y: entry.y }))),
    props: objects.props.filter((entry) => !keys.has(refKey({ kind: "props", x: entry.x, y: entry.y }))),
    lights: objects.lights.filter((entry) => !keys.has(refKey({ kind: "lights", x: entry.x, y: entry.y }))),
    doors: Object.fromEntries(
      Object.entries(objects.doors).filter(([key]) => {
        const at = parseDoorKey(key);
        return !at || !keys.has(refKey({ kind: "doors", ...at }));
      }),
    ),
    zones: objects.zones.filter((_, index) => !keys.has(refKey({ kind: "zones", index }))),
    drawings: objects.drawings.filter((entry) => !keys.has(refKey({ kind: "drawings", id: entry.id }))),
  };
  return next;
}

// Move one object to a new anchor. A zone keeps its size; a door state
// follows the door only if the destination is also a door, which the
// caller decides (the terrain is not known here), so doors do not move.
export function moveObject(objects: MapObjects, ref: ObjectRef, to: XY): MapObjects {
  switch (ref.kind) {
    case "labels":
      return {
        ...objects,
        labels: objects.labels
          .filter((entry) => !(entry.x === to.x && entry.y === to.y))
          .map((entry) => (entry.x === ref.x && entry.y === ref.y ? { ...entry, x: to.x, y: to.y } : entry)),
      };
    case "props":
      return {
        ...objects,
        props: objects.props
          .filter((entry) => !(entry.x === to.x && entry.y === to.y))
          .map((entry) => (entry.x === ref.x && entry.y === ref.y ? { ...entry, x: to.x, y: to.y } : entry)),
      };
    case "lights":
      return {
        ...objects,
        lights: objects.lights
          .filter((entry) => !(entry.x === to.x && entry.y === to.y))
          .map((entry) => (entry.x === ref.x && entry.y === ref.y ? { ...entry, x: to.x, y: to.y } : entry)),
      };
    case "zones": {
      const zone = objects.zones[ref.index];
      if (!zone) {
        return objects;
      }
      const w = zone.x1 - zone.x0;
      const h = zone.y1 - zone.y0;
      const moved = { ...zone, x0: to.x, y0: to.y, x1: to.x + w, y1: to.y + h };
      return { ...objects, zones: objects.zones.map((entry, index) => (index === ref.index ? moved : entry)) };
    }
    default:
      return objects;
  }
}

// A copy one tile to the right (or below when the right is taken).
export function duplicateObject(objects: MapObjects, ref: ObjectRef, width: number, height: number): MapObjects {
  const spot = (x: number, y: number, taken: (x: number, y: number) => boolean): XY | null => {
    const candidates = [
      { x: x + 1, y },
      { x, y: y + 1 },
      { x: x - 1, y },
      { x, y: y - 1 },
    ];
    return candidates.find((c) => c.x >= 0 && c.y >= 0 && c.x < width && c.y < height && !taken(c.x, c.y)) ?? null;
  };
  switch (ref.kind) {
    case "labels": {
      const source = objects.labels.find((entry) => entry.x === ref.x && entry.y === ref.y);
      const at = source && spot(ref.x, ref.y, (x, y) => objects.labels.some((e) => e.x === x && e.y === y));
      return source && at ? { ...objects, labels: [...objects.labels, { ...source, ...at }] } : objects;
    }
    case "props": {
      const source = objects.props.find((entry) => entry.x === ref.x && entry.y === ref.y);
      const at = source && spot(ref.x, ref.y, (x, y) => objects.props.some((e) => e.x === x && e.y === y));
      return source && at ? { ...objects, props: [...objects.props, { ...source, ...at }] } : objects;
    }
    case "lights": {
      const source = objects.lights.find((entry) => entry.x === ref.x && entry.y === ref.y);
      const at = source && spot(ref.x, ref.y, (x, y) => objects.lights.some((e) => e.x === x && e.y === y));
      return source && at ? { ...objects, lights: [...objects.lights, { ...source, ...at }] } : objects;
    }
    case "zones": {
      const zone = objects.zones[ref.index];
      if (!zone) {
        return objects;
      }
      const w = zone.x1 - zone.x0 + 1;
      const x0 = zone.x1 + 1 + w <= width ? zone.x1 + 1 : zone.x0;
      const y0 = x0 === zone.x0 ? Math.min(height - 1, zone.y1 + 1) : zone.y0;
      const moved = { ...zone, x0, y0, x1: Math.min(width - 1, x0 + w - 1), y1: Math.min(height - 1, y0 + (zone.y1 - zone.y0)) };
      return { ...objects, zones: [...objects.zones, moved] };
    }
    default:
      return objects;
  }
}

// Flip DM-only on every ref that has the flag.
export function setDmOnly(objects: MapObjects, refs: ObjectRef[], dmOnly: boolean): MapObjects {
  const keys = new Set(refs.map(refKey));
  return {
    ...objects,
    labels: objects.labels.map((entry) =>
      keys.has(refKey({ kind: "labels", x: entry.x, y: entry.y })) ? { ...entry, dmOnly } : entry,
    ),
    drawings: objects.drawings.map((entry) =>
      keys.has(refKey({ kind: "drawings", id: entry.id })) ? { ...entry, dmOnly } : entry,
    ),
  };
}

// The tiles a ref covers, for the selection outline.
export function refBounds(objects: MapObjects, ref: ObjectRef): { x0: number; y0: number; x1: number; y1: number } | null {
  if (ref.kind === "zones") {
    const zone = objects.zones[ref.index];
    return zone ? { x0: zone.x0, y0: zone.y0, x1: zone.x1, y1: zone.y1 } : null;
  }
  if (ref.kind === "drawings") {
    const drawing = objects.drawings.find((entry) => entry.id === ref.id);
    if (!drawing) {
      return null;
    }
    const xs = drawing.points.map((p) => p.x);
    const ys = drawing.points.map((p) => p.y);
    return {
      x0: Math.floor(Math.min(...xs)),
      y0: Math.floor(Math.min(...ys)),
      x1: Math.floor(Math.max(...xs)),
      y1: Math.floor(Math.max(...ys)),
    };
  }
  return { x0: ref.x, y0: ref.y, x1: ref.x, y1: ref.y };
}
