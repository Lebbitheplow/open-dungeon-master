import { currentUser, unauthorized } from "@/lib/auth";
import { capsFor as capsForCampaign, getCampaignForUser, type Campaign } from "@/lib/db/campaigns";
import { storytellerSees, type ViewerCaps } from "@/lib/dm/viewer";
import type { User } from "@/lib/db/users";
import { isMemberMuted } from "@/lib/db/moderation";
import { fillUsageScope, openUsageScope } from "@/lib/usage/scope";

export type MemberContext = { user: User; campaign: Campaign };

// Resolves the logged-in user and their membership in a campaign, or the
// error Response the route should return.
export async function requireMember(
  campaignId: string,
): Promise<MemberContext | Response> {
  // Opened before the first await so it is the route's (src/lib/usage/scope.ts).
  const scope = openUsageScope();
  const user = await currentUser(scope);
  if (!user) {
    return unauthorized();
  }
  if (user.mustChangePassword) {
    // Admin reset a temp password for this account; nothing else works until
    // the user sets their own via /api/auth/change-password.
    return Response.json({ error: "Set a new password to continue." }, { status: 403 });
  }
  const campaign = getCampaignForUser(campaignId, user.id);
  if (!campaign) {
    return Response.json({ error: "Campaign not found." }, { status: 404 });
  }
  // Everything this request goes on to ask of a model, a painter or a
  // speech server is this campaign's in the usage ledger.
  fillUsageScope(scope, { campaignId: campaign.id, userId: user.id });
  return { user, campaign };
}

export function isErrorResponse(value: MemberContext | Response): value is Response {
  return value instanceof Response;
}

export function isLead(context: MemberContext): boolean {
  return context.user.id === context.campaign.leadUserId;
}

// What this member may see and do, decided once in src/lib/dm/viewer.ts.
export function capsFor(context: MemberContext): ViewerCaps {
  return capsForCampaign(context.campaign, context.user.id);
}

export function isDm(context: MemberContext): boolean {
  return capsFor(context).role === "dm";
}

// The inline counterpart to requireStoryAuthority, for routes that serve
// everyone but reveal or accept more from whoever runs the story: secret
// facts, note approval, pin curation, the digital dice fallback.
export function steersStory(context: MemberContext): boolean {
  return capsFor(context).steersStory;
}

// The tier above steersStory (src/lib/dm/viewer.ts, storyteller secrets):
// what is kept even from the lead who steers an AI table.
export function seesStorytellerSecrets(context: MemberContext): boolean {
  return storytellerSees(capsFor(context));
}

// Membership plus the right to speak. A member the party lead has muted
// keeps reading the table but every route that puts words in front of other
// players (actions, asks, side chats) goes through here and is refused.
export async function requireVoice(campaignId: string): Promise<MemberContext | Response> {
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  if (isMemberMuted(campaignId, context.user.id)) {
    return Response.json(
      { error: "The party lead has muted you at this table." },
      { status: 403 },
    );
  }
  return context;
}

// Membership plus party-lead check. The lead owns the table: campaign info,
// settings, invites, and who holds which seat. This is deliberately NOT the
// story-authority check, because at a human-DM table the lead is a player.
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

// Membership plus the DM seat. 403s for everyone in an AI-run campaign,
// where there is no such seat.
export async function requireDm(campaignId: string): Promise<MemberContext | Response> {
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  if (!isDm(context)) {
    return Response.json({ error: "Only the Dungeon Master can do that." }, { status: 403 });
  }
  return context;
}

// Prep authority (#154): the prepared fights, the map library and the
// Market's shops and shelves (#171). The DM
// seat at a table a person runs, and the party lead of an AI-narrated
// campaign, who steers the story there and is the only person who could
// bring the prep in (/api/campaigns/[id]/import follows the same rule). A
// lead at a human-DM table is a player and stays out, as does every other
// player: prepared fights are the story's secrets.
export async function requirePrepAuthority(campaignId: string): Promise<MemberContext | Response> {
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  if (!hasPrepAuthority(context)) {
    return Response.json(
      {
        error: context.campaign.dmUserId
          ? "Only the Dungeon Master can do that."
          : "Only the party lead can do that.",
      },
      { status: 403 },
    );
  }
  return context;
}

// The inline counterpart, for a route that serves every member but shows
// the prep tools only to whoever holds them (the Market panel, #171).
export function hasPrepAuthority(context: MemberContext): boolean {
  const caps = capsFor(context);
  return caps.role === "dm" || caps.steersStory;
}

// Story authority: floor control, lead directions, the secret arc, the
// context trace, force-ending an encounter. In an AI campaign this is the
// party lead, exactly as before. Once a person runs the game it is the DM,
// and the lead loses it, because those secrets are now the DM's to keep.
export async function requireStoryAuthority(
  campaignId: string,
): Promise<MemberContext | Response> {
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  if (!capsFor(context).steersStory) {
    return Response.json(
      {
        error: context.campaign.dmUserId
          ? "Only the Dungeon Master can do that."
          : "Only the party lead can do that.",
      },
      { status: 403 },
    );
  }
  return context;
}
