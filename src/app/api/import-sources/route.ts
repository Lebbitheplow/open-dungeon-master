import { currentUser, unauthorized } from "@/lib/auth";
import { listImportSourcesForUser } from "@/lib/db/import-sources";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Everything this user may copy prep out of: their workshops, and the
// campaigns whose story they steer. One round trip, counts included, because
// the picker needs "3 lore, 2 tables" for every option at once.
export async function GET() {
  const user = await currentUser();
  if (!user) {
    return unauthorized();
  }
  return Response.json({ sources: listImportSourcesForUser(user.id) });
}
