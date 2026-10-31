import { z } from "zod";
import { currentUser, unauthorized } from "@/lib/auth";
import {
  AGENT_SCOPES,
  createConnectionGrant,
  listConnectionGrants,
  type ConnectionGrant,
} from "@/lib/agents/grants";
import { recentAgentActivity } from "@/lib/agents/activity";
import { assistantRelayUrl } from "@/lib/agents/assistant-relay";
import { listPlayerWebhooks, listPlayerWebhookStops, playerWebhooksEnabled, pollLinksAllowed } from "@/lib/agents/webhooks";
import { getCampaignForUser } from "@/lib/db/campaigns";
import { getSheetById, getSheetForUser } from "@/lib/db/sheets";
import { publicOrigin } from "@/lib/discord-oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Connected agents (docs/archive/harness-mcp-plan.md 7): a player's own Claude Code,
// Codex or other MCP client acting as them on this server. The token is
// shown once, at creation, and never again.

function view(grant: ConnectionGrant) {
  return {
    id: grant.id,
    name: grant.name,
    scopes: grant.scopes,
    campaignId: grant.campaignId,
    createdAt: grant.createdAt,
    expiresAt: grant.expiresAt,
    lastUsedAt: grant.lastUsedAt,
  };
}

// A sheet's name for this player's own page, or a plain stand-in for one
// that is gone (a lobby sheet rebuilt) or is not theirs.
function heroName(characterId: string, userId: string): string {
  const sheet = getSheetById(characterId);
  return sheet && sheet.userId === userId ? sheet.name : "your old character";
}

// What each connection's receivers and poll links wake, how their
// deliveries stand, and any that stopped on their own in the last 30 days
// and why (issue 654): before, a link that stopped left no trace here, and
// the player had to notice the agent had gone quiet.
function linksFor(grants: ConnectionGrant[], userId: string) {
  const links = grants.flatMap((grant) =>
    listPlayerWebhooks(grant.id).map((link) => ({
      id: link.id,
      grantId: grant.id,
      campaignId: link.campaignId,
      delivery: link.delivery,
      characterName: heroName(link.characterId, userId),
      pending: Number(link.pending) || 0,
      failed: Number(link.failed) || 0,
    })),
  );
  const stoppedLinks = listPlayerWebhookStops(grants.map((grant) => grant.id)).map((stop) => ({
    grantId: stop.grantId,
    campaignId: stop.campaignId,
    delivery: stop.delivery,
    reason: stop.reason,
    stoppedAt: stop.stoppedAt,
    characterName: heroName(stop.characterId, userId),
  }));
  return { links, stoppedLinks };
}

export async function GET(request: Request) {
  const user = await currentUser();
  if (!user) {
    return unauthorized();
  }
  const grants = listConnectionGrants(user.id);
  return Response.json({
    grants: grants.map(view),
    ...linksFor(grants, user.id),
    mcpUrl: `${publicOrigin(request)}/api/mcp`,
    // A device world's assistant link base ("" elsewhere): the token goes on
    // the end, and ChatGPT, Claude, Grok or Muse save the whole URL.
    assistantUrl: assistantRelayUrl(),
    recent: recentAgentActivity({ userId: user.id, limit: 20 }),
    // Whether a connection that can play one campaign may get a poll link,
    // so Settings offers one (or a replacement) on each such row.
    pollLinks: pollLinksAllowed(),
  });
}

const createSchema = z.object({
  name: z.string().trim().min(1).max(60),
  scopes: z.array(z.enum(AGENT_SCOPES)).min(1).max(AGENT_SCOPES.length),
  campaignId: z.string().trim().max(64).nullable().optional(),
  days: z.number().int().min(1).max(365).optional(),
});

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) {
    return unauthorized();
  }
  if (user.mustChangePassword) {
    return Response.json({ error: "Set a new password to continue." }, { status: 403 });
  }
  const parsed = createSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message || "Invalid request." }, { status: 400 });
  }
  const campaignId = parsed.data.campaignId || null;
  // A connection can only be pinned to a campaign its owner belongs to.
  if (campaignId && !getCampaignForUser(campaignId, user.id)) {
    return Response.json({ error: "Campaign not found." }, { status: 404 });
  }
  const created = createConnectionGrant({
    userId: user.id,
    name: parsed.data.name,
    scopes: parsed.data.scopes,
    campaignId,
    days: parsed.data.days,
  });
  if ("error" in created) {
    return Response.json({ error: created.error }, { status: 409 });
  }
  return Response.json({
    grant: view(created.grant),
    token: created.token,
    mcpUrl: `${publicOrigin(request)}/api/mcp`,
    assistantUrl: assistantRelayUrl(),
    receiver: receiverFor(created.grant, user.id),
  });
}

// A connection that can play one campaign can wake a player receiver for
// the character its owner plays there: what Settings needs to fill in the
// receiver's file (src/lib/agents/receiver-config.ts).
function receiverFor(grant: ConnectionGrant, userId: string) {
  if (!grant.campaignId || !grant.scopes.includes("read") || !grant.scopes.includes("play")) return null;
  const sheet = getSheetForUser(grant.campaignId, userId);
  return {
    campaignId: grant.campaignId,
    character: sheet ? { id: sheet.id, name: sheet.name } : null,
    webhooksEnabled: playerWebhooksEnabled(),
    pollLinks: pollLinksAllowed(),
  };
}
