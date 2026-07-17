import { z } from "zod";
import { currentUser, unauthorized } from "@/lib/auth";
import { joinByInviteCode } from "@/lib/db/campaigns";
import { publishPersisted } from "@/lib/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const joinSchema = z.object({
  inviteCode: z.string().trim().toUpperCase().min(4).max(12),
});

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) {
    return unauthorized();
  }

  const raw = await request.json().catch(() => ({}));
  const parsed = joinSchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json({ error: "Invalid invite code." }, { status: 400 });
  }

  const result = joinByInviteCode(user.id, parsed.data.inviteCode);
  if ("error" in result) {
    return Response.json({ error: result.error }, { status: 400 });
  }

  publishPersisted(result.campaign.id, "member_joined", {
    userId: user.id,
    username: user.username,
  });

  return Response.json({ campaign: result.campaign });
}
