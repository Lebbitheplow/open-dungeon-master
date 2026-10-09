import { isErrorResponse, requireStoryAuthority } from "@/lib/campaign-api";
import { deleteWorldEntity, updateWorldEntity } from "@/lib/db/world-forge";
import { publishEphemeral } from "@/lib/events";
import { parseRef } from "@/lib/worldforge/model";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// One entry by its ref ("npc:<id>", "location:<id>", "faction:<id>",
// "lore:<id>"). The record must belong to this campaign; world-forge.ts
// checks before it writes anything.
function refFrom(value: string): string | null {
  const ref = value.includes("%") ? decodeURIComponent(value) : value;
  return parseRef(ref) ? ref : null;
}

export async function PATCH(request: Request, { params }: { params: Promise<{ campaignId: string; ref: string }> }) {
  const { campaignId, ref: rawRef } = await params;
  const context = await requireStoryAuthority(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const ref = refFrom(rawRef);
  if (!ref) {
    return Response.json({ error: "No such entry." }, { status: 404 });
  }
  const raw = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const result = updateWorldEntity(campaignId, ref, raw);
  if ("error" in result) {
    return Response.json({ error: result.error }, { status: result.status ?? 400 });
  }
  publishEphemeral(campaignId, result.entity.shelf === "faction" ? "factions_updated" : "world_updated", { at: Date.now() });
  return Response.json(result);
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ campaignId: string; ref: string }> }) {
  const { campaignId, ref: rawRef } = await params;
  const context = await requireStoryAuthority(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const ref = refFrom(rawRef);
  if (!ref || !deleteWorldEntity(campaignId, ref)) {
    return Response.json({ error: "No such entry." }, { status: 404 });
  }
  publishEphemeral(campaignId, "world_updated", { at: Date.now() });
  return Response.json({ ok: true });
}
