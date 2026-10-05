import { isErrorResponse, requireStoryAuthority } from "@/lib/campaign-api";
import { campaignSeats, setDmMode, updateGameSettings } from "@/lib/db/campaigns";
import { isPrimaryDm } from "@/lib/dm/viewer";
import { gameSettingsSchema } from "@/lib/schemas/game-settings";
import { layOver } from "@/lib/schemas/parse-keeping-valid";
import { publishPersisted } from "@/lib/events";
import { wakeForWaitingPlayers } from "@/lib/dm/loop";

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
    // Changing the mode fills or empties the DM seats, so once a person runs
    // the game it is a seat change like any other (dm/seat/route.ts): the
    // DM's or the owner's, and never a co-DM's.
    const { campaign, user } = context;
    if (
      campaign.gameSettings.dmMode !== "ai" &&
      !isPrimaryDm(campaignSeats(campaign), user.id) &&
      campaign.ownerUserId !== user.id
    ) {
      return Response.json(
        { error: "Only the Dungeon Master can hand the game to someone else or to the AI." },
        { status: 403 },
      );
    }
    const changed = setDmMode(campaignId, dmMode, context.user.id);
    if (!changed) {
      return Response.json({ error: "Campaign not found." }, { status: 404 });
    }
    publishPersisted(campaignId, "dm_seat_changed", { seat: "dm", userId: changed.dmUserId });
    // Handed to the AI with players waiting on the person who ran it: answer.
    wakeForWaitingPlayers(campaignId, dmMode === "ai");
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
