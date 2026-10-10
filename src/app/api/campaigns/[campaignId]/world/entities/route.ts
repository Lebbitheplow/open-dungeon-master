import { isErrorResponse, requireStoryAuthority } from "@/lib/campaign-api";
import { createWorldEntity } from "@/lib/db/world-forge";
import { publishEphemeral } from "@/lib/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// A new entry: the record on its type's shelf (a Cast member, a place, a
// faction, a lore entry) and its WorldForge half.
export async function POST(request: Request, { params }: { params: Promise<{ campaignId: string }> }) {
  const { campaignId } = await params;
  const context = await requireStoryAuthority(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const raw = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const result = createWorldEntity(campaignId, raw);
  if ("error" in result) {
    return Response.json({ error: result.error }, { status: result.status ?? 400 });
  }
  publishEphemeral(campaignId, result.entity.shelf === "faction" ? "factions_updated" : "world_updated", { at: Date.now() });
  return Response.json(result);
}
