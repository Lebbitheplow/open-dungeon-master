import { z } from "zod";
import { currentUser, unauthorized } from "@/lib/auth";
import { createCampaign, listCampaignsForUser } from "@/lib/db/campaigns";
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
});

export async function GET() {
  const user = await currentUser();
  if (!user) {
    return unauthorized();
  }
  return Response.json({ campaigns: listCampaignsForUser(user.id) });
}

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) {
    return unauthorized();
  }

  const raw = await request.json().catch(() => ({}));
  const parsed = createCampaignSchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json({ error: "Invalid campaign settings." }, { status: 400 });
  }

  const campaign = createCampaign(user.id, parsed.data);
  return Response.json({ campaign }, { status: 201 });
}
