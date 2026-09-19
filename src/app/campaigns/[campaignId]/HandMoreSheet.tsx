"use client";

import type { CSSProperties } from "react";
import { GameIcon } from "@/components/ui/GameIcon";
import { Sheet } from "@/components/ui/Sheet";
import { cn } from "@/lib/cn";
import type { HandCard } from "@/lib/battlemap/hand";
import { costLabel } from "@/lib/battlemap/hand-play";
import { typeLabel } from "@/app/campaigns/[campaignId]/HandCardFace";

// The cards past the ninth (docs/visual-overhaul-plan.md 5.2): the same
// order as the hand, as rows, because a sheet is for finding one by name.
export function HandMoreSheet({
  open,
  onOpenChange,
  cards,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cards: HandCard[];
  onPick: (card: HandCard) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="The rest of your hand">
      <p className="mb-3 text-sm text-stone-400">Pick one and it takes a seat in your hand, ready to aim.</p>
      <ul className="-mx-1 flex min-h-0 flex-col gap-1.5 overflow-y-auto px-1 pb-1">
        {cards.map((card, index) => (
          <li key={card.id} className="hand-more-row" style={{ "--i": index } as CSSProperties}>
            <button
              type="button"
              onClick={() => onPick(card)}
              aria-disabled={card.disabled ? "true" : undefined}
              className={cn(
                "motion-press flex min-h-14 w-full items-center gap-3 rounded-xl border border-stone-700/60 bg-stone-900/50 px-3 py-2 text-left hover:border-amber-500/40",
                card.disabled && "opacity-50",
              )}
            >
              <GameIcon icon={card.icon} size="size-10" />
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-2">
                  <span className="truncate font-display text-sm font-semibold text-stone-100">{card.name}</span>
                  <span className="shrink-0 text-[10px] uppercase tracking-wider text-stone-500">{typeLabel(card.type)}</span>
                </span>
                <span className="block truncate font-mono text-[11px] text-stone-400">
                  {[card.dice, card.roll].filter(Boolean).join(" · ")}
                </span>
                {card.disabled ? <span className="block text-xs text-amber-300/90">{card.disabled}</span> : null}
              </span>
              <span className="shrink-0 text-right font-mono text-[10px] uppercase tracking-wider text-amber-200/90">
                {costLabel(card.cost)}
                {card.resource ? <span className="block normal-case tracking-normal text-stone-500">{card.resource}</span> : null}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}
