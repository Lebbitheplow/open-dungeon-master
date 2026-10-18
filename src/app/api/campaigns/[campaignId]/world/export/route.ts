import { isErrorResponse, requireStoryAuthority } from "@/lib/campaign-api";
import { exportWorldForge } from "@/lib/db/world-forge-io";
import { slugOf } from "@/lib/language/text-logic";
import { attachmentDisposition } from "@/lib/serve-file";

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
  const name = slugOf(String(world.worldName)) || "world";
  return new Response(JSON.stringify(world), {
    headers: {
      "content-type": "application/json",
      "content-disposition": attachmentDisposition(`${name}.worldforge.json`),
    },
  });
}
