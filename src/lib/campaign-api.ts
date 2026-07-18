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

export function isLead(context: MemberContext): boolean {
  return context.user.id === context.campaign.leadUserId;
}

// Membership plus party-lead check; the lead steers the story and fixes
// stats when the AI DM errs.
export async function requireLead(campaignId: string): Promise<MemberContext | Response> {
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  if (!isLead(context)) {
    return Response.json({ error: "Only the party lead can do that." }, { status: 403 });
  }
  return context;
}
