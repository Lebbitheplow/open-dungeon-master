import { z } from "zod";
import { BRUSHES, MAX_BRUSH_RADIUS, MAX_STROKES } from "@/lib/battlemap/paint";
import { STAMPS, STAMP_SIZE } from "@/lib/battlemap/stamp";
import { SHAPE_TOOLS } from "@/lib/battlemap/tools";
import { LIGHT_LIMITS } from "@/lib/battlemap/lights";
import { PROP_KINDS, SCENE_LIMITS } from "@/lib/battlemap/scene";
import { isUploadedImagePath } from "@/lib/uploads";

// What a paint request looks like on the wire, shared by the studio (the
// board on the table) and the library (a map in the drawer), so the two
// routes cannot drift apart on what a stroke or a shape is.

const xy = z.object({
  x: z.number().int().min(0).max(255),
  y: z.number().int().min(0).max(255),
});

export const strokeSchema = xy.extend({
  brush: z.enum(BRUSHES as unknown as [string, ...string[]]),
  radius: z.number().int().min(0).max(MAX_BRUSH_RADIUS).optional(),
});

export const stampSchema = xy.extend({
  kind: z.enum(STAMPS as unknown as [string, ...string[]]),
  width: z.number().int().min(STAMP_SIZE.min).max(STAMP_SIZE.max),
  height: z.number().int().min(STAMP_SIZE.min).max(STAMP_SIZE.max),
});

export const shapeSchema = z.object({
  tool: z.enum(SHAPE_TOOLS as unknown as [string, ...string[]]),
  brush: z.enum(BRUSHES as unknown as [string, ...string[]]),
  from: xy,
  to: xy,
});

// The largest terrain this engine imports is 64x64 (src/lib/battlemap/uvtt.ts).
export const MAX_TERRAIN_CHARS = 64 * 64;

export const paintRequestSchema = z.object({
  strokes: z.array(strokeSchema).min(1).max(MAX_STROKES).optional(),
  stamp: stampSchema.optional(),
  shape: shapeSchema.optional(),
  // A whole terrain to return to: what undo sends. Compiled into the strokes
  // that differ, so it is checked like any other paint.
  replaceTerrain: z.string().max(MAX_TERRAIN_CHARS).optional(),
});

export const lightSchema = xy.extend({
  brightRadius: z.number().int().min(LIGHT_LIMITS.minRadius).max(LIGHT_LIMITS.maxRadius),
  dimRadius: z.number().int().min(LIGHT_LIMITS.minRadius).max(LIGHT_LIMITS.maxRadius),
});

export const lightsRequestSchema = z.object({
  // Place a light on this tile, or take away the one already there.
  light: lightSchema.optional(),
  // The whole list at once: what "clear all" and a full replace send.
  lights: z.array(lightSchema).max(LIGHT_LIMITS.max).optional(),
});

export function hasPaint(body: z.infer<typeof paintRequestSchema>): boolean {
  return Boolean(body.strokes || body.stamp || body.shape || body.replaceTerrain !== undefined);
}

// The scene layer (src/lib/battlemap/scene.ts). Each list is handed over
// whole and normalized against the map it lands on; a door is one tap.
const labelSchema = xy.extend({
  text: z.string().trim().min(1).max(SCENE_LIMITS.labelText),
  dmOnly: z.boolean().default(false),
});
const propSchema = xy.extend({
  name: z.string().trim().min(1).max(SCENE_LIMITS.propName),
  kind: z.enum(PROP_KINDS).default("prop"),
});
const zoneSchema = z.object({
  x0: z.number().int().min(0).max(255),
  y0: z.number().int().min(0).max(255),
  x1: z.number().int().min(0).max(255),
  y1: z.number().int().min(0).max(255),
  ambient: z.enum(["bright", "dim", "dark"]),
});

export const sceneRequestSchema = z.object({
  door: xy.optional(),
  labels: z.array(labelSchema).max(SCENE_LIMITS.labels).optional(),
  props: z.array(propSchema).max(SCENE_LIMITS.props).optional(),
  zones: z.array(zoneSchema).max(SCENE_LIMITS.zones).optional(),
  // "" takes the overlay away; anything else must be a file this app wrote.
  overlayPath: z
    .string()
    .refine((value) => value === "" || isUploadedImagePath(value), "Not an uploaded file.")
    .optional(),
  ambience: z.object({ bed: z.string().max(60).default(""), music: z.string().max(60).default("") }).optional(),
});

export function hasScene(body: z.infer<typeof sceneRequestSchema>): boolean {
  return Boolean(
    body.door ||
      body.labels ||
      body.props ||
      body.zones ||
      body.overlayPath !== undefined ||
      body.ambience,
  );
}
