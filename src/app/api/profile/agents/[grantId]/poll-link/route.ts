import { currentUser, unauthorized } from "@/lib/auth";
import { listConnectionGrants } from "@/lib/agents/grants";
import { createPlayerPollLink, PollLinksOff } from "@/lib/agents/webhooks";
import { getSheetForUser } from "@/lib/db/sheets";
import { publicOrigin } from "@/lib/discord-oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Settings > Connected agents: a poll link for one of the player's own
// connections, for the character they play at its campaign, so an agent
// nothing can send requests to can still be woken (docs/player-webhooks.md).
// The link is shown once, like the connection's token; asking again
// replaces it.
export async function POST(request: Request, { params }: { params: Promise<{ grantId: string }> }) {
  const user = await currentUser();
  if (!user) {
    return unauthorized();
  }
  if (user.mustChangePassword) {
    return Response.json({ error: "Set a new password to continue." }, { status: 403 });
  }
  const { grantId } = await params;
  const grant = listConnectionGrants(user.id).find((entry) => entry.id === grantId);
  if (!grant) {
    return Response.json({ error: "Connection not found." }, { status: 404 });
  }
  if (grant.expiresAt <= new Date().toISOString()) {
    return Response.json({ error: "This connection has expired. Connect the agent again." }, { status: 410 });
  }
  if (!grant.campaignId) {
    return Response.json({ error: "Limit the connection to one campaign to make a poll link for it." }, { status: 400 });
  }
  const sheet = getSheetForUser(grant.campaignId, user.id);
  if (!sheet) {
    return Response.json({ error: "Play a character at that table first." }, { status: 400 });
  }
  try {
    const created = createPlayerPollLink(grant, { campaignId: grant.campaignId, characterId: sheet.id });
    return Response.json({ subscriptionId: created.id, url: `${publicOrigin(request)}${created.pollPath}` });
  } catch (error) {
    // Links switched off is the admin's call, not a clash with another link.
    const status = error instanceof PollLinksOff ? 403 : 409;
    return Response.json({ error: error instanceof Error ? error.message : "Could not make a poll link." }, { status });
  }
}
