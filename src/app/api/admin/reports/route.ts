import { isErrorResponse, requireAdmin } from "@/lib/admin-api";
import { listReports } from "@/lib/db/moderation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The moderation queue. ?status=all includes what has been dealt with.
export async function GET(request: Request) {
  const admin = await requireAdmin();
  if (isErrorResponse(admin)) {
    return admin;
  }
  const status = new URL(request.url).searchParams.get("status") === "all" ? "all" : "open";
  return Response.json({ reports: listReports(status) });
}
