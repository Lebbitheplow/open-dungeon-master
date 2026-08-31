import { isErrorResponse, requireStoryAuthority } from "@/lib/campaign-api";
import { setDmMode, updateGameSettings } from "@/lib/db/campaigns";
import { gameSettingsSchema } from "@/lib/schemas/game-settings";
import { publishPersisted } from "@/lib/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Party-lead game settings edit (allowed in lobby and mid-campaign).
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireStoryAuthority(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }

  const raw = await request.json().catch(() => ({}));
  const parsed = gameSettingsSchema.partial().safeParse(raw);
  if (!parsed.success) {
    return Response.json({ error: "Invalid game settings." }, { status: 400 });
  }

  // dmMode does not go through the generic merge: the DM seat is an invariant
  // of the mode (setDmMode keeps them in step), and a seat change is news the
  // table is owed, same as the seat route publishes it.
  const { dmMode, ...rest } = parsed.data;
  let gameSettings = null;
  if (dmMode !== undefined && dmMode !== context.campaign.gameSettings.dmMode) {
    const changed = setDmMode(campaignId, dmMode, context.user.id);
    if (!changed) {
      return Response.json({ error: "Campaign not found." }, { status: 404 });
    }
    gameSettings = changed.gameSettings;
    publishPersisted(campaignId, "dm_seat_changed", { seat: "dm", userId: changed.dmUserId });
  }
  if (Object.keys(rest).length > 0 || !gameSettings) {
    gameSettings = updateGameSettings(campaignId, rest);
  }
  if (!gameSettings) {
    return Response.json({ error: "Campaign not found." }, { status: 404 });
  }
  publishPersisted(campaignId, "campaign_updated", { gameSettings });
  return Response.json({ gameSettings });
}
