import { isErrorResponse, requireVoice } from "@/lib/campaign-api";
import { requestDmTurn } from "@/lib/dm/loop";
import { passTable } from "@/lib/dm/table-wait";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Wait for the table: "go on without me" for this beat. The DM stops
// waiting on this player, and when they were the last one it waits on, the
// held turn runs now (src/lib/dm/table-wait.ts). Nothing is posted to the
// transcript; the pass is a table_pass event every seat and agent reads.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireVoice(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const result = passTable(campaignId, context.user.id);
  if (!result.ok) {
    return Response.json({ error: result.error }, { status: result.status });
  }
  if (result.fire) {
    requestDmTurn(campaignId);
  }
  return Response.json({ ok: true, woke: result.fire });
}
