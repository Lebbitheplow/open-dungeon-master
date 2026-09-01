import { currentUser, unauthorized } from "@/lib/auth";
import { isCampaignMember } from "@/lib/db/campaigns";
import { serveGeneratedFile } from "@/lib/serve-file";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Serves runtime-generated narration audio (public/generated-audio is not
// covered by build-time static serving). Paths are
// {campaignId}/{messageId}.mp3, and narration can spoil a table's story, so
// only that campaign's members (or an admin) may listen.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const user = await currentUser();
  if (!user) {
    return unauthorized();
  }
  const { path: segments } = await params;
  const campaignId = segments[0] ?? "";
  if (!user.isAdmin && !isCampaignMember(campaignId, user.id)) {
    return Response.json({ error: "Not found." }, { status: 404 });
  }
  return serveGeneratedFile("generated-audio", segments);
}
