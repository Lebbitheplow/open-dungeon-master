import { isErrorResponse, requireStoryAuthority } from "@/lib/campaign-api";
import { restoreToAtlas } from "@/lib/db/atlas-edit";
import { worldAnswerFor } from "@/lib/db/world-forge";
import { publishEphemeral } from "@/lib/events";
import { partyAtlasChanged } from "@/lib/db/party-atlas";
import { getWorldDoc } from "@/lib/db/world-forge";
import { recordsChanged } from "@/lib/workshop/record-events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Undo for an Atlas delete (audit finding WF-20). { undo }: the token the
// delete answered with. The rows come back as they were, frame, Region
// role and bindings included, as far as the world still has room for
// them; `skipped` says what stayed out and why.
export async function POST(request: Request, { params }: { params: Promise<{ campaignId: string }> }) {
  const { campaignId } = await params;
  const context = await requireStoryAuthority(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const raw = (await request.json().catch(() => ({}))) as { undo?: unknown };
  const token = typeof raw.undo === "string" ? raw.undo.trim().slice(0, 80) : "";
  if (!token) {
    return Response.json({ error: "Name the delete to undo." }, { status: 400 });
  }
  const before = getWorldDoc(campaignId);
  const result = restoreToAtlas(campaignId, token);
  if ("error" in result) {
    return Response.json({ error: result.error }, { status: result.status });
  }
  publishEphemeral(campaignId, "world_updated", { at: Date.now() });
  partyAtlasChanged(campaignId, before);
  recordsChanged(campaignId, "world");
  return Response.json({ ...result, ...worldAnswerFor(request, campaignId) });
}
