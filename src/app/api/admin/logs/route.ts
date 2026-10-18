import { isErrorResponse, requireAdmin } from "@/lib/admin-api";
import { getGlobalConfig } from "@/lib/db/app-settings";
import { readServerLog, secretValuesIn, serverLogText } from "@/lib/server-log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The admin's Server log (src/lib/server-log.ts): the lines after `after`,
// or with ?format=text the whole kept log as a file. Admins only; the keys
// saved in the admin panel are cut out of every line on the way out.
export async function GET(request: Request) {
  const admin = await requireAdmin();
  if (isErrorResponse(admin)) {
    return admin;
  }
  const url = new URL(request.url);
  const secrets = secretValuesIn(getGlobalConfig());
  if (url.searchParams.get("format") === "text") {
    const { entries } = readServerLog({ secrets });
    return new Response(serverLogText(entries), {
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "content-disposition": `attachment; filename="odm-server-log-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.txt"`,
        "cache-control": "no-store",
      },
    });
  }
  const after = Number.parseInt(url.searchParams.get("after") ?? "0", 10);
  return Response.json(readServerLog({ after: Number.isFinite(after) ? after : 0, secrets }), {
    headers: { "cache-control": "no-store" },
  });
}
