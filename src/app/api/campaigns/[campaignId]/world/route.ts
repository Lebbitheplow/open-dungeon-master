import { isErrorResponse, requireStoryAuthority } from "@/lib/campaign-api";
import { compressedJson } from "@/lib/compressed-json";
import { followPins } from "@/lib/db/atlas-region";
import { partyAtlasChanged } from "@/lib/db/party-atlas";
import { patchWorldDoc, worldAnswerFor, worldCounts } from "@/lib/db/world-forge";
import { publishEphemeral } from "@/lib/events";
import { recordsChanged } from "@/lib/workshop/record-events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The workshop's WorldForge (src/lib/worldforge/model.ts): its document and
// the records it describes (each entry's WorldForge data once, on its
// record, for a caller that asks with ?lean=1: worldAnswerFor), gzipped when big (compressedJson). The DM's alone,
// hidden truths and all.
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
  return compressedJson(request, worldAnswerFor(request, campaignId));
}

// Changes slices (types, links, folders, calendars, events, secrets, stubs,
// maps, pins) by row operations, or replaces whole ones, each read through
// its floor (src/lib/db/world-forge.ts patchWorldDoc); entries change one at
// a time through /world/entities. Rows changed by someone else since the
// editor saw them come back in `conflicts`, untouched. A pin bound to a
// place on the Region (src/lib/db/atlas-region.ts) that moved takes the
// place's Region marker with it; `region` names each marker that moved and
// where it stood before.
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
  const { conflicts, before, doc } = patchWorldDoc(campaignId, raw as Record<string, unknown>);
  const region = followPins(campaignId, before, doc);
  partyAtlasChanged(campaignId, before);
  publishEphemeral(campaignId, "world_updated", { at: Date.now() });
  recordsChanged(campaignId, "world");
  return compressedJson(request, { ...worldAnswerFor(request, campaignId), ...(conflicts.length ? { conflicts } : {}), ...(region.length ? { region } : {}) });
}
