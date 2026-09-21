import { z } from "zod";
import { currentUser, unauthorized } from "@/lib/auth";
import {
  AGENT_SCOPES,
  createConnectionGrant,
  listConnectionGrants,
  type ConnectionGrant,
} from "@/lib/agents/grants";
import { recentAgentActivity } from "@/lib/agents/activity";
import { getCampaignForUser } from "@/lib/db/campaigns";
import { publicOrigin } from "@/lib/discord-oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Connected agents (docs/harness-mcp-plan.md 7): a player's own Claude Code,
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

export async function GET(request: Request) {
  const user = await currentUser();
  if (!user) {
    return unauthorized();
  }
  return Response.json({
    grants: listConnectionGrants(user.id).map(view),
    mcpUrl: `${publicOrigin(request)}/api/mcp`,
    recent: recentAgentActivity({ userId: user.id, limit: 20 }),
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
  });
}
