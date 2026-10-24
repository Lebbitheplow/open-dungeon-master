"use client";

import { RotateCcw } from "lucide-react";
import { useId } from "react";
import { ui } from "@/lib/ui";
import { undoMessage, type BuildUndo } from "./buildUndo";

// "Put it back" (backlog F12): shown on the step where a class, race,
// subclass or level change set picks aside, until another pick or leaving
// the step ends it. It takes no focus when it appears; the builder's live
// region says it (CharacterBuilder.tsx), and it is the next stop for Tab
// after the step's own heading.
export function UndoChangeBar({ undo, onPutBack }: { undo: BuildUndo; onPutBack: () => void }) {
  const textId = useId();
  return (
    <div
      data-build-undo=""
      className="reveal mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-sky-500/30 bg-sky-950/20 px-3 py-2 text-xs text-sky-100"
    >
      <span id={textId} className="min-w-0 flex-1">
        {undoMessage(undo)}
      </span>
      <button type="button" onClick={onPutBack} aria-describedby={textId} className={ui.btnSmall}>
        <RotateCcw className="size-3.5" aria-hidden="true" />
        Put it back
      </button>
    </div>
  );
}
