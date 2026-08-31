import { z } from "zod";
import { currentUser, unauthorized } from "@/lib/auth";
import { cloneCampaign } from "@/lib/db/campaign-clone";
import { publicCampaign } from "@/lib/db/campaigns";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/campaigns/[campaignId]/clone
//
// Copies a campaign or a workshop into a new one owned by the caller. Not
// requireMember: the permission is the same one that lets somebody copy prep
// OUT of this row, and that lives in src/lib/db/import-sources.ts, which
// cloneCampaign asks. A player at a table cannot clone their DM's campaign.
const cloneSchema = z.object({
  title: z.string().trim().max(80).optional(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const user = await currentUser();
  if (!user) {
    return unauthorized();
  }
  if (user.mustChangePassword) {
    return Response.json({ error: "Set a new password to continue." }, { status: 403 });
  }
  const { campaignId } = await params;
  const parsed = cloneSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: "Invalid clone." }, { status: 400 });
  }

  const result = cloneCampaign(user.id, campaignId, parsed.data.title);
  if ("error" in result) {
    return Response.json({ error: result.error }, { status: 404 });
  }
  return Response.json(
    { campaign: publicCampaign(result.campaign), copied: result.copied },
    { status: 201 },
  );
}
