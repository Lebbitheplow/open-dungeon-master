import { currentUser, unauthorized } from "@/lib/auth";
import { listWorldPackSummaries } from "@/lib/worlds";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/worlds
// Summaries only. The full pack carries every reskin table, which is far more
// than a picker needs and far more than is worth shipping for the packs the
// table did not choose; /api/worlds/[packId] serves that on demand.
export async function GET() {
  const user = await currentUser();
  if (!user) {
    return unauthorized();
  }
  return Response.json({ packs: listWorldPackSummaries() });
}
