"use client";

import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { GameIcon } from "@/components/ui/GameIcon";
import { cardArtwork } from "@/lib/battlemap/card-art";
import { Sheet } from "@/components/ui/Sheet";
import { cn } from "@/lib/cn";
import type { HandCard } from "@/lib/battlemap/hand";
import {
  GROUP_SEARCH_OVER,
  NO_FILTER,
  filterCards,
  filterChips,
  filtering,
  isGroup,
  type HandFilter,
  type HandUnit,
} from "@/lib/battlemap/hand-groups";
import { costLabel, previewRows, type HandAim } from "@/lib/battlemap/hand-play";
import { HandPreviewRows, typeLabel } from "@/app/campaigns/[campaignId]/HandCardFace";
import { HandFindTools } from "@/app/campaigns/[campaignId]/HandGroups";

// The cards past the ninth (docs/visual-overhaul-plan.md 5.2): the same
// order as the hand, as rows, because a sheet is for finding one by name.
// A group waiting here (issue 528) is laid out as its own section, a spell
// level each with the slots it has left, and once the sheet holds more than
// a dozen cards it gains the group's chips and search box.
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
  units,
  onPick,
  waitingNote,
  isWaiting,
  aim,
  conditions,
  arranging,
  onArrange,
  arrange,
  displaced,
  urgent,
  fresh,
  freshIds,
  genre,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // What waits behind the spine: cards, and groups of them.
  units: HandUnit[];
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
  // Customize Hand (issue 231): the arrange view in place of the list.
  arranging: boolean;
  onArrange: (on: boolean) => void;
  arrange: ReactNode;
  // Chosen cards an urgent one has pushed here for now, the urgent cards
  // that did it, and what was gained since the hand was arranged.
  displaced: HandUnit[];
  urgent: HandCard[];
  fresh: HandUnit[];
  freshIds: Set<string>;
  genre?: string | null;
}) {
  const [filter, setFilter] = useState<HandFilter>(NO_FILTER);
  const all = useMemo(() => units.flatMap((unit) => (isGroup(unit) ? unit.cards : [unit])), [units]);
  const chips = useMemo(() => (all.length > GROUP_SEARCH_OVER ? filterChips(all) : []), [all]);
  const searching = filtering(filter);
  const found = searching ? filterCards(all, filter) : [];
  const isNew = (card: HandCard) => freshIds.has(card.id) || fresh.includes(card);

  let index = 0;
  const row = (card: HandCard) => (
    <MoreRow
      genre={genre}
      key={card.id}
      card={card}
      index={index++}
      waiting={isWaiting(card)}
      fresh={isNew(card)}
      aim={aim}
      conditions={conditions}
      onPick={onPick}
    />
  );
  const loose = units.filter((unit): unit is HandCard => !isGroup(unit));
  const groups = units.filter(isGroup);

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        // A search is for this look; the sheet opens on the whole list.
        if (!next) setFilter(NO_FILTER);
        onOpenChange(next);
      }}
      title={arranging ? "Customize your hand" : "The rest of your hand"}
    >
      {arranging ? (
        arrange
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-stone-400">Choose which cards stay in your hand, for this character.</span>
            <button type="button" onClick={() => onArrange(true)} className="hand-arrange-move motion-press">
              Customize Hand
            </button>
          </div>
          {displaced.length ? (
            <p role="status" className="reveal mb-3 rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-sm text-amber-100/90">
              {urgent.map((card) => card.name).join(" and ")} took a seat for now; {displaced.map((card) => card.name).join(", ")}{" "}
              {displaced.length === 1 ? "waits" : "wait"} here until {urgent.length === 1 ? "it is" : "they are"} no longer needed. Your arrangement is kept.
            </p>
          ) : null}
          {waitingNote ? (
            <p role="status" className="reveal mb-3 rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-sm text-amber-100/90">
              {waitingNote} Read them over and plan your turn in the meantime.
            </p>
          ) : (
            <p className="mb-3 text-sm text-stone-400">Pick one and it takes a seat in your hand, ready to aim.</p>
          )}
          <HandFindTools
            chips={chips}
            filter={filter}
            onFilter={setFilter}
            search={all.length > GROUP_SEARCH_OVER}
            label="your cards"
            className="mb-3"
          />
          {searching ? (
            <>
              <p role="status" className="mb-2 text-xs text-stone-400">
                {found.length ? `${found.length} of ${all.length} cards` : "No card matches."}
              </p>
              <ul className="-mx-1 flex min-h-0 flex-col gap-1.5 px-1 pb-1">{found.map(row)}</ul>
            </>
          ) : (
            <div className="-mx-1 flex min-h-0 flex-col gap-4 px-1 pb-1">
              {loose.length ? <ul className="flex flex-col gap-1.5">{loose.map(row)}</ul> : null}
              {groups.map((group) => (
                <section key={group.id} className="hand-more-group" aria-label={group.name}>
                  <h3 className="hand-more-head">
                    <span className="font-display">{group.name}</span>
                    {group.left ? <span className="hand-more-left">{group.left}</span> : null}
                  </h3>
                  {group.sections.map((section) => (
                    <div key={section.id} className="mt-1.5">
                      {group.sections.length > 1 ? (
                        <h4 className="hand-more-section">
                          {section.label}
                          {section.note ? <span className="hand-more-left"> · {section.note}</span> : null}
                        </h4>
                      ) : null}
                      <ul className="flex flex-col gap-1.5">{section.cards.map(row)}</ul>
                    </div>
                  ))}
                </section>
              ))}
            </div>
          )}
        </>
      )}
    </Sheet>
  );
}

function MoreRow({
  genre,
  card,
  index,
  waiting,
  fresh,
  aim,
  conditions,
  onPick,
}: {
  card: HandCard;
  index: number;
  // Held only by the turn: readable at full strength, and its own line is
  // not spent repeating what the note above already said.
  waiting: boolean;
  fresh: boolean;
  genre?: string | null;
  aim: HandAim | null;
  conditions: string[];
  onPick: (card: HandCard) => void;
}) {
  const artwork = cardArtwork(card.icon, genre);
  const rows = previewRows(card, card.intent.card === "reaction" ? null : aim, conditions);
  const facts = [card.dice, card.roll, card.range].filter(Boolean).join(" · ");
  return (
    <li className="hand-more-row" style={{ "--i": index } as CSSProperties}>
      <button
        type="button"
        onClick={() => onPick(card)}
        aria-disabled={card.disabled ? "true" : undefined}
        className={cn(
          "motion-press flex min-h-14 w-full items-start gap-3 rounded-xl border border-stone-700/60 bg-stone-900/50 px-3 py-2 text-left hover:border-amber-500/40",
          card.disabled && !waiting && "opacity-60",
        )}
      >
        <GameIcon icon={artwork} size={artwork.kind === "action" ? "h-10 w-20" : "size-10"} className="mt-0.5" />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span className="truncate font-display text-sm font-semibold text-stone-100">{card.name}</span>
            <span className="shrink-0 text-[10px] uppercase tracking-wider text-stone-500">{typeLabel(card.type)}</span>
            {fresh ? (
              <span className="shrink-0 rounded-full border border-emerald-400/50 bg-emerald-400/10 px-1.5 py-px text-[10px] uppercase tracking-wider text-emerald-200">
                New
              </span>
            ) : null}
            <span className="hand-cost ml-auto shrink-0" data-cost={card.cost}>
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
}
