import { z } from "zod";
import { isErrorResponse, requireMember } from "@/lib/campaign-api";
import { campaignSeats, listMembers, setAssistantDm, setHumanDm } from "@/lib/db/campaigns";
import { isPrimaryDm } from "@/lib/dm/viewer";
import { publishPersisted } from "@/lib/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The DM seats: who runs the game, and who co-runs it.
//
// The assistant DM's POWERS have existed since Phase 1, because isDmSeat
// counts both seats and every guard reads it. What was missing was any way to
// APPOINT one, which made the column dead weight. This is that.
//
// Only the primary DM (or the campaign owner, who can always fix a table that
// has locked itself out) may move the seats. A co-DM has every in-game power
// and none of this one: handing the game to someone else is the one thing a
// deputy should not be able to do on the boss's behalf.

const seatSchema = z.object({
  seat: z.enum(["dm", "assistant"]),
  // A member's user id, or null to empty the seat.
  userId: z.string().nullable(),
});

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const { campaign, user } = context;
  return Response.json({
    dmUserId: campaign.dmUserId,
    assistantDmUserId: campaign.assistantDmUserId,
    // Whether THIS viewer may move the seats, so the client renders the
    // control rather than offering a button the server will refuse.
    canAssign: isPrimaryDm(campaignSeats(campaign), user.id) || campaign.ownerUserId === user.id,
  });
}

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
  if (campaign.gameSettings.dmMode === "ai") {
    return Response.json(
      { error: "The AI runs this game; there is no DM seat to fill." },
      { status: 400 },
    );
  }
  if (!isPrimaryDm(campaignSeats(campaign), user.id) && campaign.ownerUserId !== user.id) {
    return Response.json(
      { error: "Only the Dungeon Master can hand out the DM seats." },
      { status: 403 },
    );
  }

  const parsed = seatSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: "Say which seat, and who fills it." }, { status: 400 });
  }
  const { seat, userId } = parsed.data;

  if (userId && !listMembers(campaignId).some((member) => member.userId === userId)) {
    return Response.json({ error: "That player is not at this table." }, { status: 400 });
  }
  // The two seats cannot be the same person: a co-DM who is also the DM is
  // just the DM, and the pair would then disagree about who may re-seat whom.
  if (userId && seat === "assistant" && userId === campaign.dmUserId) {
    return Response.json(
      { error: "They already run the game; a co-DM has to be someone else." },
      { status: 400 },
    );
  }
  if (userId && seat === "dm" && userId === campaign.assistantDmUserId) {
    // Promoting the co-DM is a real thing to want, so it empties the co-DM
    // seat rather than being refused.
    setAssistantDm(campaignId, null);
  }
  if (seat === "dm" && !userId) {
    return Response.json(
      { error: "A human-run game needs someone in the DM seat. Switch to the AI instead." },
      { status: 400 },
    );
  }

  const applied =
    seat === "dm" ? setHumanDm(campaignId, userId) : setAssistantDm(campaignId, userId);
  if (!applied) {
    return Response.json({ error: "Could not move that seat." }, { status: 409 });
  }
  // Persisted and table-wide: who is running the game is not a private fact,
  // and a player whose adjudicator changed mid-session is owed the news.
  publishPersisted(campaignId, "dm_seat_changed", { seat, userId });
  return Response.json({ ok: true, seat, userId });
}
