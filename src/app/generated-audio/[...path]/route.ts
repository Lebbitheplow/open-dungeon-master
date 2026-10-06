import { currentUser, unauthorized } from "@/lib/auth";
import { isCampaignMember } from "@/lib/db/campaigns";
import { serveGeneratedFile } from "@/lib/serve-file";
import { liveNarrationStream } from "@/lib/tts-render";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Serves runtime-generated narration audio (public/generated-audio is not
// covered by build-time static serving). Paths are
// {campaignId}/{messageId}.mp3, and narration can spoil a table's story, so
// only that campaign's members (or an admin) may listen.
export async function GET(
  request: Request,
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
  // A passage still being rendered is answered with what exists so far and
  // then each clip as it lands (src/lib/tts-render.ts), so the table hears
  // the first line while the last is being made. Never kept by a cache: the
  // finished file is what the address means from then on.
  const messageId = segments.length === 2 && segments[1].endsWith(".mp3") ? segments[1].slice(0, -".mp3".length) : "";
  const live = messageId ? liveNarrationStream(campaignId, messageId) : null;
  if (live) {
    return new Response(live, {
      headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store", "X-Accel-Buffering": "no" },
    });
  }
  return serveGeneratedFile("generated-audio", segments, request);
}
