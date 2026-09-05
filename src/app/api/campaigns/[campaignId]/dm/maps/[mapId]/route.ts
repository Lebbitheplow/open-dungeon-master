import { z } from "zod";
import { isErrorResponse, requireDm } from "@/lib/campaign-api";
import { MAP_THEMES } from "@/lib/battlemap/generate";
import { normalizeStamp } from "@/lib/battlemap/stamp";
import { normalizeShape } from "@/lib/battlemap/tools";
import { BACKDROP_LIMITS, isBackdropPath } from "@/lib/battlemap/backdrop";
import {
  hasPaint,
  hasScene,
  lightsRequestSchema,
  paintRequestSchema,
  sceneRequestSchema,
} from "@/lib/schemas/map-paint";
import { deletePreparedMap, getPreparedMap, updatePreparedMap } from "@/lib/db/prepared-maps";
import {
  deployPreparedMap,
  openSceneOnPreparedMap,
  paintLibraryMap,
  setLibraryBackdrop,
  setLibraryLights,
  setLibraryScene,
} from "@/lib/dm/map-library";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// One prepared map. PATCH edits it (its name, its ground, its lights, the
// picture under it); POST puts it on the table; DELETE forgets it.
//
// Painting a stored map runs through exactly the painter the live board uses
// (src/lib/battlemap/paint.ts), so a prepared map can never be a picture
// that only turns out to be illegal at the moment it is deployed.

const patchSchema = paintRequestSchema
  .extend(lightsRequestSchema.shape)
  .extend(sceneRequestSchema.shape)
  .extend({
  name: z.string().trim().min(1).max(80).optional(),
  notes: z.string().max(4000).optional(),
  tags: z.array(z.string().max(24)).max(8).optional(),
  theme: z.enum(MAP_THEMES as [string, ...string[]]).optional(),
  ambient: z.enum(["bright", "dim", "dark"]).optional(),
  // "" removes the picture. Any other value must be a file this app wrote.
  backdropPath: z
    .string()
    .refine((value) => value === "" || isBackdropPath(value), "Not an uploaded file.")
    .optional(),
  backdropTransform: z
    .object({
      offsetX: z.number().min(-BACKDROP_LIMITS.maxOffset).max(BACKDROP_LIMITS.maxOffset),
      offsetY: z.number().min(-BACKDROP_LIMITS.maxOffset).max(BACKDROP_LIMITS.maxOffset),
      scale: z.number().min(BACKDROP_LIMITS.minScale).max(BACKDROP_LIMITS.maxScale),
      opacity: z.number().min(0).max(1),
    })
    .optional(),
});

const postSchema = z.object({
  do: z.enum(["deploy", "open-scene"]),
  summary: z.string().trim().max(300).optional(),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ campaignId: string; mapId: string }> },
) {
  const { campaignId, mapId } = await params;
  const context = await requireDm(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const parsed = patchSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: "Invalid map edit." }, { status: 400 });
  }
  const body = parsed.data;
  const current = getPreparedMap(campaignId, mapId);
  if (!current) {
    return Response.json({ error: "That map is not in this library." }, { status: 404 });
  }

  // Terrain first, because it is the edit that can be refused. A rename that
  // landed alongside a rejected stroke would leave the DM guessing which
  // half of their request took.
  if (hasPaint(body)) {
    const stamp = body.stamp ? normalizeStamp(body.stamp) : null;
    if (body.stamp && !stamp) {
      return Response.json({ error: "That is not a shape this map knows." }, { status: 400 });
    }
    const shape = body.shape ? normalizeShape(body.shape, current.width, current.height) : null;
    if (body.shape && !shape) {
      return Response.json({ error: "That is not a shape this map knows." }, { status: 400 });
    }
    const painted = paintLibraryMap(context.campaign, mapId, {
      strokes: body.strokes as Parameters<typeof paintLibraryMap>[2]["strokes"],
      stamp: stamp ?? undefined,
      shape: shape ?? undefined,
      replaceTerrain: body.replaceTerrain,
    });
    if ("error" in painted) {
      return Response.json({ error: painted.error }, { status: 409 });
    }
  }

  if (body.light || body.lights) {
    const lit = setLibraryLights(context.campaign, mapId, {
      toggle: body.light,
      lights: body.lights,
    });
    if ("error" in lit) {
      return Response.json({ error: lit.error }, { status: 409 });
    }
  }

  let door: string | null | undefined;
  if (hasScene(body)) {
    const scene = setLibraryScene(context.campaign, mapId, {
      door: body.door,
      labels: body.labels,
      props: body.props,
      zones: body.zones,
      overlayPath: body.overlayPath,
      ambience: body.ambience,
    });
    if ("error" in scene) {
      return Response.json({ error: scene.error }, { status: 409 });
    }
    door = scene.door;
  }

  if (body.backdropPath !== undefined || body.backdropTransform !== undefined) {
    const outcome = setLibraryBackdrop(
      context.campaign,
      mapId,
      body.backdropPath ?? current.backdrop?.path ?? "",
      body.backdropTransform ?? current.backdrop?.transform ?? null,
    );
    if ("error" in outcome) {
      return Response.json({ error: outcome.error }, { status: 404 });
    }
  }

  const updated = updatePreparedMap(campaignId, mapId, {
    name: body.name,
    notes: body.notes,
    tags: body.tags,
    theme: body.theme as Parameters<typeof updatePreparedMap>[2]["theme"],
    ambient: body.ambient,
  });
  return updated
    ? Response.json({ ok: true, map: updated, ...(door !== undefined ? { door } : {}) })
    : Response.json({ error: "That map is not in this library." }, { status: 404 });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ campaignId: string; mapId: string }> },
) {
  const { campaignId, mapId } = await params;
  const context = await requireDm(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const parsed = postSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }
  const outcome =
    parsed.data.do === "deploy"
      ? deployPreparedMap(context.campaign, mapId)
      : openSceneOnPreparedMap(context.campaign, mapId, parsed.data.summary ?? "");
  return "error" in outcome
    ? Response.json({ error: outcome.error }, { status: 409 })
    : Response.json({ ok: true, map: outcome.map });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ campaignId: string; mapId: string }> },
) {
  const { campaignId, mapId } = await params;
  const context = await requireDm(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  return deletePreparedMap(campaignId, mapId)
    ? Response.json({ ok: true })
    : Response.json({ error: "That map is not in this library." }, { status: 404 });
}
