"use client";

import { Check, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

// Inline narration editor, ported from NE-P's InlineMessageEditor
// (src/components/message/InlineMessageEditor.tsx, MIT, Copyright (c) 2026
// Sagesheep): autofocus and auto-grow on mount, Enter saves, Escape cancels,
// with a small toolbar mirroring both for anyone not reaching for the keys.
//
// Shift+Enter inserts a newline rather than saving, because DM narration is
// multi-paragraph and losing a draft to a stray Enter is the obvious failure.

const MIN_HEIGHT = 160;

function grow(element: HTMLTextAreaElement) {
  element.style.height = "auto";
  element.style.height = `${Math.max(element.scrollHeight, MIN_HEIGHT)}px`;
}

export function InlineMessageEditor({
  initial,
  onSave,
  onCancel,
}: {
  initial: string;
  onSave: (content: string) => Promise<string | null>;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const [draft, setDraft] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const element = ref.current;
    if (!element) {
      return;
    }
    element.focus();
    // Deferred a frame so the textarea has its final width before
    // scrollHeight is measured, otherwise it opens at the wrong height.
    const raf = requestAnimationFrame(() => grow(element));
    return () => cancelAnimationFrame(raf);
  }, []);

  async function save() {
    if (busy) {
      return;
    }
    setBusy(true);
    // The server owns the roll-marker rule; whatever it refuses is shown here
    // rather than guessed at in the client.
    const failure = await onSave(draft);
    setBusy(false);
    if (failure) {
      setError(failure);
    }
  }

  return (
    <div className="space-y-1.5">
      <textarea
        ref={ref}
        value={draft}
        disabled={busy}
        onChange={(event) => {
          setDraft(event.target.value);
          setError("");
          grow(event.currentTarget);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            void save();
          } else if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
          }
        }}
        className="w-full resize-none rounded-lg border border-stone-700 bg-stone-950/60 p-3 font-serif text-base leading-relaxed text-stone-100 outline-none focus:border-amber-600/60 disabled:opacity-60"
      />
      {error ? <p className="text-xs text-red-400">{error}</p> : null}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => void save()}
          disabled={busy}
          className="flex items-center gap-1 rounded-md bg-amber-600/80 px-2.5 py-1 text-xs text-white hover:bg-amber-600 disabled:opacity-50"
        >
          <Check className="size-3" /> Save
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="flex items-center gap-1 rounded-md border border-stone-700 px-2.5 py-1 text-xs text-stone-400 hover:text-stone-200 disabled:opacity-50"
        >
          <X className="size-3" /> Cancel
        </button>
        <span className="text-[10px] text-stone-600">
          Enter saves, Shift+Enter for a new line, Escape cancels. Keep the dice markers.
        </span>
      </div>
    </div>
  );
}
