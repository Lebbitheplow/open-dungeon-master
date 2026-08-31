import { z } from "zod";
import {
  capsFor,
  isErrorResponse,
  requireStoryAuthority,
  requireMember,
} from "@/lib/campaign-api";
import { insertKnownLocation, listLocations, renameLocation } from "@/lib/db/locations";
import {
  getOverworld,
  regenerateOverworld,
  setOverworldAnchor,
  setOverworldNotes,
  setOverworldParty,
  setOverworldPins,
  paintOverworldTerrain,
} from "@/lib/db/overworld";
import { normalizeOverworldParams } from "@/lib/overworld/logic";
import {
  MAX_BRUSH_RADIUS,
  MAX_STROKES,
  OVERWORLD_BRUSHES,
} from "@/lib/overworld/paint";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The overworld view: terrain grid, anchors joined with location state
// (visited/current names), lead pins, and the party marker. Lazily created on
// first read. The DM's own notes ride along only for whoever holds the
// story's secrets, which is the lead in an AI campaign and the DM once a
// person is running the game (src/lib/dm/viewer.ts).
function overworldPayload(campaignId: string, secrets: boolean) {
  const map = getOverworld(campaignId);
  const locations = listLocations(campaignId).map((location) => ({
    id: location.id,
    name: location.name,
    visited: location.visited,
    isCurrent: location.isCurrent,
    connections: location.connections,
    anchor: map.anchors[location.id] ?? null,
  }));
  return {
    map: {
      seed: map.seed,
      width: map.width,
      height: map.height,
      terrain: map.terrain,
      pins: map.pins,
      partyXy: map.partyXy,
      params: map.params,
      ...(secrets ? { notes: map.notes } : {}),
    },
    locations,
  };
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  return Response.json(overworldPayload(campaignId, capsFor(context).steersStory));
}

const xySchema = z.object({ x: z.number(), y: z.number() });

const patchSchema = z.object({
  regenerate: z.boolean().optional(),
  // A named seed makes the preview and the map the table ends up with the
  // same map; without one a reroll is a fresh roll, as it always was.
  seed: z.number().int().min(0).max(0xffffffff).optional(),
  params: z.unknown().optional(),
  pins: z
    .array(
      z.object({
        id: z.string().max(80).default(""),
        x: z.number(),
        y: z.number(),
        label: z.string().max(60),
      }),
    )
    .max(40)
    .optional(),
  // null clears the marker, which is the honest state for a party in transit.
  partyXy: xySchema.nullable().optional(),
  anchor: z.object({ locationId: z.string().min(1) }).merge(xySchema).optional(),
  rename: z.object({ locationId: z.string().min(1), name: z.string().trim().min(1).max(80) }).optional(),
  notes: z.string().max(4_000).optional(),
  // Hand-painting the region. Applied before anything else in the handler,
  // because a stroke that widens a lake changes what an anchor drag in the
  // same request is dragging onto.
  strokes: z
    .array(
      z.object({
        x: z.number(),
        y: z.number(),
        brush: z.enum(OVERWORLD_BRUSHES),
        radius: z.number().int().min(0).max(MAX_BRUSH_RADIUS).optional(),
      }),
    )
    .max(MAX_STROKES)
    .optional(),
  // Places the DM knows about but the party has not reached: they render as
  // ghost markers until someone walks in.
  places: z
    .array(z.object({ name: z.string().trim().min(1).max(80), blurb: z.string().max(300).default("") }))
    .max(8)
    .optional(),
});

// Authoring controls. Everything here belongs to whoever steers the story.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireStoryAuthority(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const parsed = patchSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: "Invalid overworld update." }, { status: 400 });
  }
  const patch = parsed.data;
  // Painting first: a refused paint is the DM's picture being rejected, and
  // they should hear about it instead of it being buried under whatever else
  // the same request happened to carry.
  let stranded: Array<{ id: string; name: string }> = [];
  if (patch.strokes?.length) {
    const painted = paintOverworldTerrain(campaignId, patch.strokes);
    if ("error" in painted) {
      return Response.json({ error: painted.error }, { status: 400 });
    }
    stranded = painted.stranded.map((anchor) => ({ id: anchor.id, name: anchor.name }));
  }
  if (patch.regenerate) {
    regenerateOverworld(campaignId, {
      seed: patch.seed,
      params: patch.params === undefined ? undefined : normalizeOverworldParams(patch.params),
    });
  }
  if (patch.places) {
    for (const place of patch.places) {
      insertKnownLocation({
        campaignId,
        name: place.name,
        layoutDescription: place.blurb,
      });
    }
  }
  if (patch.rename) {
    const renamed = renameLocation(campaignId, patch.rename.locationId, patch.rename.name);
    if (!renamed) {
      return Response.json({ error: "That name is already taken here." }, { status: 409 });
    }
  }
  if (patch.pins) {
    setOverworldPins(campaignId, patch.pins);
  }
  if (patch.partyXy !== undefined) {
    setOverworldParty(campaignId, patch.partyXy);
  }
  if (patch.anchor) {
    setOverworldAnchor(campaignId, patch.anchor.locationId, {
      x: patch.anchor.x,
      y: patch.anchor.y,
    });
  }
  if (patch.notes !== undefined) {
    setOverworldNotes(campaignId, patch.notes);
  }
  // `stranded` names the places the paint left standing in sea or on a peak.
  // Reported, never moved: setOverworldAnchor accepts both on the grounds
  // that a DM who puts a lighthouse on a reef means it.
  return Response.json({ ...overworldPayload(campaignId, true), stranded });
}
