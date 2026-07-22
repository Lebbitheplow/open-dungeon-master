"use client";

import { Loader2, Play, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { Tooltip } from "@/components/ui/Tooltip";

// Plays a short sample of a narrator voice next to the voice pickers. The
// first play for a voice waits on Kokoro rendering it (about a second); after
// that the clip is cached server-side and starts immediately.
export function VoicePreviewButton({ voice, className }: { voice: string; className?: string }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [loading, setLoading] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);

  function stop() {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
    }
    setPlaying(false);
    setLoading(false);
  }

  // Switching voices (or unmounting) must not leave the old clip talking.
  useEffect(() => stop, [voice]);

  async function toggle() {
    if (playing || loading) {
      stop();
      return;
    }
    setFailed(false);
    setLoading(true);
    // Built and configured before it reaches the ref: the clip element is
    // never mutated after the component holds on to it.
    const audio = new Audio(`/api/tts/preview?voice=${encodeURIComponent(voice)}`);
    audio.onended = () => setPlaying(false);
    audioRef.current = audio;
    try {
      await audio.play();
      setPlaying(true);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }

  const Icon = loading ? Loader2 : playing ? Square : Play;
  return (
    <Tooltip content={failed ? "Voice preview unavailable." : "Hear a sample of this voice"}>
      <button
        type="button"
        onClick={toggle}
        aria-label="Preview this voice"
        className={cn(ui.btnSmall, "shrink-0 px-2", failed && "border-red-800/70", className)}
      >
        <Icon className={cn("size-4", loading && "animate-spin")} />
      </button>
    </Tooltip>
  );
}
