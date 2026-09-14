"use client";

import { Hand } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/cn";

// The X-card's two faces (docs/vtt-parity-implementation-plan.md 9.1).
// Every player sees a calm gold scrim, "The table is taking a breath",
// with nobody named. The seat that runs the story sees the same words and
// three ways on: rewind the last passage, write it again around the
// subject, or continue.

export function SafetyPause({
  campaignId,
  paused,
  steersStory,
}: {
  campaignId: string;
  paused: boolean;
  steersStory: boolean;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  if (!paused) {
    return null;
  }
  async function resume(action: "continue" | "rewind" | "reroll") {
    setBusy(action);
    try {
      await fetch(`/api/campaigns/${campaignId}/safety/resume`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
    } finally {
      setBusy(null);
    }
  }
  return (
    <div className="fixed inset-0 z-[52] flex items-center justify-center p-6" role="alertdialog" aria-label="The table is taking a breath">
      <div className="handout-scrim-in absolute inset-0 bg-[radial-gradient(circle_at_50%_40%,rgba(212,171,58,0.18),rgba(12,10,9,0.9))]" />
      <div className="handout-in relative max-w-md rounded-xl border border-amber-700/60 bg-stone-950/95 p-5 text-center shadow-elev-2">
        <Hand className="mx-auto mb-2 size-8 text-amber-300" />
        <h2 className="font-display text-xl text-amber-50">The table is taking a breath</h2>
        <p className="mt-1 text-sm text-stone-400">
          {steersStory
            ? "Someone raised the X-card. Nothing is said about who or why. Choose how to go on."
            : "Someone raised the X-card. Nothing more needs saying. The story waits."}
        </p>
        {steersStory ? (
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            {(
              [
                ["rewind", "Withdraw the last passage"],
                ["reroll", "Write it again, elsewhere"],
                ["continue", "Continue"],
              ] as const
            ).map(([action, label]) => (
              <button
                key={action}
                type="button"
                disabled={busy !== null}
                onClick={() => void resume(action)}
                className={cn(
                  "rounded-md border px-3 py-1.5 text-xs",
                  action === "continue" ? "border-amber-700 bg-amber-950/50 text-amber-100" : "border-stone-700 text-stone-300 hover:bg-stone-900",
                  busy === action && "opacity-60",
                )}
              >
                {label}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
