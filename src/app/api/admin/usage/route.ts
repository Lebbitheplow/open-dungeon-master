import { isErrorResponse, requireAdmin } from "@/lib/admin-api";
import { usageOverview } from "@/lib/usage/ledger";
import { summarizeModelCalls } from "@/lib/usage/model-calls";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// What each account and each campaign has spent of the server's AI, with
// the counts an admin plans capacity by (issue #137). Aggregates only; the
// ledger never held a prompt or a transcript to begin with.
export async function GET() {
  const admin = await requireAdmin();
  if (isErrorResponse(admin)) {
    return admin;
  }
  // And how the model calls behaved over the last week, by what they were
  // for (src/lib/usage/model-calls.ts).
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
  return Response.json({ ...usageOverview(), modelCalls: summarizeModelCalls(since) });
}
