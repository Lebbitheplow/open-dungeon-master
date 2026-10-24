"use client";

import { RotateCcw } from "lucide-react";
import { useId } from "react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { undoMessage, type BuildUndo } from "./buildUndo";

// "Put it back" (backlog F12): shown on the step where a class, race,
// subclass or level change set picks aside, until another pick or leaving
// the step ends it. It takes no focus when it appears; the builder's live
// region says it (CharacterBuilder.tsx), and it is the next stop for Tab
// after the step's own heading. Amber and stone, which the day theme turns
// to ink on cream, as the builder's other notices are, and the button is a
// finger's width on a phone (pk-tap).
export function UndoChangeBar({ undo, onPutBack }: { undo: BuildUndo; onPutBack: () => void }) {
  const textId = useId();
  return (
    <div
      data-build-undo=""
      className="reveal mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-950/20 px-3 py-2 text-xs text-amber-100"
    >
      <span id={textId} className="min-w-0 flex-1">
        {undoMessage(undo)}
      </span>
      <button type="button" onClick={onPutBack} aria-describedby={textId} className={cn(ui.btnSmall, "pk-tap")}>
        <RotateCcw className="size-3.5" aria-hidden="true" />
        Put it back
      </button>
    </div>
  );
}
