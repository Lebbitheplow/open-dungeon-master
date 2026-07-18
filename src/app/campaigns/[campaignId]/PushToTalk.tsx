"use client";

import { Loader2, Mic } from "lucide-react";
import { useRef, useState } from "react";
import { cn } from "@/lib/cn";

type PttState = "idle" | "recording" | "transcribing" | "error";

// Hold-to-record push-to-talk. On release the clip goes to /api/stt and the
// transcript lands in the composer for the player to confirm and send
// (never auto-submits; friends are usually talking in one room).
export function PushToTalk({
  disabled,
  onTranscript,
}: {
  disabled: boolean;
  onTranscript: (text: string) => void;
}) {
  const [state, setState] = useState<PttState>("idle");
  const [hint, setHint] = useState("");
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const activeRef = useRef(false);

  async function start() {
    if (disabled || activeRef.current) {
      return;
    }
    activeRef.current = true;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Released while the permission prompt was up: bail out cleanly.
      if (!activeRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm";
      const recorder = new MediaRecorder(stream, { mimeType });
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size) {
          chunksRef.current.push(event.data);
        }
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        const blob = new Blob(chunksRef.current, { type: mimeType });
        if (blob.size < 2_000) {
          setState("idle");
          return;
        }
        setState("transcribing");
        try {
          const form = new FormData();
          form.set("audio", blob, "speech.webm");
          const response = await fetch("/api/stt", { method: "POST", body: form });
          const data = await response.json().catch(() => ({}));
          if (!response.ok) {
            setHint(data.error || "Transcription failed.");
            setState("error");
            return;
          }
          if (data.text) {
            onTranscript(data.text);
          }
          setState("idle");
        } catch {
          setHint("Could not reach the server.");
          setState("error");
        }
      };
      recorderRef.current = recorder;
      recorder.start();
      setState("recording");
      setHint("");
    } catch {
      activeRef.current = false;
      setHint("Microphone unavailable. Check browser permissions.");
      setState("error");
    }
  }

  function stop() {
    activeRef.current = false;
    if (recorderRef.current?.state === "recording") {
      recorderRef.current.stop();
    }
  }

  return (
    <div className="relative self-end">
      <button
        type="button"
        disabled={disabled || state === "transcribing"}
        onPointerDown={(event) => {
          event.preventDefault();
          start();
        }}
        onPointerUp={stop}
        onPointerLeave={stop}
        onContextMenu={(event) => event.preventDefault()}
        title="Hold to talk"
        className={cn(
          "rounded-md border p-2.5 transition-colors select-none touch-none",
          state === "recording"
            ? "border-red-700 bg-red-950 text-red-300"
            : "border-stone-700 text-stone-300 hover:bg-stone-900",
          (disabled || state === "transcribing") && "opacity-40",
        )}
      >
        {state === "transcribing" ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Mic className={cn("size-4", state === "recording" && "animate-pulse")} />
        )}
      </button>
      {state === "error" && hint ? (
        <p className="absolute bottom-full right-0 mb-1 w-52 rounded bg-stone-900 px-2 py-1 text-xs text-red-400 shadow">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
