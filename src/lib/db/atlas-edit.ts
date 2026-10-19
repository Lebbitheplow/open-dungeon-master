import { randomUUID } from "node:crypto";
import { followPins, pictureAspect, PICTURE_ONLY, type Failure, type Placement } from "@/lib/db/atlas-region";
import { getWorldDoc, saveWorldDoc } from "@/lib/db/world-forge";
import { isUploadedImagePath } from "@/lib/uploads";
import { deleteImpact, removeFromDoc, restoreIntoDoc, type AtlasTarget, type DeleteImpact, type Removed } from "@/lib/worldforge/atlas-edit";
import { frameOf, pictureToSurface, surfaceToPicture } from "@/lib/worldforge/atlas-frame";
import { ASPECT_RANGE, MAP_FITS, readFrame, readSlice, type AtlasMap, type MapFit, type MapFrame, type Pin, type XY } from "@/lib/worldforge/model";

// The Atlas's editing steps that the editor's own saves may not make
// (audit finding WF-20): deleting with an undo, and changing how a map's
// picture sits in its box. Both answer with a review first.
//
// A delete's rows are held here, under a token, so Undo puts back exactly
// what was taken (a map's frame and Region role, a pin's Region binding)
// without a client sending those fields itself: the editor's saves never
// write them (src/lib/worldforge/atlas-frame.ts keepRegionFields). The
// hold lasts half an hour, or until the server restarts.

const HOLD_MS = 30 * 60 * 1000;
const HELD_PER_CAMPAIGN = 20;
type Held = { campaignId: string; removed: Removed; at: number };
const store = globalThis as typeof globalThis & { __odmAtlasTrash?: Map<string, Held> };
const trash = (store.__odmAtlasTrash ??= new Map<string, Held>());

function hold(campaignId: string, removed: Removed): string {
  const now = Date.now();
  for (const [token, held] of trash) if (now - held.at > HOLD_MS) trash.delete(token);
  const mine = [...trash].filter(([, held]) => held.campaignId === campaignId);
  for (const [token] of mine.slice(0, Math.max(0, mine.length - HELD_PER_CAMPAIGN + 1))) trash.delete(token);
  const token = randomUUID();
  trash.set(token, { campaignId, removed, at: now });
  return token;
}

export function readTarget(raw: unknown): AtlasTarget | null {
  const value = (raw ?? {}) as Record<string, unknown>;
  const id = (key: string) => (typeof value[key] === "string" ? (value[key] as string).trim().slice(0, 80) : "");
  if (value.kind === "map" && id("mapId")) return { kind: "map", mapId: id("mapId") };
  if (value.kind === "pin" && id("pinId")) return { kind: "pin", pinId: id("pinId") };
  if (value.kind === "region" && id("mapId") && id("regionId")) return { kind: "region", mapId: id("mapId"), regionId: id("regionId") };
  return null;
}

export type DeletePlan = { impact: DeleteImpact; notes: string[]; applied: boolean; undo?: string };

export function deleteFromAtlas(campaignId: string, target: AtlasTarget, apply: boolean): DeletePlan | Failure {
  const doc = getWorldDoc(campaignId);
  const impact = deleteImpact(doc, target);
  if (!impact) return { error: "That is not on the Atlas any more.", status: 404 };
  const notes = impact.overRegion ? ["The Region keeps its picture and every place stays where it is. Undo makes this map stand over the Region again."] : [];
  if (!apply) return { impact, notes, applied: false };
  const done = removeFromDoc(doc, target)!;
  saveWorldDoc(campaignId, done.doc);
  return { impact, notes, applied: true, undo: hold(campaignId, done.removed) };
}

export type RestoreResult = { restored: number; skipped: string[] };

export function restoreToAtlas(campaignId: string, token: string): RestoreResult | Failure {
  const held = trash.get(token);
  if (!held || held.campaignId !== campaignId || Date.now() - held.at > HOLD_MS) {
    return { error: "That delete can no longer be undone.", status: 410 };
  }
  trash.delete(token);
  const result = restoreIntoDoc(getWorldDoc(campaignId), held.removed);
  // Read back through the floors, as every save is.
  saveWorldDoc(campaignId, { ...result.doc, maps: readSlice("maps", result.doc.maps), pins: readSlice("pins", result.doc.pins) });
  return { restored: result.restored, skipped: result.skipped };
}

// ---- how a map's picture sits in its box ----

export type FrameAsk = { fit: MapFit; surface: number | "picture"; carry: boolean };

export function readFrameAsk(raw: unknown): FrameAsk | null {
  const value = (raw ?? {}) as Record<string, unknown>;
  const fit = MAP_FITS.find((entry) => entry === value.fit);
  const surface = value.surface === "picture" ? "picture" : typeof value.surface === "number" && value.surface >= ASPECT_RANGE.min && value.surface <= ASPECT_RANGE.max ? value.surface : null;
  return fit && surface !== null ? { fit, surface, carry: value.carry !== false } : null;
}

export type FramePlan = {
  map: { id: string; name: string };
  before: MapFrame;
  after: MapFrame;
  // Pins and region corners that change position in the box.
  moved: number;
  // Of those, the ones whose spot on the picture is outside the new box:
  // they wait at its nearest edge.
  outside: number;
  // Places on the Region that move because their bound pins' squares did.
  placements: Placement[];
  notes: string[];
  applied: boolean;
};

const clamp = (value: number) => Math.round(Math.min(1, Math.max(0, value)) * 10_000) / 10_000;

export async function reframeMap(campaignId: string, mapId: string, ask: FrameAsk, apply: boolean): Promise<FramePlan | Failure> {
  const image = getWorldDoc(campaignId).maps.find((entry) => entry.id === mapId)?.image ?? "";
  // Measured before the document is read for writing, as the Region steps do.
  const aspect = isUploadedImagePath(image) ? await pictureAspect(image) : 0;
  const doc = getWorldDoc(campaignId);
  const atlas = doc.maps.find((entry) => entry.id === mapId);
  if (!atlas) return { error: "That map is not in this world.", status: 404 };
  const measured = atlas.image === image ? aspect : 0;
  if (ask.surface === "picture" && !measured) return { error: "This map has no uploaded picture to take a shape from.", status: 400 };
  const old = frameOf(atlas);
  // The same picture, measured now if nobody had: where the pins stand on it
  // follows from the old box and the old fit.
  const was: MapFrame = { ...old, image: measured || old.image };
  const next: MapFrame = { surface: ask.surface === "picture" ? measured : ask.surface, image: measured || old.image, fit: ask.fit };
  let moved = 0;
  let outside = 0;
  const carry = (at: XY): XY => {
    const onPicture = surfaceToPicture(was, at);
    const there = pictureToSurface(next, onPicture);
    const to = { x: clamp(there.x), y: clamp(there.y) };
    if (Math.abs(to.x - at.x) > 1e-4 || Math.abs(to.y - at.y) > 1e-4) moved += 1;
    if (there.x < -1e-6 || there.x > 1 + 1e-6 || there.y < -1e-6 || there.y > 1 + 1e-6) outside += 1;
    return to;
  };
  const stored = readFrame(next);
  const { frame: _frame, ...rest } = atlas;
  void _frame;
  const reframed: AtlasMap = {
    ...rest,
    ...(stored ? { frame: stored } : {}),
    regions: ask.carry ? atlas.regions.map((region) => ({ ...region, points: region.points.map(carry) })) : atlas.regions,
  };
  const pins: Pin[] = doc.pins.map((pin) => (ask.carry && pin.mapId === atlas.id ? { ...pin, ...carry(pin) } : pin));
  const after = { ...doc, maps: doc.maps.map((entry) => (entry.id === atlas.id ? reframed : entry)), pins };
  const placements = followPins(campaignId, doc, after, false);
  const notes: string[] = [];
  if (!ask.carry) notes.push("Pins and regions keep their places in the box, so they will sit over other parts of the picture.");
  if (atlas.role === "region") notes.push(PICTURE_ONLY);
  const plan: FramePlan = { map: { id: atlas.id, name: atlas.name }, before: old, after: stored ?? frameOf(null), moved, outside, placements, notes, applied: false };
  if (!apply) return plan;
  saveWorldDoc(campaignId, after);
  followPins(campaignId, doc, after, true);
  return { ...plan, applied: true };
}
