import { currentUser, unauthorized } from "@/lib/auth";
import { configValue, getGlobalConfig } from "@/lib/app-config";
import { serverEnv } from "@/lib/server-env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_AUDIO_BYTES = 8 * 1024 * 1024;

// Proxies push-to-talk audio to the local faster-whisper service
// (odm-stt.service on :8870), keeping the service itself off the network.
export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) {
    return unauthorized();
  }

  const form = await request.formData().catch(() => null);
  const audio = form?.get("audio");
  if (!(audio instanceof File)) {
    return Response.json({ error: "Send audio as multipart field 'audio'." }, { status: 400 });
  }
  if (audio.size > MAX_AUDIO_BYTES) {
    return Response.json({ error: "Recording too long." }, { status: 413 });
  }

  const sttUrl = configValue(getGlobalConfig().speech.sttUrl, "STT_URL", "http://127.0.0.1:8870");
  const upstream = new FormData();
  upstream.set("file", audio, audio.name || "speech.webm");
  upstream.set("model", serverEnv("STT_MODEL", "distil-large-v3"));

  try {
    const response = await fetch(`${sttUrl}/v1/audio/transcriptions`, {
      method: "POST",
      body: upstream,
      signal: AbortSignal.timeout(120_000),
    });
    if (!response.ok) {
      return Response.json(
        { error: "The speech service could not transcribe that." },
        { status: 502 },
      );
    }
    const data = (await response.json()) as { text?: string };
    return Response.json({ text: (data.text ?? "").trim() });
  } catch {
    return Response.json(
      { error: "Speech service unreachable. Is odm-stt running on this server?" },
      { status: 502 },
    );
  }
}
