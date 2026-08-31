import { currentUser, unauthorized } from "@/lib/auth";
import { searchRulings } from "@/lib/reference/rulings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/reference/rulings?q=flanking
//
// The table's own rules as a browse tab next to the SRD ones. User-scoped
// through currentUser, which is the whole access check: rulings live on
// rulesets, and listRulesetsForUser only ever returns this user's.
export async function GET(request: Request) {
  const user = await currentUser();
  if (!user) {
    return unauthorized();
  }
  const q = new URL(request.url).searchParams.get("q") ?? "";
  return Response.json({ rulings: searchRulings(user.id, q) });
}
