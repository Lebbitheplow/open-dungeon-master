import { currentUser, unauthorized } from "@/lib/auth";
import { rulebookPage } from "@/lib/rulebook/book";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PAGE_ID = /^[a-z0-9-]{1,96}$/;

// GET /api/rulebook/pages/combat: one page's text, its chapter, and the
// pages either side of it.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) {
    return unauthorized();
  }
  const { id } = await params;
  const found = PAGE_ID.test(id) ? rulebookPage(id) : null;
  if (!found) {
    return Response.json({ error: "No such page in the rulebook." }, { status: 404 });
  }
  return Response.json(found, { headers: { "Cache-Control": "private, max-age=300" } });
}
