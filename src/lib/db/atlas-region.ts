import { listLocations } from "@/lib/db/locations";
import { getOverworld, setOverworldAnchor, setOverworldBackdrop } from "@/lib/db/overworld";
import { getWorldDoc, saveWorldDoc } from "@/lib/db/world-forge";
import { imageSize } from "@/lib/image-format";
import { isUploadedImagePath } from "@/lib/uploads";
import { readUploadedImage } from "@/lib/uploads-store";
import {
  boundPins,
  frameOf,
  pinToRegion,
  placeIdOf,
  regionMapOf,
  regionToPin,
  type Cell,
  type GridSize,
} from "@/lib/worldforge/atlas-frame";
import { readFrame, without, type AtlasMap, type MapFrame, type Pin, type WorldDoc, type XY } from "@/lib/worldforge/model";

// The bridge between WorldForge's Atlas and the campaign's playable Region
// map (audit finding WF-09), in four explicit steps:
//
//   - "Use this Atlas map as the Region backdrop": the Region shows the
//     map's own uploaded picture (the same file, not a copy), and the map
//     is recorded as the one standing over the Region.
//   - "Place this location in the Region": a pin on that map moves its
//     place's Region marker to the cell under it, and is bound to it.
//   - Afterwards a bound pin and its place's marker move together, from
//     either side, and every move says where things stood before.
//   - Releasing a pin, or the map, ends the binding and moves nothing.
//
// Every step that moves something answers first with what would change
// (the marker's spot now and after), and changes it only when asked. A pin
// is bound only by the second step, never because it happens to name a
// place. The picture is only ever a picture: the Region's tiles still
// decide where a place may stand, and nothing about walls, terrain or
// light is read from it.

export type Failure = { error: string; status: number };

// One place's Region marker, before and after a step.
export type Placement = {
  pinId: string;
  pin: string;
  locationId: string;
  name: string;
  before: Cell | null;
  after: Cell;
  // False for a pin in a letterboxed map's empty band: its place goes to
  // the nearest edge of the picture.
  onPicture: boolean;
};

// One pin on the Atlas, before and after its place's marker moved.
export type PinMove = {
  pinId: string;
  pin: string;
  locationId: string;
  name: string;
  before: XY;
  after: XY;
  // False when the cell is in the part of a cropped picture the map does
  // not show: the pin waits at the nearest edge.
  onSurface: boolean;
};

export const PICTURE_ONLY =
  "The picture is shown over the Region's ground. The ground's tiles still decide where places may stand; walls, terrain and light are never read from a picture.";

const gridOf = (region: { width: number; height: number }): GridSize => ({ width: region.width, height: region.height });
const sameCell = (a: Cell | null | undefined, b: Cell | null | undefined) => Boolean(a && b && a.x === b.x && a.y === b.y);

function placeNames(campaignId: string): Map<string, string> {
  return new Map(listLocations(campaignId).map((location) => [location.id, location.name]));
}

// The width over height of an uploaded picture, or 0 when it cannot be read.
export async function pictureAspect(path: string): Promise<number> {
  const read = await readUploadedImage(path);
  return read ? aspectOfBytes(read.bytes) : 0;
}

// ---- where things stand ----

export type RegionBridge = {
  map: { id: string; name: string; image: string; frame: MapFrame } | null;
  backdropPath: string;
  // Whether the Region still shows that map's own picture. A DM may since
  // have chosen another one in the Region's own tools; the binding stays,
  // and this says so.
  backdropIsMap: boolean;
  grid: GridSize;
  pins: Array<{ pinId: string; pin: string; locationId: string; name: string; anchor: Cell | null; expected: Cell; inStep: boolean }>;
  notes: string[];
};

export function regionBridge(campaignId: string): RegionBridge {
  const doc = getWorldDoc(campaignId);
  const region = getOverworld(campaignId);
  const atlas = regionMapOf(doc);
  const names = placeNames(campaignId);
  const frame = frameOf(atlas);
  return {
    map: atlas ? { id: atlas.id, name: atlas.name, image: atlas.image, frame } : null,
    backdropPath: region.backdropPath,
    backdropIsMap: Boolean(atlas?.image && atlas.image === region.backdropPath),
    grid: gridOf(region),
    pins: boundPins(doc).flatMap((pin) => {
      const locationId = placeIdOf(pin);
      if (!names.has(locationId)) return [];
      const expected = pinToRegion(frame, pin, gridOf(region)).cell;
      const anchor = region.anchors[locationId] ?? null;
      return [{ pinId: pin.id, pin: pin.name, locationId, name: names.get(locationId)!, anchor, expected, inStep: sameCell(anchor, expected) }];
    }),
    notes: [PICTURE_ONLY],
  };
}

// ---- "Use this Atlas map as the Region backdrop" ----

export type BackdropPlan = {
  map: { id: string; name: string; image: string };
  before: { backdropPath: string; mapId: string | null };
  after: { backdropPath: string; mapId: string };
  frame: MapFrame;
  // Pins bound on the map that stood over the Region until now: their
  // places stay where they are, and the pins stop moving them.
  released: Array<{ pinId: string; pin: string }>;
  // Places whose markers move because the picture's shape was measured
  // afresh (only when the map already stood over the Region).
  placements: Placement[];
  notes: string[];
  applied: boolean;
};

// The map made the one over the Region, in a document: every other map
// gives up the role and its pins their bindings.
function standOverRegion(doc: WorldDoc, mapId: string, frame: MapFrame | undefined): { doc: WorldDoc; released: Pin[] } {
  const released: Pin[] = [];
  const maps = doc.maps.map((atlas): AtlasMap => {
    const rest = without(atlas, "role", "frame");
    if (atlas.id === mapId) return { ...rest, role: "region", ...(frame ? { frame } : {}) };
    return { ...rest, ...(atlas.frame ? { frame: atlas.frame } : {}) };
  });
  const pins = doc.pins.map((pin) => {
    if (!pin.regionLink || pin.mapId === mapId) return pin;
    released.push(pin);
    return without(pin, "regionLink");
  });
  return { doc: { ...doc, maps, pins }, released };
}

// The map's frame with the picture's shape measured. A map with no frame
// of its own was placed on the workshop's 16:10 box.
function measured(atlas: AtlasMap, aspect: number): MapFrame | undefined {
  return aspect ? readFrame({ ...frameOf(atlas), image: aspect }) : atlas.frame;
}

export async function backdropFromAtlas(campaignId: string, mapId: string, apply: boolean): Promise<BackdropPlan | Failure> {
  const image = getWorldDoc(campaignId).maps.find((entry) => entry.id === mapId)?.image ?? "";
  // The picture is measured before the document is read for writing, so
  // nothing saved while the file is read is lost.
  const aspect = isUploadedImagePath(image) ? await pictureAspect(image) : 0;
  const doc = getWorldDoc(campaignId);
  const atlas = doc.maps.find((entry) => entry.id === mapId);
  if (!atlas) return { error: "That map is not in this world.", status: 404 };
  if (!atlas.image || !isUploadedImagePath(atlas.image)) {
    return { error: "This map has no picture to show yet. Give it one first.", status: 400 };
  }
  const region = getOverworld(campaignId);
  const current = regionMapOf(doc);
  const frame = measured(atlas, atlas.image === image ? aspect : 0);
  const next = standOverRegion(doc, atlas.id, frame);
  const placements = followPins(campaignId, doc, next.doc, false);
  const plan: BackdropPlan = {
    map: { id: atlas.id, name: atlas.name, image: atlas.image },
    before: { backdropPath: region.backdropPath, mapId: current?.id ?? null },
    after: { backdropPath: atlas.image, mapId: atlas.id },
    frame: frame ?? frameOf(null),
    released: next.released.map((pin) => ({ pinId: pin.id, pin: pin.name })),
    placements,
    notes: [PICTURE_ONLY, "Everyone at the table sees the Region's picture, so the players will see this map's art."],
    applied: false,
  };
  if (!apply) return plan;
  saveWorldDoc(campaignId, next.doc);
  setOverworldBackdrop(campaignId, atlas.image);
  followPins(campaignId, doc, next.doc, true);
  return { ...plan, applied: true };
}

export type UnlinkResult = {
  map: { id: string; name: string } | null;
  released: Array<{ pinId: string; pin: string }>;
  before: { backdropPath: string };
  after: { backdropPath: string };
};

// The map stops standing over the Region. Every place stays where it is;
// the Region keeps the picture unless `clearBackdrop` asks, and then only
// while it is still this map's own.
export function unlinkRegionMap(campaignId: string, clearBackdrop: boolean): UnlinkResult {
  const doc = getWorldDoc(campaignId);
  const atlas = regionMapOf(doc);
  const region = getOverworld(campaignId);
  const before = { backdropPath: region.backdropPath };
  if (!atlas) return { map: null, released: [], before, after: before };
  const released = doc.pins.filter((pin) => pin.regionLink);
  saveWorldDoc(campaignId, {
    ...doc,
    maps: doc.maps.map((entry) => without(entry, "role")),
    pins: doc.pins.map((pin) => without(pin, "regionLink")),
  });
  const clears = clearBackdrop && region.backdropPath && region.backdropPath === atlas.image;
  if (clears) setOverworldBackdrop(campaignId, "");
  return {
    map: { id: atlas.id, name: atlas.name },
    released: released.map((pin) => ({ pinId: pin.id, pin: pin.name })),
    before,
    after: { backdropPath: clears ? "" : region.backdropPath },
  };
}

// ---- "Place this location in the Region" ----

export type PlacePlan = {
  placements: Placement[];
  // Pins asked for that cannot place anything, and why.
  skipped: Array<{ pinId: string; reason: string }>;
  applied: boolean;
};

// Pins on the map over the Region that name a place: the ones asked for,
// or every one. Without `apply` this only says what would move.
export function placeInRegion(campaignId: string, pinIds: string[] | null, apply: boolean): PlacePlan | Failure {
  const doc = getWorldDoc(campaignId);
  const atlas = regionMapOf(doc);
  if (!atlas) {
    return { error: "No Atlas map stands over the Region yet. Use one as the Region backdrop first.", status: 409 };
  }
  const region = getOverworld(campaignId);
  const names = placeNames(campaignId);
  const frame = frameOf(atlas);
  const wanted = pinIds ? new Set(pinIds) : null;
  const skipped: PlacePlan["skipped"] = [];
  for (const id of wanted ?? []) {
    const pin = doc.pins.find((entry) => entry.id === id);
    if (!pin) skipped.push({ pinId: id, reason: "There is no such pin." });
    else if (pin.mapId !== atlas.id) skipped.push({ pinId: id, reason: `It is not on ${atlas.name}, the map over the Region.` });
    else if (!names.has(placeIdOf(pin))) skipped.push({ pinId: id, reason: "It does not name a place." });
  }
  const chosen = doc.pins.filter((pin) => pin.mapId === atlas.id && names.has(placeIdOf(pin)) && (!wanted || wanted.has(pin.id)));
  const placements = chosen.map((pin): Placement => {
    const locationId = placeIdOf(pin);
    const at = pinToRegion(frame, pin, gridOf(region));
    return { pinId: pin.id, pin: pin.name, locationId, name: names.get(locationId)!, before: region.anchors[locationId] ?? null, after: at.cell, onPicture: at.onPicture };
  });
  if (!apply) return { placements, skipped, applied: false };
  const bound = new Set(chosen.map((pin) => pin.id));
  saveWorldDoc(campaignId, { ...doc, pins: doc.pins.map((pin) => (bound.has(pin.id) ? { ...pin, regionLink: pin.ref } : pin)) });
  for (const placement of placements) {
    if (!sameCell(placement.before, placement.after)) setOverworldAnchor(campaignId, placement.locationId, placement.after);
  }
  return { placements, skipped, applied: true };
}

// The pins stop moving their places; nothing moves.
export function releaseFromRegion(campaignId: string, pinIds: string[] | null): Array<{ pinId: string; pin: string }> {
  const doc = getWorldDoc(campaignId);
  const wanted = pinIds ? new Set(pinIds) : null;
  const released = doc.pins.filter((pin) => pin.regionLink && (!wanted || wanted.has(pin.id)));
  if (!released.length) return [];
  const ids = new Set(released.map((pin) => pin.id));
  saveWorldDoc(campaignId, {
    ...doc,
    pins: doc.pins.map((pin) => {
      return ids.has(pin.id) ? without(pin, "regionLink") : pin;
    }),
  });
  return released.map((pin) => ({ pinId: pin.id, pin: pin.name }));
}

// ---- a WorldForge file ----

// The width over height of picture bytes, or 0.
export function aspectOfBytes(bytes: Buffer): number {
  try {
    const size = imageSize(bytes);
    return size.width > 0 && size.height > 0 ? size.width / size.height : 0;
  } catch {
    return 0;
  }
}

// What a file import does at the Region, by the same rules as the steps
// above, on the import's document before it is saved. `finish` runs once
// it is, and writes the Region.
//
//   - A map the file brought was placed on its picture itself: WorldForge
//     measures pins across its window with the picture cropped to fill it,
//     and the window's shape is not in the file. Its frame says so once the
//     picture's shape is known.
//   - A Region nobody has dressed yet (no map over it, no picture of its
//     own) takes the file's top map, as "Use as the Region backdrop" would.
//   - Pins on the map over the Region bind the places this import made, as
//     "Place this location" would. A place that was here before keeps its
//     Region spot until the DM places it.
//   - A bound pin the file moved takes its place's marker with it.
export function importBridge(
  campaignId: string,
  before: Pick<WorldDoc, "maps" | "pins">,
  doc: WorldDoc,
  input: { rootId: string; fresh: Set<string>; aspects: Map<string, number> },
): { notes: string[]; finish: () => Placement[] } {
  const notes: string[] = [];
  const known = new Set(before.maps.map((atlas) => atlas.id));
  doc.maps = doc.maps.map((atlas) => {
    const aspect = input.aspects.get(atlas.id) ?? 0;
    const frame = !known.has(atlas.id) && !atlas.frame && aspect ? readFrame({ surface: aspect, image: aspect, fit: "cover" }) : atlas.frame;
    return frame ? { ...atlas, frame } : atlas;
  });
  const region = getOverworld(campaignId);
  let backdrop = "";
  let target = regionMapOf(doc);
  const root = doc.maps.find((atlas) => atlas.id === input.rootId) ?? null;
  if (!target && root && !region.backdropPath) {
    const stood = standOverRegion(doc, root.id, root.frame);
    doc.maps = stood.doc.maps;
    doc.pins = stood.doc.pins;
    target = regionMapOf(doc);
    backdrop = isUploadedImagePath(root.image) ? root.image : "";
    notes.push(`${root.name} now stands over the Region map${backdrop ? " as its picture" : ""}, and the places pinned on it are placed there.`);
  }
  const names = placeNames(campaignId);
  if (target) {
    const over = target;
    let waiting = 0;
    doc.pins = doc.pins.map((pin) => {
      if (pin.mapId !== over.id || !names.has(placeIdOf(pin)) || pin.regionLink) return pin;
      if (input.fresh.has(pin.ref)) return { ...pin, regionLink: pin.ref };
      waiting += 1;
      return pin;
    });
    if (waiting === 1) {
      notes.push(`One place pinned on ${over.name} was here before this file and kept its Region spot. Place it from the Atlas to line the two up.`);
    } else if (waiting) {
      notes.push(`${waiting} places pinned on ${over.name} were here before this file and kept their Region spots. Place them from the Atlas to line the two up.`);
    }
  } else if (root && doc.pins.some((pin) => pin.mapId === root.id && input.fresh.has(pin.ref) && names.has(placeIdOf(pin)))) {
    notes.push(`The Region map already shows its own picture, so the new places pinned on ${root.name} were not placed from it. Use that map as the Region backdrop to place them.`);
  }
  return {
    notes,
    finish: () => {
      if (backdrop) setOverworldBackdrop(campaignId, backdrop);
      return followPins(campaignId, before, doc);
    },
  };
}

// ---- keeping the two in step ----

// After the document changed from `before` to `after`: every bound pin
// whose cell is now a different one (the pin was moved, or the map's frame
// was) moves its place's marker there. A bound pin whose cell did not
// change leaves its marker alone, even where the two had drifted apart
// (regionBridge reports that). Says what moved and from where, so the
// change can be reviewed or undone; `apply` false only says.
export function followPins(campaignId: string, before: Pick<WorldDoc, "maps" | "pins">, after: Pick<WorldDoc, "maps" | "pins">, apply = true): Placement[] {
  const pins = boundPins(after);
  if (!pins.length) return [];
  const region = getOverworld(campaignId);
  const grid = gridOf(region);
  const was = new Map(boundPins(before).map((pin) => [pin.id, pin]));
  const oldFrame = frameOf(regionMapOf(before));
  const newFrame = frameOf(regionMapOf(after));
  const names = placeNames(campaignId);
  const moved: Placement[] = [];
  for (const pin of pins) {
    const locationId = placeIdOf(pin);
    if (!names.has(locationId)) continue;
    const next = pinToRegion(newFrame, pin, grid);
    const prior = was.get(pin.id);
    if (prior && sameCell(pinToRegion(oldFrame, prior, grid).cell, next.cell)) continue;
    const anchor = region.anchors[locationId] ?? null;
    if (sameCell(anchor, next.cell)) continue;
    moved.push({ pinId: pin.id, pin: pin.name, locationId, name: names.get(locationId)!, before: anchor, after: next.cell, onPicture: next.onPicture });
    if (apply) setOverworldAnchor(campaignId, locationId, next.cell);
  }
  return moved;
}

// After a place's Region marker was moved: its bound pin goes to the
// middle of the marker's cell, unless it already stands in that cell.
export function followAnchor(campaignId: string, locationId: string): PinMove[] {
  const doc = getWorldDoc(campaignId);
  const pins = boundPins(doc).filter((pin) => placeIdOf(pin) === locationId);
  if (!pins.length) return [];
  const region = getOverworld(campaignId);
  const anchor = region.anchors[locationId];
  if (!anchor) return [];
  const grid = gridOf(region);
  const frame = frameOf(regionMapOf(doc));
  const name = placeNames(campaignId).get(locationId) ?? "";
  const moves: PinMove[] = [];
  const at = new Map<string, XY>();
  for (const pin of pins) {
    if (sameCell(pinToRegion(frame, pin, grid).cell, anchor)) continue;
    const back = regionToPin(frame, anchor, grid);
    at.set(pin.id, back.at);
    moves.push({ pinId: pin.id, pin: pin.name, locationId, name, before: { x: pin.x, y: pin.y }, after: back.at, onSurface: back.onSurface });
  }
  if (moves.length) {
    saveWorldDoc(campaignId, { ...doc, pins: doc.pins.map((pin) => (at.has(pin.id) ? { ...pin, ...at.get(pin.id)! } : pin)) });
  }
  return moves;
}
