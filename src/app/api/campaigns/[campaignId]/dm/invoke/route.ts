import { z } from "zod";
import { isErrorResponse, requireDm } from "@/lib/campaign-api";
import { consoleAdjudications } from "@/lib/dm/invoke-catalog";
import { invokeEngine } from "@/lib/dm/invoke";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The human DM's hands on the rules engine. Every action here is one the AI
// DM can also take, dispatched to the same handler by the same façade
// (src/lib/dm/invoke.ts), so the rules are enforced identically no matter
// who is running the table.

// GET returns the catalog the console renders itself from, so a tool added
// to the engine shows up as a form without any UI change.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireDm(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  return Response.json({ groups: consoleAdjudications() });
}

const invokeSchema = z.object({
  name: z.string().trim().min(1).max(60),
  args: z.record(z.string(), z.unknown()).default({}),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireDm(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const { campaign, user } = context;
  if (campaign.status !== "active") {
    return Response.json({ error: "The adventure has not started yet." }, { status: 400 });
  }

  const parsed = invokeSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: "Pick an action to run." }, { status: 400 });
  }

  const outcome = await invokeEngine(campaign, { kind: "human", userId: user.id }, parsed.data);
  if (!outcome.ok) {
    // A refusal from the engine is the rules talking, not a broken request:
    // 409 so the console shows it as an answer rather than a failure.
    return Response.json({ error: outcome.error }, { status: 409 });
  }
  return Response.json({ result: outcome.result });
}
