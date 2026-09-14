// Cutting the microphone into rings for transcription
// (docs/vtt-parity-implementation-plan.md 13.3). Browser-side, because the
// SFU never decodes audio: each client records its own stream in
// RING_SECONDS slices and posts each slice with when it began. Stops the
// moment the call ends or the table turns transcription off.

import { RING_SECONDS } from "@/lib/voice/transcript";

export function startTranscriptCapture(campaignId: string, stream: MediaStream): () => void {
  if (typeof MediaRecorder === "undefined") {
    return () => {};
  }
  const mimeType = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/webm"].find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
  let recorder: MediaRecorder | null = null;
  let startedAt = Date.now();
  let stopped = false;
  const cut = () => {
    if (stopped) {
      return;
    }
    try {
      recorder = new MediaRecorder(stream, mimeType ? { mimeType, audioBitsPerSecond: 32_000 } : undefined);
    } catch {
      return;
    }
    startedAt = Date.now();
    const chunks: Blob[] = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size) {
        chunks.push(event.data);
      }
    };
    recorder.onstop = () => {
      const seconds = (Date.now() - startedAt) / 1000;
      const blob = new Blob(chunks, { type: recorder?.mimeType || mimeType || "audio/webm" });
      if (blob.size > 0 && seconds >= 2) {
        const form = new FormData();
        form.append("audio", blob, "ring.webm");
        form.append("seconds", String(seconds));
        form.append("startedAt", new Date(startedAt).toISOString());
        void fetch(`/api/campaigns/${campaignId}/voice/transcript`, { method: "POST", body: form }).catch(() => {});
      }
      if (!stopped) {
        cut();
      }
    };
    recorder.start();
    setTimeout(() => {
      if (recorder?.state === "recording") {
        recorder.stop();
      }
    }, RING_SECONDS * 1000);
  };
  cut();
  return () => {
    stopped = true;
    if (recorder?.state === "recording") {
      recorder.stop();
    }
  };
}
