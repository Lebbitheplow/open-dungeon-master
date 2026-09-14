import { isErrorResponse, requireStoryAuthority } from "@/lib/campaign-api";
import { deleteFaction, getFaction, updateFaction } from "@/lib/db/factions";
import { getParty, setParty } from "@/lib/db/party";
import { clampReputation, normalizeFactionAttitude } from "@/lib/dm/faction-logic";
import { publishEphemeral } from "@/lib/events";
import { isUploadedImagePath } from "@/lib/uploads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function requireFaction(campaignId: string, factionId: string) {
  const context = await requireStoryAuthority(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const faction = getFaction(factionId);
  if (!faction || faction.campaignId !== campaignId) {
    return Response.json({ error: "Faction not found." }, { status: 404 });
  }
  return faction;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ campaignId: string; factionId: string }> },
) {
  const { campaignId, factionId } = await params;
  const faction = await requireFaction(campaignId, factionId);
  if (faction instanceof Response) {
    return faction;
  }
  const raw = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  if (raw.portraitPath !== undefined && raw.portraitPath !== "" && !isUploadedImagePath(raw.portraitPath)) {
    return Response.json({ error: "Not an uploaded file." }, { status: 400 });
  }
  const updated = updateFaction(factionId, {
    ...(typeof raw.name === "string" && raw.name.trim() ? { name: raw.name } : {}),
    ...(typeof raw.blurb === "string" ? { blurb: raw.blurb } : {}),
    ...(typeof raw.goal === "string" ? { goal: raw.goal } : {}),
    ...(raw.attitude !== undefined ? { attitude: normalizeFactionAttitude(raw.attitude) } : {}),
    ...(typeof raw.power === "number" ? { power: raw.power } : {}),
    ...(Array.isArray(raw.tags) ? { tags: raw.tags.filter((tag): tag is string => typeof tag === "string") } : {}),
    ...(raw.portraitPath !== undefined ? { portraitPath: typeof raw.portraitPath === "string" ? raw.portraitPath : "" } : {}),
  });
  // The DM may set standing directly; the tools move it a step at a time.
  if (typeof raw.standing === "number") {
    const party = getParty(campaignId);
    setParty(campaignId, { ...party, reputation: { ...party.reputation, [factionId]: clampReputation(raw.standing) } });
  }
  publishEphemeral(campaignId, "factions_updated", { at: Date.now() });
  return Response.json({ faction: updated });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ campaignId: string; factionId: string }> },
) {
  const { campaignId, factionId } = await params;
  const faction = await requireFaction(campaignId, factionId);
  if (faction instanceof Response) {
    return faction;
  }
  deleteFaction(factionId);
  publishEphemeral(campaignId, "factions_updated", { at: Date.now() });
  return Response.json({ ok: true });
}
