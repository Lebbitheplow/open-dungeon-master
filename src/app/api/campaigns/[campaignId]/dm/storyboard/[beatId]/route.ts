import { isErrorResponse, requireDm } from "@/lib/campaign-api";
import { deleteBeat, updateBeat } from "@/lib/db/workshop-beats";
import { checkBeat, linksWithin } from "@/lib/workshop/board";
import { storyboardInventory } from "@/lib/db/workshop-common";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// One card on the board. PATCH takes the whole card, including where it sits
// and what it points at, because dragging a card and retyping its title are
// the same edit as far as storage is concerned.

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ campaignId: string; beatId: string }> },
) {
  const { campaignId, beatId } = await params;
  const context = await requireDm(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const checked = checkBeat(await request.json().catch(() => ({})));
  if ("error" in checked) {
    return Response.json({ error: checked.error }, { status: 400 });
  }
  // A link is kept only when it names a row this board may point at: its
  // own, or its shared workshop's (#159). Anything else is dropped here
  // rather than stored as sent.
  const { inventory } = storyboardInventory(context.campaign);
  // updateBeat is scoped to the campaign, so a card id from another
  // workshop reads as missing rather than as editable.
  const beat = updateBeat(campaignId, beatId, {
    ...checked.beat,
    links: linksWithin(checked.beat.links, inventory),
  });
  return beat
    ? Response.json({ beat })
    : Response.json({ error: "No such card." }, { status: 404 });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ campaignId: string; beatId: string }> },
) {
  const { campaignId, beatId } = await params;
  const context = await requireDm(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  return deleteBeat(campaignId, beatId)
    ? Response.json({ ok: true })
    : Response.json({ error: "No such card." }, { status: 404 });
}
