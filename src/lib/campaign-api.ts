import { currentUser, unauthorized } from "@/lib/auth";
import { getCampaignForUser, type Campaign } from "@/lib/db/campaigns";
import type { User } from "@/lib/db/users";

export type MemberContext = { user: User; campaign: Campaign };

// Resolves the logged-in user and their membership in a campaign, or the
// error Response the route should return.
export async function requireMember(
  campaignId: string,
): Promise<MemberContext | Response> {
  const user = await currentUser();
  if (!user) {
    return unauthorized();
  }
  const campaign = getCampaignForUser(campaignId, user.id);
  if (!campaign) {
    return Response.json({ error: "Campaign not found." }, { status: 404 });
  }
  return { user, campaign };
}

export function isErrorResponse(value: MemberContext | Response): value is Response {
  return value instanceof Response;
}
