import { isErrorResponse, requireStoryAuthority } from "@/lib/campaign-api";
import { backdropFromAtlas, unlinkRegionMap } from "@/lib/db/atlas-region";
import { publishEphemeral } from "@/lib/events";
import { recordsChanged } from "@/lib/workshop/record-events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function changed(campaignId: string) {
  publishEphemeral(campaignId, "world_updated", { at: Date.now() });
  recordsChanged(campaignId, "world");
}

// "Use this Atlas map as the Region backdrop" (audit finding WF-09).
// { mapId, apply?: boolean }. Without `apply` it answers with what would
// change: the Region's picture before and after, the map that stood over
// the Region until now, and the pins that would stop moving their places.
// With it, the Region shows the map's own uploaded picture and the map is
// recorded as the one over the Region.
export async function POST(request: Request, { params }: { params: Promise<{ campaignId: string }> }) {
  const { campaignId } = await params;
  const context = await requireStoryAuthority(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const raw = (await request.json().catch(() => ({}))) as { mapId?: unknown; apply?: unknown };
  const mapId = typeof raw.mapId === "string" ? raw.mapId.trim().slice(0, 80) : "";
  if (!mapId) {
    return Response.json({ error: "Name the map." }, { status: 400 });
  }
  const result = await backdropFromAtlas(campaignId, mapId, raw.apply === true);
  if ("error" in result) {
    return Response.json({ error: result.error }, { status: result.status });
  }
  if (result.applied) changed(campaignId);
  return Response.json(result);
}

// The map stops standing over the Region; every place stays where it is.
// ?clear=1 also takes the picture off the Region, while it is still the
// map's own.
export async function DELETE(request: Request, { params }: { params: Promise<{ campaignId: string }> }) {
  const { campaignId } = await params;
  const context = await requireStoryAuthority(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const result = unlinkRegionMap(campaignId, new URL(request.url).searchParams.get("clear") === "1");
  if (result.map) changed(campaignId);
  return Response.json(result);
}
