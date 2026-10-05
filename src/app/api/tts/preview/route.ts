import { currentUser, unauthorized } from "@/lib/auth";
import { serveGeneratedFile } from "@/lib/serve-file";
import { isPreviewableVoice, renderVoicePreview, voicePreviewCached } from "@/lib/tts";
import { describeSpeechFailure, ttsBackend } from "@/lib/tts-backend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// A voice may be typed by hand now (issue 89), so the number of distinct
// clips one account can have rendered is bounded: each new one is a request
// to the speech server, which may be a paid API. Clips already on disk are
// free and never counted.
const RENDER_LIMIT = 12;
const RENDER_WINDOW_MS = 10 * 60 * 1000;
const renders = new Map<string, number[]>();

function mayRender(userId: string, now = Date.now()): boolean {
  const recent = (renders.get(userId) ?? []).filter((at) => now - at < RENDER_WINDOW_MS);
  if (recent.length >= RENDER_LIMIT) {
    renders.set(userId, recent);
    return false;
  }
  recent.push(now);
  renders.set(userId, recent);
  return true;
}

// Serves a short sample clip for a narrator voice so players can audition the
// picker choices. Rendered by the speech server on first request, cached on
// disk after. A failure answers with the reason, which the button shows.
export async function GET(request: Request) {
  const user = await currentUser();
  if (!user) {
    return unauthorized();
  }

  const voice = (new URL(request.url).searchParams.get("voice") ?? "").trim();
  if (!isPreviewableVoice(voice)) {
    return Response.json({ error: "Unknown voice." }, { status: 400 });
  }
  const backend = ttsBackend();
  if (backend.provider === "off") {
    return Response.json({ error: "Narration is switched off on this server." }, { status: 409 });
  }
  if (!voicePreviewCached(voice) && !mayRender(user.id)) {
    return Response.json({ error: "That is a lot of new voices at once. Try again in a few minutes." }, { status: 429 });
  }

  let name: string;
  try {
    name = await renderVoicePreview(voice);
  } catch (error) {
    console.error(`[tts] voice preview "${voice}" failed:`, error);
    return Response.json({ error: describeSpeechFailure(error, backend) }, { status: 502 });
  }
  return serveGeneratedFile("generated-audio", ["previews", name], request);
}
