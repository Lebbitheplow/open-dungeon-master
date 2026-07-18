import { z } from "zod";
import { isErrorResponse, requireMember } from "@/lib/campaign-api";
import { allocateSeq, canAct, claimRecap, getFloor, setFloor, type Floor } from "@/lib/db/campaigns";
import { countMessages, insertCampaignMessage, listRecentMessages } from "@/lib/db/messages";
import { getSheetForUser, listSheets } from "@/lib/db/sheets";
import { requestDmTurn } from "@/lib/dm/loop";
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

  // Floor control: during a spotlight only the named players may act (ooc is
  // always allowed); the floor releases once ALL of them have answered.
  // During a hold nobody may act until the lead releases. This read-modify-
  // write must stay await-free so it is atomic in Node.
  const floor = getFloor(campaignId);
  if (!canAct(floor, user.id, kind)) {
    if (floor.mode === "hold") {
      return Response.json(
        {
          error: "The party lead has not opened responses yet. Use OOC for table talk.",
          floor,
        },
        { status: 409 },
      );
    }
    const waitingOn =
      floor.mode === "spotlight"
        ? listSheets(campaignId)
            .filter(
              (entry) =>
                floor.userIds.includes(entry.userId) &&
                !floor.respondedUserIds.includes(entry.userId),
            )
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
  let spotlightStillWaiting = false;
  if (kind !== "ooc" && floor.mode === "spotlight") {
    const responded =
      floor.userIds.includes(user.id) && !floor.respondedUserIds.includes(user.id)
        ? [...floor.respondedUserIds, user.id]
        : floor.respondedUserIds;
    const allAnswered = floor.userIds.every((id) => responded.includes(id));
    const nextFloor: Floor = allAnswered
      ? { mode: "open" }
      : { ...floor, respondedUserIds: responded };
    if (allAnswered || responded !== floor.respondedUserIds) {
      setFloor(campaignId, nextFloor);
      publishPersisted(campaignId, "floor_changed", { floor: nextFloor });
    }
    spotlightStillWaiting = !allAnswered;
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

  // OOC table talk does not wake the DM; everything else requests a
  // narration turn, except while a spotlight still waits on other players:
  // the single coalesced turn fires with the last answer and reads all the
  // queued messages. Requests coalesce: rapid actions share one turn (plus
  // at most one follow-up for actions landing mid-turn) instead of stacking.
  if ((kind !== "ooc" && !spotlightStillWaiting) || isFirstAction) {
    requestDmTurn(campaignId);
  }

  return Response.json({ messageId: message.id }, { status: 202 });
}
