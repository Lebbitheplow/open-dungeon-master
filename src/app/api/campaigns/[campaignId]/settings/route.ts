import { isErrorResponse, requireLead } from "@/lib/campaign-api";
import { updateGameSettings } from "@/lib/db/campaigns";
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
  const context = await requireLead(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }

  const raw = await request.json().catch(() => ({}));
  const parsed = gameSettingsSchema.partial().safeParse(raw);
  if (!parsed.success) {
    return Response.json({ error: "Invalid game settings." }, { status: 400 });
  }

  const gameSettings = updateGameSettings(campaignId, parsed.data);
  if (!gameSettings) {
    return Response.json({ error: "Campaign not found." }, { status: 404 });
  }
  publishPersisted(campaignId, "campaign_updated", { gameSettings });
  return Response.json({ gameSettings });
}
