"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { readMicId } from "@/app/campaigns/[campaignId]/useVoicePrefs";
import {
  DICTATION_BITRATE,
  DICTATION_MAX_MS,
  DICTATION_MIN_BYTES,
  dictationFileName,
  levelFromWaveform,
  pickDictationEngine,
  pickRecorderType,
} from "@/lib/dictation";
import { nativeDictation, subscribeNativeDictation, type NativeDictation } from "@/lib/native-dictation";
import { micBlockMessage, micBlockReason } from "@/lib/secure-context";
import { encodeWav, SPEECH_SAMPLE_RATE, splitForUpload } from "@/lib/speech-wav";
import { useCapabilities } from "@/lib/use-capabilities";

export type DictationState = "idle" | "starting" | "recording" | "transcribing" | "error";

// One take of speech, turned into words. Shared by the hold-to-talk button
// in the composer and the tap-to-dictate button on the DM's summaries and
// notes; the two differ only in when they call stop().
//
// Where the words come from follows the server (pickDictationEngine): its
// speech-to-text when it has one, as the recording itself or as 16 kHz WAV
// for the built-in engine, and otherwise the device's own recognizer when
// an app shell offers one. The transcript is handed to the latest
// onTranscript, never a stale one, so a field that changed during the take
// appends to what is there now. Nothing is saved or sent anywhere else.
export function useDictation({
  onTranscript,
  maxMs = DICTATION_MAX_MS,
}: {
  onTranscript: (text: string) => void;
  maxMs?: number;
}) {
  const capabilities = useCapabilities();
  // False on the server render, which has no window, so a bridge that only
  // the client sees cannot mismatch the markup; a shell that installs one
  // later says so with an event.
  const hasNative = useSyncExternalStore(subscribeNativeDictation, hasNativeDictation, noNativeOnServer);
  const engine = pickDictationEngine(capabilities?.stt, hasNative);

  const [state, setState] = useState<DictationState>("idle");
  const [hint, setHint] = useState("");
  const [elapsed, setElapsed] = useState(0);
  // What the device's recognizer has heard so far (native takes only).
  const [partial, setPartial] = useState("");
  // Uploads of a long WAV take: which part is being written down.
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const onTranscriptRef = useRef(onTranscript);
  const engineRef = useRef(engine);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const activeRef = useRef(false);
  const nativeLiveRef = useRef(false);
  const discardRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const teardownRef = useRef<(() => void) | null>(null);
  const timerRef = useRef(0);
  // Why the device's recognizer ended a take on its own, shown if the take
  // brought back no words.
  const nativeErrorRef = useRef("");
  const stopRef = useRef<() => void>(() => {});
  // The element that shows the live level, set by the caller; it gets a
  // --dictate-level custom property (0 to 1) while recording.
  const meterRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    onTranscriptRef.current = onTranscript;
    engineRef.current = engine;
  });

  const setLevel = useCallback((level: number | null) => {
    if (level === null) {
      meterRef.current?.style.removeProperty("--dictate-level");
    } else {
      meterRef.current?.style.setProperty("--dictate-level", Math.max(0, Math.min(1, level)).toFixed(3));
    }
  }, []);

  const stopTimer = useCallback(() => {
    window.clearInterval(timerRef.current);
    timerRef.current = 0;
  }, []);

  const startTimer = useCallback(
    (onLimit: () => void) => {
      const startedAt = Date.now();
      setElapsed(0);
      window.clearInterval(timerRef.current);
      timerRef.current = window.setInterval(() => {
        const spent = Date.now() - startedAt;
        setElapsed(spent);
        if (spent >= maxMs) {
          onLimit();
        }
      }, 250);
    },
    [maxMs],
  );

  const deliver = useCallback((text: string) => {
    const said = text.trim();
    if (!said) {
      setHint("No words came through. Try again a little closer to the mic.");
      setState("error");
      return;
    }
    onTranscriptRef.current(said);
    setState("idle");
  }, []);

  // One upload to /api/stt; the words, or an Error carrying the server's
  // sentence.
  const upload = useCallback(async (blob: Blob, name: string, signal: AbortSignal): Promise<string> => {
    const form = new FormData();
    form.set("audio", blob, name);
    const response = await fetch("/api/stt", { method: "POST", body: form, signal });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || "Transcription failed.");
    }
    return String(data.text ?? "").trim();
  }, []);

  const send = useCallback(
    async (blob: Blob, type: string, asWav: boolean) => {
      setState("transcribing");
      const controller = new AbortController();
      abortRef.current = controller;
      const heard: string[] = [];
      try {
        if (!asWav) {
          deliver(await upload(blob, dictationFileName(type), controller.signal));
          return;
        }
        const chunks = splitForUpload(await toSpeechSamples(blob));
        setProgress(chunks.length > 1 ? { done: 0, total: chunks.length } : null);
        for (const [index, chunk] of chunks.entries()) {
          const wav = new Blob([encodeWav(chunk).buffer as ArrayBuffer], { type: "audio/wav" });
          heard.push(await upload(wav, "speech.wav", controller.signal));
          setProgress(chunks.length > 1 ? { done: index + 1, total: chunks.length } : null);
        }
        deliver(heard.join(" "));
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }
        // Keep what a long take already produced before the failure.
        const kept = heard.join(" ").trim();
        if (kept) {
          onTranscriptRef.current(kept);
        }
        const reason = error instanceof TypeError ? "Could not reach the server." : errorText(error, "Transcription failed.");
        setHint(kept ? `${reason} The part before that is in the field.` : reason);
        setState("error");
      } finally {
        setProgress(null);
        if (abortRef.current === controller) {
          abortRef.current = null;
        }
      }
    },
    [deliver, upload],
  );

  const stop = useCallback(() => {
    activeRef.current = false;
    if (nativeLiveRef.current) {
      nativeLiveRef.current = false;
      stopTimer();
      setLevel(null);
      const bridge = nativeDictation();
      if (!bridge) {
        setState("idle");
        return;
      }
      setState("transcribing");
      bridge.stop().then(
        (text) => {
          setPartial("");
          const reason = nativeErrorRef.current;
          nativeErrorRef.current = "";
          if (discardRef.current) {
            return;
          }
          if (!text.trim() && reason) {
            setHint(reason);
            setState("error");
            return;
          }
          deliver(text);
        },
        (error: unknown) => {
          setPartial("");
          setHint(errorText(error, "The device's speech recognizer stopped."));
          setState("error");
        },
      );
      return;
    }
    if (recorderRef.current?.state === "recording") {
      recorderRef.current.stop();
    }
  }, [deliver, setLevel, stopTimer]);

  useEffect(() => {
    stopRef.current = stop;
  });

  // Ends the take and throws it away.
  const cancel = useCallback(() => {
    discardRef.current = true;
    if (nativeLiveRef.current) {
      nativeLiveRef.current = false;
      activeRef.current = false;
      stopTimer();
      setLevel(null);
      setPartial("");
      void nativeDictation()?.cancel().catch(() => {});
    } else {
      stop();
    }
    abortRef.current?.abort();
    setState((current) => (current === "error" ? current : "idle"));
  }, [setLevel, stop, stopTimer]);

  const startNative = useCallback(
    async (bridge: NativeDictation) => {
      activeRef.current = true;
      discardRef.current = false;
      nativeErrorRef.current = "";
      setHint("");
      setPartial("");
      setState("starting");
      try {
        await bridge.start({
          onLevel: setLevel,
          onPartial: setPartial,
          onError: (message) => {
            nativeErrorRef.current = message;
            stopRef.current();
          },
        });
      } catch (error) {
        activeRef.current = false;
        setHint(errorText(error, "This device's speech recognizer is unavailable."));
        setState("error");
        return;
      }
      // Let go (or cancelled) while the recognizer was starting.
      if (!activeRef.current) {
        void bridge.cancel().catch(() => {});
        setState("idle");
        return;
      }
      nativeLiveRef.current = true;
      setState("recording");
      startTimer(stop);
    },
    [setLevel, startTimer, stop],
  );

  const start = useCallback(async () => {
    if (activeRef.current || nativeLiveRef.current || recorderRef.current?.state === "recording") {
      return;
    }
    const current = engineRef.current;
    if (current === "none") {
      setHint("This server has no speech-to-text. An admin can install it under Admin > Speech.");
      setState("error");
      return;
    }
    const bridge = nativeDictation();
    if (current === "native" && bridge) {
      await startNative(bridge);
      return;
    }
    const asWav = current === "upload-wav";
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
          setLevel(level);
          frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
      }
    } catch {
      // No meter; the recording itself does not need one.
    }

    startTimer(stop);
    const teardown = () => {
      stopTimer();
      cancelAnimationFrame(frame);
      setLevel(null);
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
      void send(blob, blob.type, asWav);
    };
    recorderRef.current = recorder;
    recorder.start();
    setState("recording");
  }, [send, setLevel, startNative, startTimer, stop, stopTimer]);

  // Leaving the page or closing the editor mid-take drops it.
  useEffect(
    () => () => {
      discardRef.current = true;
      activeRef.current = false;
      if (nativeLiveRef.current) {
        nativeLiveRef.current = false;
        void nativeDictation()?.cancel().catch(() => {});
      }
      if (recorderRef.current?.state === "recording") {
        recorderRef.current.stop();
      }
      teardownRef.current?.();
      window.clearInterval(timerRef.current);
      abortRef.current?.abort();
    },
    [],
  );

  const busy = state === "starting" || state === "recording";
  return {
    state,
    hint,
    elapsed,
    partial,
    progress,
    busy,
    engine,
    available: engine !== "none",
    start,
    stop,
    cancel,
    meterRef,
    clearHint: () => setHint(""),
  };
}

function hasNativeDictation(): boolean {
  return nativeDictation() !== null;
}
function noNativeOnServer(): boolean {
  return false;
}

function errorText(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return typeof error === "string" && error ? error : fallback;
}

// The recording decoded and resampled to 16 kHz mono by Web Audio, for the
// built-in engine, which reads plain samples and has no decoder of its own.
async function toSpeechSamples(blob: Blob): Promise<Float32Array> {
  const Offline = window.OfflineAudioContext;
  if (!Offline) {
    throw new Error("This browser cannot prepare audio for the built-in speech engine.");
  }
  const context = new Offline(1, SPEECH_SAMPLE_RATE, SPEECH_SAMPLE_RATE);
  const decoded = await context.decodeAudioData(await blob.arrayBuffer());
  if (decoded.numberOfChannels === 1) {
    return decoded.getChannelData(0);
  }
  const mixed = new Float32Array(decoded.length);
  for (let channel = 0; channel < decoded.numberOfChannels; channel += 1) {
    const data = decoded.getChannelData(channel);
    for (let index = 0; index < data.length; index += 1) {
      mixed[index] += data[index] / decoded.numberOfChannels;
    }
  }
  return mixed;
}
