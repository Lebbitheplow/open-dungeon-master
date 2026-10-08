import { z } from "zod";
import { currentUser, unauthorized } from "@/lib/auth";
import { publicCampaign } from "@/lib/db/campaigns";
import { campaignCreationRefusal, canCreateCampaigns } from "@/lib/shared-host";
import { createStarterCampaign, STARTER_ONE_SHOT } from "@/lib/starter/one-shot";
import { pregenSummaries } from "@/lib/starter/pregens";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The starter one-shot (src/lib/starter/one-shot.ts): what it is, and the
// heroes that come with it.
export async function GET() {
  const user = await currentUser();
  if (!user) {
    return unauthorized();
  }
  return Response.json({
    oneShot: {
      id: STARTER_ONE_SHOT.id,
      title: STARTER_ONE_SHOT.title,
      tagline: STARTER_ONE_SHOT.tagline,
      description: STARTER_ONE_SHOT.description,
    },
    pregens: pregenSummaries(),
  });
}

const startSchema = z.object({ solo: z.boolean().default(false) });

// One click: the campaign exists, the premise and the DM's outline are
// written, and the lobby offers the heroes.
export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) {
    return unauthorized();
  }
  if (user.mustChangePassword) {
    return Response.json({ error: "Set a new password to continue." }, { status: 403 });
  }
  if (!canCreateCampaigns(user)) {
    return campaignCreationRefusal();
  }
  const parsed = startSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }
  const campaign = createStarterCampaign(user.id, { solo: parsed.data.solo });
  return Response.json({ campaign: publicCampaign(campaign) }, { status: 201 });
}
