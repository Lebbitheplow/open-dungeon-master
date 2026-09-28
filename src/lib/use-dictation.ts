"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { readMicId } from "@/app/campaigns/[campaignId]/useVoicePrefs";
import {
  DICTATION_BITRATE,
  DICTATION_MAX_MS,
  DICTATION_MIN_BYTES,
  dictationFileName,
  levelFromWaveform,
  pickRecorderType,
} from "@/lib/dictation";
import { micBlockMessage, micBlockReason } from "@/lib/secure-context";

export type DictationState = "idle" | "starting" | "recording" | "transcribing" | "error";

// One microphone take, sent whole to /api/stt when it ends. Shared by the
// hold-to-talk button in the composer and the tap-to-dictate button on the
// DM's summaries and notes; the two differ only in when they call stop().
//
// The transcript is handed to the latest onTranscript, never a stale one,
// so a field that changed while the take was being written down appends to
// what is there now. Nothing is sent anywhere else: the words land in the
// field for the writer to read over and save.
export function useDictation({
  onTranscript,
  maxMs = DICTATION_MAX_MS,
}: {
  onTranscript: (text: string) => void;
  maxMs?: number;
}) {
  const [state, setState] = useState<DictationState>("idle");
  const [hint, setHint] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const onTranscriptRef = useRef(onTranscript);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const activeRef = useRef(false);
  const discardRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const teardownRef = useRef<(() => void) | null>(null);
  // The element that shows the live level, set by the caller; it gets a
  // --dictate-level custom property (0 to 1) every frame while recording.
  const meterRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    onTranscriptRef.current = onTranscript;
  });

  const send = useCallback(async (blob: Blob, type: string) => {
    setState("transcribing");
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const form = new FormData();
      form.set("audio", blob, dictationFileName(type));
      const response = await fetch("/api/stt", { method: "POST", body: form, signal: controller.signal });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setHint(data.error || "Transcription failed.");
        setState("error");
        return;
      }
      const text = String(data.text ?? "").trim();
      if (!text) {
        setHint("No words came through. Try again a little closer to the mic.");
        setState("error");
        return;
      }
      onTranscriptRef.current(text);
      setState("idle");
    } catch {
      if (controller.signal.aborted) {
        return;
      }
      setHint("Could not reach the server.");
      setState("error");
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
    }
  }, []);

  const stop = useCallback(() => {
    activeRef.current = false;
    if (recorderRef.current?.state === "recording") {
      recorderRef.current.stop();
    }
  }, []);

  // Ends the take and throws it away.
  const cancel = useCallback(() => {
    discardRef.current = true;
    stop();
    abortRef.current?.abort();
    setState((current) => (current === "error" ? current : "idle"));
  }, [stop]);

  const start = useCallback(async () => {
    if (activeRef.current || recorderRef.current?.state === "recording") {
      return;
    }
    // On a plain http address navigator.mediaDevices is undefined; say so
    // rather than blaming a permission the browser never asked for.
    const blocked = micBlockReason();
    if (blocked) {
      setHint(micBlockMessage(blocked));
      setState("error");
      return;
    }
    if (typeof MediaRecorder === "undefined") {
      setHint("This browser cannot record audio.");
      setState("error");
      return;
    }
    activeRef.current = true;
    discardRef.current = false;
    setHint("");
    setState("starting");
    let stream: MediaStream;
    try {
      const savedMic = readMicId();
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          ...(savedMic ? { deviceId: { ideal: savedMic } } : {}),
        },
      });
    } catch {
      activeRef.current = false;
      setHint("Microphone unavailable. Check the permission for this page.");
      setState("error");
      return;
    }
    // Let go (or cancelled) while the permission prompt was up.
    if (!activeRef.current) {
      stream.getTracks().forEach((track) => track.stop());
      setState("idle");
      return;
    }

    const type = pickRecorderType((candidate) => MediaRecorder.isTypeSupported(candidate));
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, {
        ...(type ? { mimeType: type } : {}),
        audioBitsPerSecond: DICTATION_BITRATE,
      });
    } catch {
      recorder = new MediaRecorder(stream);
    }

    // The level meter: an analyser on the same stream, read once a frame.
    let context: AudioContext | null = null;
    let frame = 0;
    try {
      const Context = window.AudioContext;
      if (Context) {
        context = new Context();
        const analyser = context.createAnalyser();
        analyser.fftSize = 512;
        context.createMediaStreamSource(stream).connect(analyser);
        const samples = new Uint8Array(analyser.fftSize);
        let level = 0;
        const tick = () => {
          analyser.getByteTimeDomainData(samples);
          level = Math.max(levelFromWaveform(samples), level * 0.85);
          meterRef.current?.style.setProperty("--dictate-level", level.toFixed(3));
          frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
      }
    } catch {
      // No meter; the recording itself does not need one.
    }

    const startedAt = Date.now();
    setElapsed(0);
    const timer = window.setInterval(() => {
      const spent = Date.now() - startedAt;
      setElapsed(spent);
      if (spent >= maxMs) {
        stop();
      }
    }, 250);

    const teardown = () => {
      window.clearInterval(timer);
      cancelAnimationFrame(frame);
      meterRef.current?.style.removeProperty("--dictate-level");
      stream.getTracks().forEach((track) => track.stop());
      void context?.close().catch(() => {});
      teardownRef.current = null;
    };
    teardownRef.current = teardown;

    const chunks: Blob[] = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size) {
        chunks.push(event.data);
      }
    };
    recorder.onstop = () => {
      teardown();
      recorderRef.current = null;
      if (discardRef.current) {
        return;
      }
      const blob = new Blob(chunks, { type: recorder.mimeType || type || "audio/webm" });
      if (blob.size < DICTATION_MIN_BYTES) {
        setState("idle");
        return;
      }
      void send(blob, blob.type);
    };
    recorderRef.current = recorder;
    recorder.start();
    setState("recording");
  }, [maxMs, send, stop]);

  // Leaving the page or closing the editor mid-take drops it.
  useEffect(
    () => () => {
      discardRef.current = true;
      activeRef.current = false;
      if (recorderRef.current?.state === "recording") {
        recorderRef.current.stop();
      }
      teardownRef.current?.();
      abortRef.current?.abort();
    },
    [],
  );

  const busy = state === "starting" || state === "recording";
  return { state, hint, elapsed, busy, start, stop, cancel, meterRef, clearHint: () => setHint("") };
}
