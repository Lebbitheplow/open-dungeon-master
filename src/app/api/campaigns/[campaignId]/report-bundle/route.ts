import { isErrorResponse, requireMember, type MemberContext } from "@/lib/campaign-api";
import { buildReportBundle, chosenParts, offeredParts } from "@/lib/report-bundle";
import {
  reportAddresses,
  reportCheckFirst,
  reportSecrets,
  tableReportSetup,
  tableReportSources,
  tableReportViewer,
} from "@/lib/report-bundle-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The report bundle at a table (issue #459, src/lib/report-bundle.ts), for
// the server's admin only: a player who hits a problem tells whoever runs
// the server, who can check its setup before anything reaches GitHub.
// GET says which parts the admin may include from their seat; POST builds
// the server's share of the file and hands it back to be saved on the
// admin's own device. Nothing is kept or sent anywhere. Who may include
// what is read from the seat here, never from the request: a part the
// request asks for and the seat does not allow is left out.
async function requireReporter(campaignId: string): Promise<MemberContext | Response> {
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  if (!context.user.isAdmin) {
    return Response.json({ error: "Only the server's admin can save a report." }, { status: 403 });
  }
  return context;
}

// GET also says what in the setup to check first (src/lib/report-setup.ts),
// for the dialog to show before anything is saved.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireReporter(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const viewer = tableReportViewer(context);
  const scope = { headers: request.headers };
  const checkFirst = reportCheckFirst(await tableReportSetup(context), {
    viewer,
    reporterUserId: context.user.id,
    secrets: reportSecrets(context, scope),
    addresses: reportAddresses(context, scope),
  });
  return Response.json({ parts: offeredParts(viewer), checkFirst }, { headers: { "cache-control": "no-store" } });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireReporter(campaignId);
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
    sources: await tableReportSources(context, parts, viewer),
    parts,
    viewer,
    reporterUserId: context.user.id,
    secrets: reportSecrets(context, scope),
    addresses: reportAddresses(context, scope),
  });
  return Response.json(bundle, { headers: { "cache-control": "no-store" } });
}
