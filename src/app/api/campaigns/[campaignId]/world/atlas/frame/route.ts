import { isErrorResponse, requireStoryAuthority } from "@/lib/campaign-api";
import { readFrameAsk, reframeMap } from "@/lib/db/atlas-edit";
import { publishEphemeral } from "@/lib/events";
import { partyAtlasChanged } from "@/lib/db/party-atlas";
import { getWorldDoc } from "@/lib/db/world-forge";
import { recordsChanged } from "@/lib/workshop/record-events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// How an Atlas map's picture sits in its box (audit finding WF-20,
// src/lib/db/atlas-edit.ts). { mapId, fit: "cover" | "contain", surface:
// <width over height> | "picture", carry?: boolean, apply?: boolean }.
// "picture" takes the box's shape from the uploaded picture itself. With
// `carry` (the default) pins and region corners keep their spots on the
// picture; without it they keep their places in the box. Without `apply`
// it answers with what would move, Region places included.
export async function POST(request: Request, { params }: { params: Promise<{ campaignId: string }> }) {
  const { campaignId } = await params;
  const context = await requireStoryAuthority(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const raw = (await request.json().catch(() => ({}))) as { mapId?: unknown; apply?: unknown };
  const mapId = typeof raw.mapId === "string" ? raw.mapId.trim().slice(0, 80) : "";
  const ask = readFrameAsk(raw);
  if (!mapId || !ask) {
    return Response.json({ error: "Name the map, how its picture fits and the box's shape." }, { status: 400 });
  }
  const before = getWorldDoc(campaignId);
  const result = await reframeMap(campaignId, mapId, ask, raw.apply === true);
  if ("error" in result) {
    return Response.json({ error: result.error }, { status: result.status });
  }
  if (result.applied) {
    publishEphemeral(campaignId, "world_updated", { at: Date.now() });
    partyAtlasChanged(campaignId, before);
    recordsChanged(campaignId, "world");
  }
  return Response.json(result);
}
