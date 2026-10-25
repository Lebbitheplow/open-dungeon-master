import { isErrorResponse, requireAdmin } from "@/lib/admin-api";
import { narratorQualityFile, narratorQualityOverview } from "@/lib/narrator-quality-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Admin > Usage > Narrator quality (issue #460): rates per backend class and
// DM mode, and the tools most often corrected. GET ?export=1 is the file the
// "Export narrator quality" button saves: the same rows with every id hashed
// and no name, prompt or narration. Admins only; nothing is sent anywhere.
export async function GET(request: Request) {
  const admin = await requireAdmin();
  if (isErrorResponse(admin)) {
    return admin;
  }
  const exporting = new URL(request.url).searchParams.get("export") === "1";
  return Response.json(exporting ? narratorQualityFile() : narratorQualityOverview(), { headers: { "cache-control": "no-store" } });
}
