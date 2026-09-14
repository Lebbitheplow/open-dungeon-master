import { serverEnv } from "@/lib/server-env";

// Speech to text (docs/vtt-parity-implementation-plan.md 13.3): a
// faster-whisper server speaking the OpenAI transcription shape, named by
// STT_URL. Off when unset; nothing here ever runs without an operator
// choosing it.

export function sttUrl(): string {
  return serverEnv("STT_URL", "").replace(/\/+$/, "");
}

export function sttAvailable(): boolean {
  return Boolean(sttUrl());
}

export async function transcribeAudio(audio: Blob, filename = "ring.webm"): Promise<{ text: string } | { error: string }> {
  const base = sttUrl();
  if (!base) {
    return { error: "This server has no transcription service configured." };
  }
  const form = new FormData();
  form.append("file", audio, filename);
  form.append("model", serverEnv("STT_MODEL", "whisper-1"));
  form.append("response_format", "json");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);
  try {
    const response = await fetch(`${base}/v1/audio/transcriptions`, { method: "POST", body: form, signal: controller.signal });
    if (!response.ok) {
      return { error: `The transcriber answered ${response.status}.` };
    }
    const data = (await response.json().catch(() => ({}))) as { text?: string };
    return { text: String(data.text ?? "") };
  } catch {
    return { error: "The transcriber could not be reached." };
  } finally {
    clearTimeout(timer);
  }
}
