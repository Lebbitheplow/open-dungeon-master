"use client";

import { Loader2, RotateCcw, Undo2 } from "lucide-react";
import { useState } from "react";
import { askConcentrationSwap, isConcentrationQuestion } from "@/components/concentration-prompt";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import type { CampaignMessage } from "@/lib/db/messages";
import type { ConcentrationSwap } from "@/lib/dm/concentration-confirm-logic";

// A card the GM never carried out went back to its player (issue 570,
// src/lib/dm/turn.ts giveCardsBack): its line says so, with why, instead of
// the story telling it as done. Nothing was spent, so the Hand deals the
// card again; its player can also play it again from here in one press,
// with the same sentence and the same choices.
export function CardReturnedNote({ message, mine, name }: { message: CampaignMessage; mine: boolean; name: string }) {
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState("");

  const playAgain = async () => {
    if (state !== "idle" || !message.intent) return;
    setState("sending");
    setError("");
    const post = (concentrationAck?: ConcentrationSwap) =>
      fetch(`/api/campaigns/${message.campaignId}/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: message.content,
          kind: "do",
          characterId: message.characterId ?? undefined,
          intent: message.intent,
          ...(concentrationAck ? { concentrationAck } : {}),
        }),
      });
    try {
      let response = await post();
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        // A cast that ends the spell held now is asked about, as in the Hand.
        const ack = isConcentrationQuestion(response.status, data) ? await askConcentrationSwap(data) : null;
        if (!ack) {
          setError(isConcentrationQuestion(response.status, data) ? "Kept your spell; nothing was spent." : data.error || "Could not play it again.");
          setState("idle");
          return;
        }
        response = await post(ack);
        if (!response.ok) {
          const again = (await response.json().catch(() => ({}))) as { error?: string };
          setError(again.error || "Could not play it again.");
          setState("idle");
          return;
        }
      }
      setState("sent");
    } catch {
      setError("Could not reach the table.");
      setState("idle");
    }
  };

  return (
    <div className="card-returned motion-pop mt-1 flex flex-col items-end gap-1 text-right text-xs" role="status">
      <p className="inline-flex items-start gap-1.5 text-amber-200/90">
        <Undo2 className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        <span>
          {mine ? "This did not happen. It is back in your hand." : `This did not happen. It went back to ${name}'s hand.`}
          {message.cardReturned ? <span className="block text-stone-400">{message.cardReturned}</span> : null}
        </span>
      </p>
      {mine && message.intent ? (
        state === "sent" ? (
          <span className="motion-pop text-stone-400">Played again.</span>
        ) : (
          <button
            type="button"
            onClick={() => void playAgain()}
            disabled={state === "sending"}
            className={cn(ui.btnSmall, "motion-press min-h-10 sm:min-h-8")}
          >
            {state === "sending" ? <Loader2 className="size-3.5 animate-spin" /> : <RotateCcw className="size-3.5" />} Play it again
          </button>
        )
      ) : null}
      {error ? <span className="text-red-300">{error}</span> : null}
    </div>
  );
}
