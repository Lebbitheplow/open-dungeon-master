import { isErrorResponse, requireStoryAuthority } from "@/lib/campaign-api";
import { LEAD_NOTE_PREFIX } from "@/lib/campaign-types";
import { allocateSeq, getFloor } from "@/lib/db/campaigns";
import { answerSpotlight } from "@/lib/dm/spotlight-answer";
import { insertCampaignMessage } from "@/lib/db/messages";
import { requestDmTurn } from "@/lib/dm/loop";
import { publishWithSeq } from "@/lib/events";
import { LEAD_NOTE_MAX_CHARS, textLength, tooLongMessage } from "@/lib/text-limits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Party lead story steering: inject a plot event or table direction the AI
// DM must weave into the story. Optionally wakes the DM immediately.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireStoryAuthority(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  if (context.campaign.status !== "active") {
    return Response.json({ error: "The campaign is not active." }, { status: 409 });
  }

  const raw = await request.json().catch(() => ({}));
  // Refused over the limit rather than cut: a direction that lost its end
  // could steer the DM somewhere its writer never meant (issue 207).
  const content = typeof raw?.content === "string" ? raw.content.trim() : "";
  if (!content) {
    return Response.json({ error: "Write the direction first." }, { status: 400 });
  }
  if (textLength(content) > LEAD_NOTE_MAX_CHARS) {
    return Response.json(
      { error: tooLongMessage("A direction", LEAD_NOTE_MAX_CHARS, textLength(content)), maxChars: LEAD_NOTE_MAX_CHARS },
      { status: 400 },
    );
  }
  const wake = raw?.wake !== false;
  // A spotlighted lead who sends a direction has answered the spotlight.
  answerSpotlight(campaignId, getFloor(campaignId), context.user.id);

  const seq = allocateSeq(campaignId);
  const message = insertCampaignMessage({
    campaignId,
    seq,
    authorType: "system",
    glyph: "cue-bell",
    userId: context.user.id,
    content: `${LEAD_NOTE_PREFIX}${content}`,
  });
  publishWithSeq(campaignId, seq, "message_added", { message });

  if (wake) {
    requestDmTurn(campaignId);
  }

  return Response.json({ message }, { status: 201 });
}
