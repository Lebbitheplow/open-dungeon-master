import { isErrorResponse, requireStoryAuthority } from "@/lib/campaign-api";
import { patchWorldDoc, worldCounts, worldView } from "@/lib/db/world-forge";
import { publishEphemeral } from "@/lib/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The workshop's WorldForge (src/lib/worldforge/model.ts): its document and
// the records it describes. The DM's alone, hidden truths and all.
// ?counts=1 answers with the hub card's numbers only.
export async function GET(request: Request, { params }: { params: Promise<{ campaignId: string }> }) {
  const { campaignId } = await params;
  const context = await requireStoryAuthority(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  if (new URL(request.url).searchParams.get("counts")) {
    return Response.json({ counts: worldCounts(campaignId) });
  }
  return Response.json(worldView(campaignId));
}

// Replaces whole slices (types, links, folders, calendars, events, secrets,
// stubs, maps, pins), each read through its floor; entries change one at a
// time through /world/entities.
export async function PATCH(request: Request, { params }: { params: Promise<{ campaignId: string }> }) {
  const { campaignId } = await params;
  const context = await requireStoryAuthority(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const raw = await request.json().catch(() => null);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return Response.json({ error: "Expected the slices to change." }, { status: 400 });
  }
  patchWorldDoc(campaignId, raw as Record<string, unknown>);
  publishEphemeral(campaignId, "world_updated", { at: Date.now() });
  return Response.json(worldView(campaignId));
}
