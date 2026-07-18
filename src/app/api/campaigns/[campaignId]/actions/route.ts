import { z } from "zod";
import { isErrorResponse, requireMember } from "@/lib/campaign-api";
import { allocateSeq, canAct, claimRecap, getFloor, setFloor } from "@/lib/db/campaigns";
import { countMessages, insertCampaignMessage, listRecentMessages } from "@/lib/db/messages";
import { getSheetForUser, listSheets } from "@/lib/db/sheets";
import { runDmTurn } from "@/lib/dm/loop";
import { enqueueDmJob } from "@/lib/dm/queue";
import { runResumeRecap } from "@/lib/dm/recap";
import { publishPersisted, publishWithSeq } from "@/lib/events";

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

  // Floor control: during a spotlight only the named players may act
  // (ooc is always allowed). A spotlighted player acting releases the floor.
  const floor = getFloor(campaignId);
  if (!canAct(floor, user.id, kind)) {
    const waitingOn =
      floor.mode === "spotlight"
        ? listSheets(campaignId)
            .filter((entry) => floor.userIds.includes(entry.userId))
            .map((entry) => entry.name)
            .join(", ")
        : "";
    return Response.json(
      {
        error: waitingOn
          ? `The DM is waiting on ${waitingOn}. Use OOC for table talk.`
          : "It is not your moment to act.",
        floor,
      },
      { status: 409 },
    );
  }
  if (kind !== "ooc" && floor.mode === "spotlight") {
    setFloor(campaignId, { mode: "open" });
    publishPersisted(campaignId, "floor_changed", { floor: { mode: "open" } });
  }

  const content =
    kind === "say"
      ? `"${parsed.data.content}"`
      : kind === "ooc"
        ? `(ooc) ${parsed.data.content}`
        : parsed.data.content;

  const isFirstAction = countMessages(campaignId) === 0;

  // Returning after a long break: enqueue a "Previously..." recap before
  // this action's DM turn (claimRecap makes it at most once per gap).
  const lastMessages = listRecentMessages(campaignId, 1);
  const lastMessage = lastMessages[lastMessages.length - 1];
  const RECAP_IDLE_MS = 6 * 60 * 60 * 1000;
  if (
    lastMessage &&
    Date.now() - new Date(lastMessage.createdAt).getTime() > RECAP_IDLE_MS &&
    claimRecap(campaignId, lastMessage.seq)
  ) {
    enqueueDmJob(campaignId, () => runResumeRecap(campaignId));
  }

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
