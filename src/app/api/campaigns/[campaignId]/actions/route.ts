import { z } from "zod";
import { isErrorResponse, requireMember } from "@/lib/campaign-api";
import { allocateSeq } from "@/lib/db/campaigns";
import { countMessages, insertCampaignMessage } from "@/lib/db/messages";
import { getSheetForUser } from "@/lib/db/sheets";
import { runDmTurn } from "@/lib/dm/loop";
import { enqueueDmJob } from "@/lib/dm/queue";
import { publishWithSeq } from "@/lib/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const actionSchema = z.object({
  content: z.string().trim().min(1).max(2000),
  kind: z.enum(["do", "say", "ooc"]).default("do"),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }

  const { campaign, user } = context;
  if (campaign.status !== "active") {
    return Response.json({ error: "The adventure has not started yet." }, { status: 400 });
  }

  const sheet = getSheetForUser(campaignId, user.id);
  if (!sheet) {
    return Response.json({ error: "You need a character to act." }, { status: 400 });
  }

  const raw = await request.json().catch(() => ({}));
  const parsed = actionSchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json({ error: "Invalid action." }, { status: 400 });
  }

  const { kind } = parsed.data;
  const content =
    kind === "say"
      ? `"${parsed.data.content}"`
      : kind === "ooc"
        ? `(ooc) ${parsed.data.content}`
        : parsed.data.content;

  const isFirstAction = countMessages(campaignId) === 0;
  const seq = allocateSeq(campaignId);
  const message = insertCampaignMessage({
    campaignId,
    seq,
    authorType: "player",
    userId: user.id,
    characterId: sheet.id,
    content,
  });
  publishWithSeq(campaignId, seq, "message_added", { message });

  // OOC table talk does not wake the DM; everything else queues a narration
  // turn. The queue serializes turns per campaign.
  if (kind !== "ooc" || isFirstAction) {
    enqueueDmJob(campaignId, () => runDmTurn(campaignId));
  }

  return Response.json({ messageId: message.id }, { status: 202 });
}
