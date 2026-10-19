import { isErrorResponse, requireMember, requireStoryAuthority, steersStory } from "@/lib/campaign-api";
import { hideFromParty, partyAtlasChanged, partyAtlasFor, showToParty } from "@/lib/db/party-atlas";
import { getWorldDoc } from "@/lib/db/world-forge";
import { publishEphemeral } from "@/lib/events";
import { recordsChanged } from "@/lib/workshop/record-events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The party's Atlas (src/lib/worldforge/party-atlas.ts holds the policy).

// Any member: the maps the DM has shown, as the party sees them. Never a
// note, what a pin stands for, or anything hidden.
export async function GET(_request: Request, { params }: { params: Promise<{ campaignId: string }> }) {
  const { campaignId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  return Response.json(partyAtlasFor(campaignId, context.user.id, steersStory(context)));
}

function changed(campaignId: string) {
  publishEphemeral(campaignId, "world_updated", { at: Date.now() });
  recordsChanged(campaignId, "world");
}

// "Show to the party": { mapId, apply?: boolean }. Without `apply` it
// answers with the map exactly as a player would see it, and what stays
// hidden; with it, the map is on the party's Atlas.
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
  const before = getWorldDoc(campaignId);
  const result = showToParty(campaignId, mapId, raw.apply === true);
  if ("error" in result) {
    return Response.json({ error: result.error }, { status: result.status });
  }
  if (result.applied) {
    changed(campaignId);
    partyAtlasChanged(campaignId, before);
  }
  return Response.json(result);
}

// "Hide from the party": { mapId }. Nothing else changes.
export async function DELETE(request: Request, { params }: { params: Promise<{ campaignId: string }> }) {
  const { campaignId } = await params;
  const context = await requireStoryAuthority(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const raw = (await request.json().catch(() => ({}))) as { mapId?: unknown };
  const mapId = typeof raw.mapId === "string" ? raw.mapId.trim().slice(0, 80) : "";
  const before = getWorldDoc(campaignId);
  const result = hideFromParty(campaignId, mapId);
  if ("error" in result) {
    return Response.json({ error: result.error }, { status: result.status });
  }
  if (result.hidden) {
    changed(campaignId);
    partyAtlasChanged(campaignId, before);
  }
  return Response.json(result);
}
