import { z } from "zod";
import { isErrorResponse, requireAdmin } from "@/lib/admin-api";
import { getReport, setReportStatus } from "@/lib/db/moderation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const patchSchema = z.object({ status: z.enum(["open", "resolved"]) });

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ reportId: string }> },
) {
  const admin = await requireAdmin();
  if (isErrorResponse(admin)) {
    return admin;
  }
  const { reportId } = await params;
  if (!getReport(reportId)) {
    return Response.json({ error: "Report not found." }, { status: 404 });
  }
  const parsed = patchSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }
  return Response.json({ report: setReportStatus(reportId, parsed.data.status, admin.id) });
}
