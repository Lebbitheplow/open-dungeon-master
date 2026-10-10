import { isErrorResponse, requireStoryAuthority } from "@/lib/campaign-api";
import { exportWorldForge } from "@/lib/db/world-forge-io";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The workshop's world as a WorldForge file (format version 4), pictures
// inline, ready to open in WorldForge. Hidden truths and author notes go
// with it: the file is the author's.
export async function GET(_request: Request, { params }: { params: Promise<{ campaignId: string }> }) {
  const { campaignId } = await params;
  const context = await requireStoryAuthority(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const world = exportWorldForge(campaignId);
  const name = String(world.worldName || "world").replace(/[^\w -]+/g, "").trim().replace(/\s+/g, "-").toLowerCase() || "world";
  return new Response(JSON.stringify(world), {
    headers: {
      "content-type": "application/json",
      "content-disposition": `attachment; filename="${name}.worldforge.json"`,
    },
  });
}
