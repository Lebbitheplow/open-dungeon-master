"use client";

import type { CSSProperties } from "react";
import { GameIcon } from "@/components/ui/GameIcon";
import { Sheet } from "@/components/ui/Sheet";
import { cn } from "@/lib/cn";
import type { HandCard } from "@/lib/battlemap/hand";
import { costLabel, previewRows, type HandAim } from "@/lib/battlemap/hand-play";
import { HandPreviewRows, typeLabel } from "@/app/campaigns/[campaignId]/HandCardFace";

// The cards past the ninth (docs/visual-overhaul-plan.md 5.2): the same
// order as the hand, as rows, because a sheet is for finding one by name.
//
// Each row is the whole card, not its title: range, what it does, and what
// it would do to the enemy in front of you, the same lines a card in the fan
// shows on its face and its hover. Off your turn that is the point of the
// sheet (issue 96): the header says to look your cards over while you wait,
// so they are laid out to be read, and the reason none can be played is said
// once above them rather than in place of every card's own words.
export function HandMoreSheet({
  open,
  onOpenChange,
  cards,
  onPick,
  waitingNote,
  isWaiting,
  aim,
  conditions,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cards: HandCard[];
  onPick: (card: HandCard) => void;
  // Why nothing can be played right now, when that is one reason for the
  // whole hand (somebody else's turn, initiative still being rolled); null
  // otherwise. `isWaiting` says whether that is all that holds a card.
  waitingNote: string | null;
  isWaiting: (card: HandCard) => boolean;
  // Who the odds are worked against, and the conditions on the character
  // holding the hand: what the fan's hover previews use.
  aim: HandAim | null;
  conditions: string[];
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="The rest of your hand">
      {waitingNote ? (
        <p role="status" className="reveal mb-3 rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-sm text-amber-100/90">
          {waitingNote} Read them over and plan your turn in the meantime.
        </p>
      ) : (
        <p className="mb-3 text-sm text-stone-400">Pick one and it takes a seat in your hand, ready to aim.</p>
      )}
      <ul className="-mx-1 flex min-h-0 flex-col gap-1.5 overflow-y-auto px-1 pb-1">
        {cards.map((card, index) => {
          // Held only by the turn: readable at full strength, and its own
          // line is not spent repeating what the note above already said.
          const waiting = isWaiting(card);
          const rows = previewRows(card, card.intent.card === "reaction" ? null : aim, conditions);
          const facts = [card.dice, card.roll, card.range].filter(Boolean).join(" · ");
          return (
            <li key={card.id} className="hand-more-row" style={{ "--i": index } as CSSProperties}>
              <button
                type="button"
                onClick={() => onPick(card)}
                aria-disabled={card.disabled ? "true" : undefined}
                className={cn(
                  "motion-press flex min-h-14 w-full items-start gap-3 rounded-xl border border-stone-700/60 bg-stone-900/50 px-3 py-2 text-left hover:border-amber-500/40",
                  card.disabled && !waiting && "opacity-60",
                )}
              >
                <GameIcon icon={card.icon} size="size-10" className="mt-0.5" />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-2">
                    <span className="truncate font-display text-sm font-semibold text-stone-100">{card.name}</span>
                    <span className="shrink-0 text-[10px] uppercase tracking-wider text-stone-500">{typeLabel(card.type)}</span>
                    <span className="ml-auto shrink-0 text-right font-mono text-[10px] uppercase tracking-wider text-amber-200/90">
                      {costLabel(card.cost)}
                    </span>
                  </span>
                  {facts ? <span className="block font-mono text-[11px] text-stone-400">{facts}</span> : null}
                  {card.rules ? <span className="mt-1 block text-xs leading-snug text-stone-300">{card.rules}</span> : null}
                  {card.resource || card.condition ? (
                    <span className="mt-0.5 block text-[11px] text-stone-500">
                      {[card.resource, card.condition].filter(Boolean).join(" · ")}
                    </span>
                  ) : null}
                  {rows.length ? (
                    <span className="hand-rows-box mt-1.5 block">
                      <HandPreviewRows rows={rows} />
                    </span>
                  ) : null}
                  {card.disabled && !waiting ? <span className="mt-1 block text-xs text-amber-300/90">{card.disabled}</span> : null}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </Sheet>
  );
}
