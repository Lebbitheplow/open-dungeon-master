import { isErrorResponse, requireAdmin } from "@/lib/admin-api";
import { buildReportBundle, chosenParts, offeredParts } from "@/lib/report-bundle";
import { ADMIN_REPORT_VIEWER, adminReportSetup, adminReportSources, reportAddresses, reportCheckFirst, reportSecrets } from "@/lib/report-bundle-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The report bundle from Admin (issue #459): the server's setup and
// the tail of its log, for a problem that is not one table's. Admins only;
// saved on the admin's own device, never sent anywhere.
export async function GET(request: Request) {
  const admin = await requireAdmin();
  if (isErrorResponse(admin)) {
    return admin;
  }
  const scope = { headers: request.headers, everyTable: true };
  const checkFirst = reportCheckFirst(await adminReportSetup(), {
    viewer: ADMIN_REPORT_VIEWER,
    reporterUserId: admin.id,
    secrets: reportSecrets(undefined, scope),
    addresses: reportAddresses(undefined, scope),
  });
  return Response.json({ parts: offeredParts(ADMIN_REPORT_VIEWER), checkFirst }, { headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  const admin = await requireAdmin();
  if (isErrorResponse(admin)) {
    return admin;
  }
  const body = (await request.json().catch(() => ({}))) as { parts?: unknown } | null;
  const parts = chosenParts(body?.parts, ADMIN_REPORT_VIEWER);
  const bundle = buildReportBundle({
    sources: await adminReportSources(parts),
    parts,
    viewer: ADMIN_REPORT_VIEWER,
    reporterUserId: admin.id,
    // The log can print any table's keys and backends.
    secrets: reportSecrets(undefined, { headers: request.headers, everyTable: true }),
    addresses: reportAddresses(undefined, { headers: request.headers, everyTable: true }),
  });
  return Response.json(bundle, { headers: { "cache-control": "no-store" } });
}
