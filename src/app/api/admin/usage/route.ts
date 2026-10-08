import { isErrorResponse, requireAdmin } from "@/lib/admin-api";
import { usageOverview } from "@/lib/usage/ledger";

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
  return Response.json(usageOverview());
}
