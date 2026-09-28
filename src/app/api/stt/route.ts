import { currentUser, unauthorized } from "@/lib/auth";
import { openAiSpeechConfig } from "@/lib/openai-images";
import { serverEnv } from "@/lib/server-env";
import { decodeWav, SPEECH_SAMPLE_RATE } from "@/lib/speech-wav";
import { currentSttBackend, whisperUrl } from "@/lib/stt-backend";
import { transcribeBuiltin } from "@/lib/stt-builtin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_AUDIO_BYTES = 8 * 1024 * 1024;
const TIMEOUT_MS = 120_000;

// Speech to text for push-to-talk and dictation. Whichever engine this
// server has answers (src/lib/stt-logic.ts): the local faster-whisper
// service (odm-stt on :8870, kept off the network behind this route), the
// built-in engine, or OpenAI on the server's key. Every path returns
// { text } so the browser never needs to know which one listened.
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

  const backend = await currentSttBackend();
  if (backend === "builtin") {
    return builtin(audio);
  }
  if (backend === "openai") {
    return openAi(audio);
  }
  if (backend === "none") {
    return Response.json(
      { error: "This server has no speech-to-text. An admin can install it under Admin > Speech." },
      { status: 503 },
    );
  }

  const upstream = new FormData();
  upstream.set("file", audio, audio.name || "speech.webm");
  upstream.set("model", serverEnv("STT_MODEL", "distil-large-v3"));
  try {
    const response = await fetch(`${whisperUrl()}/v1/audio/transcriptions`, {
      method: "POST",
      body: upstream,
      signal: AbortSignal.timeout(TIMEOUT_MS),
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

// The built-in engine reads 16 kHz WAV, which the browser makes when the
// capabilities say so. An older page that sends its raw recording is told
// to reload rather than handed a wrong transcript.
async function builtin(audio: File) {
  const decoded = decodeWav(new Uint8Array(await audio.arrayBuffer()));
  if (!decoded || decoded.sampleRate !== SPEECH_SAMPLE_RATE) {
    return Response.json(
      { error: "This server wants 16 kHz WAV for dictation. Reload the page and try again." },
      { status: 415 },
    );
  }
  try {
    return Response.json({ text: await transcribeBuiltin(decoded.samples) });
  } catch (error) {
    console.error("[speech] built-in transcription failed", error);
    return Response.json({ error: "The built-in speech engine could not transcribe that." }, { status: 502 });
  }
}

async function openAi(audio: File) {
  const { baseUrl, apiKey, model } = openAiSpeechConfig();
  const upstream = new FormData();
  upstream.set("file", audio, audio.name || "speech.webm");
  upstream.set("model", model);
  try {
    const response = await fetch(`${baseUrl}/audio/transcriptions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: upstream,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      console.error(`[speech] OpenAI transcription failed (${response.status}): ${detail.slice(0, 300)}`);
      return Response.json(
        { error: response.status === 401 ? "OpenAI refused the key for transcription." : "OpenAI could not transcribe that." },
        { status: 502 },
      );
    }
    const data = (await response.json()) as { text?: string };
    return Response.json({ text: (data.text ?? "").trim() });
  } catch {
    return Response.json({ error: "Could not reach OpenAI for transcription." }, { status: 502 });
  }
}
