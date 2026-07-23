import { z } from "zod";
import { isErrorResponse, requireLead, requireMember } from "@/lib/campaign-api";
import { listLocations } from "@/lib/db/locations";
import { getOverworld, regenerateOverworld, setOverworldPins } from "@/lib/db/overworld";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The overworld view: terrain grid, anchors joined with location state
// (visited/current names), and lead pins. Lazily created on first read.
function overworldPayload(campaignId: string) {
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
  return Response.json(overworldPayload(campaignId));
}

const patchSchema = z.object({
  regenerate: z.boolean().optional(),
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
});

// Lead controls: replace the pin layer, or reroll the terrain (anchors
// carry over wherever the new ground allows).
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireLead(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const parsed = patchSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: "Invalid overworld update." }, { status: 400 });
  }
  if (parsed.data.regenerate) {
    regenerateOverworld(campaignId);
  }
  if (parsed.data.pins) {
    setOverworldPins(campaignId, parsed.data.pins);
  }
  return Response.json(overworldPayload(campaignId));
}
