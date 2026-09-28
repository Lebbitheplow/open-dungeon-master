"use client";

import { Loader2, Mic } from "lucide-react";
import { cn } from "@/lib/cn";
import { useDictation } from "@/lib/use-dictation";
import { ui } from "@/lib/ui";

// Hold-to-record push-to-talk. On release the clip goes to /api/stt and the
// transcript lands in the composer for the player to confirm and send
// (never auto-submits; friends are usually talking in one room). The
// recording itself is useDictation's, shared with the DM's dictation button.
export function PushToTalk({
  disabled,
  onTranscript,
}: {
  disabled: boolean;
  onTranscript: (text: string) => void;
}) {
  const { state: rawState, hint, start, stop } = useDictation({ onTranscript });
  const state = rawState === "starting" ? "idle" : rawState;

  return (
    <div className="relative self-end">
      <button
        type="button"
        disabled={disabled || state === "transcribing"}
        onPointerDown={(event) => {
          event.preventDefault();
          if (!disabled) {
            void start();
          }
        }}
        onPointerUp={stop}
        onPointerLeave={stop}
        onContextMenu={(event) => event.preventDefault()}
        title="Hold to talk"
        aria-label="Hold to talk"
        data-tour="composer-talk"
        // The kit's secondary button without its magnet: a button that follows
        // the pointer would slide out from under a held finger and end the take.
        className={cn(
          ui.btnSecondary.replace("motion-magnet", "motion-press"),
          "session-deskbtn select-none touch-none",
          state === "recording" && "border-red-600/80 bg-red-950/80 text-red-200 shadow-[0_0_16px_rgba(220,38,38,0.35)]",
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
        <p className="reveal-pop absolute bottom-full right-0 mb-1 w-64 rounded bg-stone-900 px-2 py-1 text-xs text-red-400 shadow">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
