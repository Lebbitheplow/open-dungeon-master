import { isErrorResponse, requireMember } from "@/lib/campaign-api";
import { buildReportBundle, chosenParts, offeredParts } from "@/lib/report-bundle";
import { reportAddresses, reportSecrets, tableReportSources, tableReportViewer } from "@/lib/report-bundle-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The tester's report bundle at a table (issue #459, src/lib/report-bundle.ts).
// GET says which parts this member may include; POST builds the server's
// share of the file and hands it back to be saved on the member's own
// device. Nothing is kept or sent anywhere. Who may include what is read
// from the member's seat here, never from the request: a part the request
// asks for and the seat does not allow is left out.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  return Response.json({ parts: offeredParts(tableReportViewer(context)) }, { headers: { "cache-control": "no-store" } });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const body = (await request.json().catch(() => ({}))) as { parts?: unknown } | null;
  const viewer = tableReportViewer(context);
  const parts = chosenParts(body?.parts, viewer);
  // The server log can print any table's keys and backends, so with it every
  // table's are cut, not only this one's.
  const scope = { headers: request.headers, everyTable: parts.has("serverLog") };
  const bundle = buildReportBundle({
    sources: tableReportSources(context, parts, viewer),
    parts,
    viewer,
    reporterUserId: context.user.id,
    secrets: reportSecrets(context, scope),
    addresses: reportAddresses(context, scope),
  });
  return Response.json(bundle, { headers: { "cache-control": "no-store" } });
}
