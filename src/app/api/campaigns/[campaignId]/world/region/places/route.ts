import { isErrorResponse, requireStoryAuthority } from "@/lib/campaign-api";
import { placeInRegion, releaseFromRegion } from "@/lib/db/atlas-region";
import { publishEphemeral } from "@/lib/events";
import { recordsChanged } from "@/lib/workshop/record-events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PINS_MAX = 3_000;

function pinIdsOf(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  return [...new Set(raw.filter((id): id is string => typeof id === "string" && Boolean(id.trim())).map((id) => id.trim().slice(0, 80)))].slice(0, PINS_MAX);
}

// "Place this location in the Region" (audit finding WF-09).
// { pinIds?: string[], apply?: boolean }: the pins asked for, or every pin
// on the map over the Region that names a place. Without `apply` it
// answers with each place's Region marker now and where it would go. With
// it, the markers move and the pins are bound, so from then on the pin and
// the marker move together.
export async function POST(request: Request, { params }: { params: Promise<{ campaignId: string }> }) {
  const { campaignId } = await params;
  const context = await requireStoryAuthority(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const raw = (await request.json().catch(() => ({}))) as { pinIds?: unknown; apply?: unknown };
  const result = placeInRegion(campaignId, pinIdsOf(raw.pinIds), raw.apply === true);
  if ("error" in result) {
    return Response.json({ error: result.error }, { status: result.status });
  }
  if (result.applied && result.placements.length) {
    publishEphemeral(campaignId, "world_updated", { at: Date.now() });
    recordsChanged(campaignId, "world");
  }
  return Response.json(result);
}

// The pins asked for ({ pinIds }), or every bound pin, stop moving their
// places. Nothing moves.
export async function DELETE(request: Request, { params }: { params: Promise<{ campaignId: string }> }) {
  const { campaignId } = await params;
  const context = await requireStoryAuthority(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const raw = (await request.json().catch(() => ({}))) as { pinIds?: unknown };
  const released = releaseFromRegion(campaignId, pinIdsOf(raw.pinIds));
  if (released.length) {
    publishEphemeral(campaignId, "world_updated", { at: Date.now() });
    recordsChanged(campaignId, "world");
  }
  return Response.json({ released });
}
