import { currentUser, unauthorized } from "@/lib/auth";
import { isErrorResponse, requireAdmin } from "@/lib/admin-api";
import { worldPack } from "@/lib/worlds";
import { removeWorldPack } from "@/lib/worlds/install";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/worlds/star_wars_galactic_civil_war
// The full pack, including every reskin table. The character builder fetches
// this for the one pack its campaign selected.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ packId: string }> },
) {
  const user = await currentUser();
  if (!user) {
    return unauthorized();
  }
  const { packId } = await params;
  const pack = worldPack(packId);
  if (!pack) {
    return Response.json({ error: "Unknown world pack." }, { status: 404 });
  }
  return Response.json({ pack });
}

// DELETE /api/worlds/star_wars_galactic_civil_war
//
// Uninstalls a world pack. Admin-only: it deletes a file from the server.
// Campaigns that had it selected keep running; presetFor falls back to the
// plain genre the moment the pack stops resolving.
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ packId: string }> },
) {
  const admin = await requireAdmin();
  if (isErrorResponse(admin)) {
    return admin;
  }
  const { packId } = await params;
  const result = await removeWorldPack(packId);
  if (!result.ok) {
    return Response.json({ error: result.error }, { status: result.status });
  }
  return Response.json({ removed: packId });
}
