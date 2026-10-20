"use client";

import { Sparkles } from "lucide-react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import type { BlockerTarget } from "./submit";
import type { FillReadback } from "./useQuickFill";

// What a quick-build fill wrote, said once (the status line is announced),
// each pick marked "Picked for you" with a way to the block where it is
// changed by hand, and one Undo that puts the whole fill back.
export function QuickBuildReadback({
  readback,
  stillOwed,
  onChange,
  onUndo,
  onDismiss,
}: {
  readback: FillReadback;
  // What the fill could not pick (a spell list that ran out): the steps'
  // own "choices left" lines still name it.
  stillOwed: number;
  onChange: (target: BlockerTarget) => void;
  onUndo: () => void;
  onDismiss: () => void;
}) {
  const count = readback.filled.length;
  const lead =
    readback.from === "quiz"
      ? `Here is your character. ${count} choices were picked for you`
      : `Picked for you: ${count} ${count === 1 ? "choice" : "choices"}`;
  return (
    <section
      aria-label="Picked for you"
      data-quick-readback=""
      className="reveal mb-3 shrink-0 rounded-lg border border-sky-500/30 bg-sky-950/20 px-3 py-2 text-xs text-stone-300"
    >
      <p role="status" className="mb-1.5 text-sky-100">
        <Sparkles className="mr-1 inline size-3.5 text-sky-300" aria-hidden="true" />
        {lead}. Nothing you had chosen was changed. Change any of them, or undo them all. Undo leaves any you have
        changed since.
        {stillOwed ? ` ${stillOwed === 1 ? "One choice is" : `${stillOwed} choices are`} still yours to make.` : ""}
      </p>
      <ul className="max-h-40 space-y-1 overflow-y-auto pr-1">
        {readback.filled.map((pick, index) => (
          <li key={`${pick.target}-${index}`} className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="shrink-0 rounded-full border border-sky-400/40 bg-sky-400/10 px-1.5 py-0.5 text-[10px] text-sky-200">
              Picked for you
            </span>
            <span className="min-w-0 flex-1">
              <span className="text-stone-500">{pick.label}:</span> {pick.value}
            </span>
            <button
              type="button"
              onClick={() => onChange(pick.target)}
              aria-label={`Change ${pick.label.toLowerCase()}`}
              className="text-amber-300 underline-offset-2 hover:underline"
            >
              Change
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" onClick={onUndo} className={ui.btnSmall} data-quick-undo="">
          Undo all of these
        </button>
        <button type="button" onClick={onDismiss} className={cn(ui.btnSmall, "text-stone-400")}>
          Keep them
        </button>
      </div>
    </section>
  );
}
