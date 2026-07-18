"use client";

import { UserPlus, X } from "lucide-react";
import { useState } from "react";

// Lead-only banner after a mid-game joiner creates their character: write
// the introduction as a Direct, or let the DM improvise one now.
export function NewAdventurerBanner({
  campaignId,
  text,
  onWriteIntro,
  onDismiss,
}: {
  campaignId: string;
  text: string;
  onWriteIntro: () => void;
  onDismiss: () => void;
}) {
  const [sending, setSending] = useState(false);

  async function letDmIntroduce() {
    if (sending) {
      return;
    }
    setSending(true);
    try {
      await fetch(`/api/campaigns/${campaignId}/lead-note`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: "Introduce the newly joined character into the scene now.",
        }),
      });
      onDismiss();
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="mb-2 flex items-center justify-between gap-3 rounded-md border border-amber-900/60 bg-amber-950/30 px-3 py-2 text-xs">
      <span className="flex min-w-0 items-center gap-1.5 text-amber-200">
        <UserPlus className="size-3.5 shrink-0" />
        <span className="truncate">{text}</span>
      </span>
      <span className="flex shrink-0 items-center gap-2.5">
        <button
          type="button"
          onClick={onWriteIntro}
          className="text-amber-200 hover:text-amber-300"
        >
          Write intro
        </button>
        <button
          type="button"
          onClick={letDmIntroduce}
          disabled={sending}
          className="text-amber-200 hover:text-amber-300 disabled:opacity-50"
        >
          Let the DM do it
        </button>
        <button
          type="button"
          onClick={onDismiss}
          title="Dismiss"
          className="text-stone-500 hover:text-stone-300"
        >
          <X className="size-3.5" />
        </button>
      </span>
    </div>
  );
}
