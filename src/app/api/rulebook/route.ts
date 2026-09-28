import { currentUser, unauthorized } from "@/lib/auth";
import { rulebookContents } from "@/lib/rulebook/book";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/rulebook: the rulebook's contents (chapters, every page's title
// and folio, the quick links). No page text; that comes a page at a time.
export async function GET() {
  const user = await currentUser();
  if (!user) {
    return unauthorized();
  }
  return Response.json(rulebookContents(), {
    headers: { "Cache-Control": "private, max-age=300" },
  });
}
