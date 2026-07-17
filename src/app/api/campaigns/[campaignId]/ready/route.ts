import { z } from "zod";
import { isErrorResponse, requireMember } from "@/lib/campaign-api";
import { setMemberReady } from "@/lib/db/campaigns";
import { publishPersisted } from "@/lib/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const readySchema = z.object({ ready: z.boolean() });

export async function POST(
  request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }

  const raw = await request.json().catch(() => ({}));
  const parsed = readySchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json({ error: "Invalid input." }, { status: 400 });
  }

  setMemberReady(campaignId, context.user.id, parsed.data.ready);
  publishPersisted(campaignId, "member_ready", {
    userId: context.user.id,
    ready: parsed.data.ready,
  });

  return Response.json({ ok: true });
}
