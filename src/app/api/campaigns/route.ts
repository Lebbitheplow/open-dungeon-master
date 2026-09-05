import { z } from "zod";
import { currentUser, unauthorized } from "@/lib/auth";
import { createCampaign, listCampaignsForUser, publicCampaign, type Campaign } from "@/lib/db/campaigns";
import { playingAsByCampaign } from "@/lib/db/sheets";
import { gameSettingsSchema } from "@/lib/schemas/game-settings";
import { CAMPAIGN_DIFFICULTIES } from "@/lib/campaign-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createCampaignSchema = z.object({
  title: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).default(""),
  theme: z.string().trim().max(120).default(""),
  maxPlayers: z.number().int().min(1).max(8).default(5),
  startingLevel: z.number().int().min(1).max(20).default(1),
  difficulty: z.enum(CAMPAIGN_DIFFICULTIES).default("normal"),
  gameSettings: gameSettingsSchema.partial().default({}),
});

export async function GET() {
  const user = await currentUser();
  if (!user) {
    return unauthorized();
  }
  // The desktop and Android shells draw a home screen from this list alone:
  // each tile wants the cover (on the summary) and the name of the character
  // the caller plays there, so both ride here rather than costing a snapshot
  // fetch per campaign. One query covers every campaign's playingAs.
  const playingAs = playingAsByCampaign(user.id);
  return Response.json({
    campaigns: listCampaignsForUser(user.id).map((campaign) => ({
      ...publicCampaign(campaign as Campaign),
      playingAs: playingAs.get(campaign.id) ?? null,
    })),
  });
}

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) {
    return unauthorized();
  }
  if (user.mustChangePassword) {
    return Response.json({ error: "Set a new password to continue." }, { status: 403 });
  }

  const raw = await request.json().catch(() => ({}));
  const parsed = createCampaignSchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json({ error: "Invalid campaign settings." }, { status: 400 });
  }

  const campaign = createCampaign(user.id, parsed.data);
  return Response.json({ campaign: publicCampaign(campaign) }, { status: 201 });
}
