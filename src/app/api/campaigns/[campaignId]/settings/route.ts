import { isErrorResponse, requireStoryAuthority } from "@/lib/campaign-api";
import { setDmMode, updateGameSettings } from "@/lib/db/campaigns";
import { gameSettingsSchema } from "@/lib/schemas/game-settings";
import { layOver } from "@/lib/schemas/parse-keeping-valid";
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

  // Laid over the stored settings before parsing: zod 4 fills a .default()
  // even under .partial(), so a partial parse would reset every unsent field.
  // The overlay reaches into groups too, so a caller (an agent through the
  // MCP bridge, say) may send one member of dmAssist or variantRules.
  const raw: unknown = await request.json().catch(() => ({}));
  const parsed = gameSettingsSchema.safeParse(layOver(context.campaign.gameSettings, raw));
  if (!parsed.success) {
    return Response.json({ error: "Invalid game settings." }, { status: 400 });
  }
  // Only the settings the body named are written back, so a change that lands
  // between the read above and the write below keeps its value.
  const sent = new Set(Object.keys(raw as object));

  // dmMode does not go through the generic merge: the DM seat is an invariant
  // of the mode (setDmMode keeps them in step), and a seat change is news the
  // table is owed, same as the seat route publishes it.
  const { dmMode, ...rest } = parsed.data;
  if (dmMode !== context.campaign.gameSettings.dmMode) {
    const changed = setDmMode(campaignId, dmMode, context.user.id);
    if (!changed) {
      return Response.json({ error: "Campaign not found." }, { status: 404 });
    }
    publishPersisted(campaignId, "dm_seat_changed", { seat: "dm", userId: changed.dmUserId });
  }
  const gameSettings = updateGameSettings(
    campaignId,
    Object.fromEntries(Object.entries(rest).filter(([key]) => sent.has(key))),
  );
  if (!gameSettings) {
    return Response.json({ error: "Campaign not found." }, { status: 404 });
  }
  publishPersisted(campaignId, "campaign_updated", { gameSettings });
  return Response.json({ gameSettings });
}
