import { currentUser, unauthorized } from "@/lib/auth";
import { serveGeneratedFile } from "@/lib/serve-file";
import { isPreviewableVoice, renderVoicePreview } from "@/lib/tts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Serves a short sample clip for a narrator voice so players can audition the
// picker choices. Rendered by Kokoro on first request, cached on disk after.
export async function GET(request: Request) {
  const user = await currentUser();
  if (!user) {
    return unauthorized();
  }

  const voice = new URL(request.url).searchParams.get("voice") ?? "";
  if (!isPreviewableVoice(voice)) {
    return Response.json({ error: "Unknown voice." }, { status: 400 });
  }

  try {
    await renderVoicePreview(voice);
  } catch (error) {
    console.error(`[tts] voice preview "${voice}" failed:`, error);
    return Response.json({ error: "Voice preview unavailable." }, { status: 502 });
  }
  return serveGeneratedFile("generated-audio", ["previews", `${voice}.mp3`]);
}
