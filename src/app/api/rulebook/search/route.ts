import { currentUser, unauthorized } from "@/lib/auth";
import { rulebookSearch } from "@/lib/rulebook/book";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const QUERY_MAX = 120;

// GET /api/rulebook/search?q=grapple: the passages that match, best first,
// each with the page's words the reader highlights.
export async function GET(request: Request) {
  const user = await currentUser();
  if (!user) {
    return unauthorized();
  }
  const q = (new URL(request.url).searchParams.get("q") ?? "").slice(0, QUERY_MAX);
  return Response.json(rulebookSearch(q));
}
