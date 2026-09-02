import { z } from "zod";
import { currentUser, unauthorized } from "@/lib/auth";
import { getCampaignForUser } from "@/lib/db/campaigns";
import { areFriends } from "@/lib/db/friends";
import { notifyUsers } from "@/lib/db/notifications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Hands a friend the room code through the bell. Not a new invite
// mechanism: the code is the ticket, exactly as if it had been pasted in a
// chat, and joining still goes through /api/campaigns/join with its
// throttle and seat checks.

const inviteSchema = z.object({
  friendUserId: z.string().min(1),
  campaignId: z.string().min(1),
});

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) {
    return unauthorized();
  }
  if (user.mustChangePassword) {
    return Response.json({ error: "Set a new password to continue." }, { status: 403 });
  }

  const raw = await request.json().catch(() => ({}));
  const parsed = inviteSchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }

  // Friends only: the code is shareable anyway, but this route must not let
  // a stranger's inbox be reached by guessing user ids.
  if (!areFriends(user.id, parsed.data.friendUserId)) {
    return Response.json({ error: "You can only invite friends." }, { status: 403 });
  }

  // Membership gate doubles as the existence check; a non-member learns
  // nothing about the campaign id they guessed.
  const campaign = getCampaignForUser(parsed.data.campaignId, user.id);
  if (!campaign || campaign.kind !== "campaign") {
    return Response.json({ error: "Campaign not found." }, { status: 404 });
  }

  notifyUsers([parsed.data.friendUserId], {
    campaignId: campaign.id,
    kind: "friend_invite",
    body: `${user.username} invited you to "${campaign.title}". Join with room code ${campaign.inviteCode}.`,
  });
  return Response.json({ ok: true });
}
