import { isErrorResponse, requireStoryAuthority } from "@/lib/campaign-api";
import { deleteFromAtlas, readTarget } from "@/lib/db/atlas-edit";
import { worldAnswerFor } from "@/lib/db/world-forge";
import { publishEphemeral } from "@/lib/events";
import { partyAtlasChanged } from "@/lib/db/party-atlas";
import { getWorldDoc } from "@/lib/db/world-forge";
import { recordsChanged } from "@/lib/workshop/record-events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Deleting a map, a pin or a region from the Atlas (audit finding WF-20,
// src/lib/db/atlas-edit.ts). { target, apply?: boolean }, where target is
// { kind: "map", mapId }, { kind: "pin", pinId } or { kind: "region",
// mapId, regionId }. Without `apply` it answers with what the delete
// touches: the pins that go with a map, pins elsewhere that open it, maps
// drawn inside its pins, and bound pins. With it, the rows go and the
// answer carries `undo`, a token for world/atlas/restore, with the world.
export async function POST(request: Request, { params }: { params: Promise<{ campaignId: string }> }) {
  const { campaignId } = await params;
  const context = await requireStoryAuthority(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const raw = (await request.json().catch(() => ({}))) as { target?: unknown; apply?: unknown };
  const target = readTarget(raw.target);
  if (!target) {
    return Response.json({ error: "Name the map, pin or region." }, { status: 400 });
  }
  const before = getWorldDoc(campaignId);
  const result = deleteFromAtlas(campaignId, target, raw.apply === true);
  if ("error" in result) {
    return Response.json({ error: result.error }, { status: result.status });
  }
  if (!result.applied) return Response.json(result);
  publishEphemeral(campaignId, "world_updated", { at: Date.now() });
  partyAtlasChanged(campaignId, before);
  recordsChanged(campaignId, "world");
  return Response.json({ ...result, ...worldAnswerFor(request, campaignId) });
}
