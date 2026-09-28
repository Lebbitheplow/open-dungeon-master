"use client";

import { Loader2, Mic, Square, X } from "lucide-react";
import { useRef, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { DICTATION_MAX_MS, DICTATION_WARN_MS, formatElapsed } from "@/lib/dictation";
import { useDictation } from "@/lib/use-dictation";

// A field you can speak into. Wraps one textarea (or a one-line input with
// `single`) and pins a microphone in its corner: tap to start, talk for as
// long as the summary takes, tap again to finish. The words are written down
// by the server's Whisper service and added to the end of what is already
// in the field, for the writer to read over and save as usual. Nothing is
// saved or sent on its own.
//
// The wrapper is always rendered so the field never remounts; only the
// button waits on the server saying it can listen (or, on a server that
// cannot, on an app shell offering the device's own recognizer).
export function DictateField({
  children,
  onTranscript,
  disabled,
  single,
  className,
  label = "Dictate",
}: {
  children: ReactNode;
  // Called with the words heard. Append them with appendDictation().
  onTranscript: (text: string) => void;
  disabled?: boolean;
  // A one-line input: the mic sits centred on the right instead of low.
  single?: boolean;
  className?: string;
  // What the field is, for the button's accessible name.
  label?: string;
}) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const dictation = useDictation({
    onTranscript: (text) => {
      onTranscript(text);
      settle();
    },
  });
  const { state, hint, elapsed, partial, progress, busy, start, stop, cancel, meterRef, clearHint } = dictation;
  const shown = dictation.available;
  const recording = state === "recording";

  // After the words land: scroll a tall field to its end, where they went,
  // and warm its edge for a beat so the eye finds them.
  function settle() {
    requestAnimationFrame(() => {
      const field = boxRef.current?.querySelector<HTMLTextAreaElement | HTMLInputElement>("textarea, input");
      if (!field) {
        return;
      }
      if (field instanceof HTMLTextAreaElement) {
        field.scrollTop = field.scrollHeight;
      }
      field.animate?.(
        [
          { boxShadow: "0 0 0 3px rgba(212, 171, 58, 0.45)" },
          { boxShadow: "0 0 0 0 rgba(212, 171, 58, 0)" },
        ],
        { duration: 900, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
      );
    });
  }

  function toggle() {
    if (busy) {
      stop();
    } else {
      clearHint();
      void start();
    }
  }

  return (
    <div className={cn("dictate-field", className)}>
      <div ref={boxRef} className={cn("dictate-box relative", shown && "dictate-box-on", single && "dictate-box-single")}>
        {children}
        {shown ? (
          <button
            type="button"
            ref={(element) => {
              meterRef.current = element;
            }}
            onClick={toggle}
            onKeyDown={(event) => {
              if (event.key === "Escape" && busy) {
                event.preventDefault();
                event.stopPropagation();
                cancel();
              }
            }}
            disabled={(disabled && !busy) || state === "transcribing"}
            aria-pressed={recording}
            data-state={state}
            aria-label={recording ? `Finish dictating: ${label}` : `${label}: speak instead of typing`}
            title={recording ? "Tap to finish. The words land in the field." : "Speak instead of typing. Tap to start, tap again to finish."}
            className={cn("dictate-mic", recording && "dictate-mic-live")}
          >
            {state === "transcribing" || state === "starting" ? (
              <Loader2 key="wait" className="reveal-pop size-3.5 animate-spin" />
            ) : recording ? (
              <Square key="stop" className="reveal-pop size-3 fill-current" />
            ) : (
              <Mic key="mic" className="reveal-pop size-3.5" />
            )}
          </button>
        ) : null}
      </div>
      {shown ? (
        <DictateStatus
          state={state}
          hint={hint}
          elapsed={elapsed}
          partial={partial}
          progress={progress}
          onDiscard={cancel}
          onDismiss={clearHint}
        />
      ) : null}
    </div>
  );
}

function DictateStatus({
  state,
  hint,
  elapsed,
  partial,
  progress,
  onDiscard,
  onDismiss,
}: {
  state: string;
  hint: string;
  elapsed: number;
  partial: string;
  progress: { done: number; total: number } | null;
  onDiscard: () => void;
  onDismiss: () => void;
}) {
  if (state === "starting") {
    return (
      <p role="status" className="dictate-status">
        <span className="breathe">Waiting for the microphone...</span>
      </p>
    );
  }
  if (state === "recording") {
    const closing = elapsed >= DICTATION_WARN_MS;
    return (
      <div role="status">
        <p className="dictate-status">
          <span className="dictate-dot" aria-hidden="true" />
          <span className="dictate-time">{formatElapsed(elapsed)}</span>
          <span className={cn("min-w-0 truncate", closing && "dictate-closing")}>
            {closing ? `Stops itself at ${formatElapsed(DICTATION_MAX_MS)}` : "Listening. Tap the square when you are done."}
          </span>
          <button type="button" onClick={onDiscard} className="dictate-discard">
            Discard
          </button>
        </p>
        {/* The device's recognizer shows its words as they come; the tail
            is what matters, so a long take shows its last line. */}
        {partial ? <p className="dictate-partial live-in">{partial.length > 160 ? `...${partial.slice(-160)}` : partial}</p> : null}
      </div>
    );
  }
  if (state === "transcribing") {
    return (
      <p role="status" className="dictate-status">
        <span className="breathe">
          {progress ? `Writing down what you said (part ${Math.min(progress.done + 1, progress.total)} of ${progress.total})...` : "Writing down what you said..."}
        </span>
      </p>
    );
  }
  if (state === "error" && hint) {
    return (
      <p role="alert" className="dictate-status dictate-error">
        <span className="min-w-0 flex-1">{hint}</span>
        <button type="button" onClick={onDismiss} aria-label="Dismiss" className="dictate-discard">
          <X className="size-3" />
        </button>
      </p>
    );
  }
  return null;
}
