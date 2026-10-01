"use client";

import { Zap } from "lucide-react";
import type { CSSProperties } from "react";
import { cn } from "@/lib/cn";
import { Tooltip } from "@/components/ui/Tooltip";
import type { HandCard } from "@/lib/battlemap/hand";

// The reaction prompt: an attack the engine recorded against this player's
// character (or an ally, for Cutting Words and Protection) that a reaction
// may still answer, with a chip for each reaction they hold. A chip raises
// its card into the aim bar like any other; the send is the aim bar's. The
// strip arrives with the hand's own file-in and each chip pops in after the
// last (hand-motion.css), and it leaves when the engine's record goes stale.
export function HandReactPrompt({
  cards,
  pickedId,
  onPick,
}: {
  cards: HandCard[];
  pickedId: string | null;
  onPick: (card: HandCard) => void;
}) {
  if (!cards.length) return null;
  // One line per attack answered: the reason is the same for its reactions.
  const prompt = cards[0].prompt ?? "";
  return (
    <div className="hand-react mt-1.5 flex flex-wrap items-center gap-1.5 rounded-xl border border-sky-500/35 bg-sky-950/40 px-2.5 py-1.5" role="group" aria-label="Reactions">
      <span className="hand-react-title flex min-w-0 items-center gap-1.5 text-xs text-sky-100">
        <Zap className="size-3.5 shrink-0 text-sky-300" aria-hidden="true" />
        <span className="truncate">{prompt}. React?</span>
      </span>
      <span className="ml-auto flex flex-wrap gap-1.5">
        {cards.map((card, index) => {
          const chip = (
            <button
              key={card.id}
              type="button"
              style={{ "--i": index } as CSSProperties}
              aria-pressed={pickedId === card.id}
              aria-disabled={card.disabled ? "true" : undefined}
              onClick={() => onPick(card)}
              className={cn(
                "hand-react-chip inline-flex min-h-9 items-center gap-1 rounded-full border px-3 text-xs sm:min-h-8",
                card.disabled
                  ? "border-stone-700/60 text-stone-500 opacity-60"
                  : "border-sky-400/60 bg-sky-500/15 text-sky-50 hover:border-sky-300",
              )}
            >
              {card.name}
              {card.resource ? <span className="font-mono text-[10px] text-sky-300/80">{card.resource}</span> : null}
            </button>
          );
          return card.disabled || card.rules ? (
            <Tooltip key={card.id} content={card.disabled ?? card.rules}>
              {chip}
            </Tooltip>
          ) : (
            chip
          );
        })}
      </span>
    </div>
  );
}
