import { isErrorResponse, requireLead } from "@/lib/campaign-api";
import { getLatestDmMessage } from "@/lib/db/messages";
import { publishPersisted } from "@/lib/events";
import { getDmStatus } from "@/lib/dm/status";
import { runContinueScene } from "@/lib/dm/continue-scene";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Continue scene: extend the DM's newest narration in place rather than
// replacing it. Lead only, like rerolls, because it costs a model call and
// changes what the whole table is reading.

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ campaignId: string; messageId: string }> },
) {
  const { campaignId, messageId } = await params;
  const context = await requireLead(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }

  // Checked here as well as in the rim so an obviously wrong target is
  // refused before anything queues behind a live turn.
  const latest = getLatestDmMessage(campaignId);
  if (!latest || latest.id !== messageId) {
    return Response.json(
      { error: "Only the DM's most recent message can be continued." },
      { status: 400 },
    );
  }
  // A turn in flight is about to write past this narration, and the continue
  // would queue behind it and extend a message the story has moved on from.
  if (getDmStatus(campaignId) !== "idle") {
    return Response.json({ error: "The DM is mid-turn; try again after." }, { status: 409 });
  }

  const result = await runContinueScene({ campaignId, messageId });
  if ("error" in result) {
    return Response.json({ error: result.error }, { status: result.status });
  }
  publishPersisted(campaignId, "message_updated", { message: result.message });
  return Response.json({ message: result.message });
}
