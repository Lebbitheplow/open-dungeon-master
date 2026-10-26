"use client";

import { ArrowDown, ArrowUp, ChevronDown } from "lucide-react";
import { useRef, useState, type CSSProperties } from "react";
import { GameIcon } from "@/components/ui/GameIcon";
import { cardArtwork } from "@/lib/battlemap/card-art";
import { cn } from "@/lib/cn";
import type { HandCard } from "@/lib/battlemap/hand";
import {
  END_TURN_ID,
  HAND_SEATS,
  addToHand,
  missingFromHand,
  moveInHand,
  removeFromHand,
  type HandLayout,
} from "@/lib/battlemap/hand-layout";
import { costLabel } from "@/lib/battlemap/hand-play";
import { groupSummary, isGroup, type HandGroup, type HandUnit } from "@/lib/battlemap/hand-groups";
import { replayAnimation } from "@/lib/motion/replay";

// Customize Hand (issue 231): every card the character holds right now, each
// marked In Hand or In More, with the seats counted. Adding past the last
// seat is refused in words and changes nothing; the player chooses what goes.
// Placement only: a card in More is played from there exactly as before, and
// every card keeps the rules' own reason when it cannot be played.
//
// A group (issue 528) takes one seat for all its cards. Any one of them can
// still be seated on its own as a favourite from under the group's row: it
// sits in the fan and stays inside the group too.
export function HandArrange({
  units,
  cards,
  working,
  arranged,
  urgent,
  displaced,
  freshIds,
  onChange,
  onReset,
  onDone,
}: {
  // What the fan deals now (cards and groups), in the hand's own order.
  units: HandUnit[];
  // Every card in the hand now, those inside groups too.
  cards: HandCard[];
  // The layout being arranged: the saved one, or what the automatic split
  // shows now (startingLayout), so the first change moves one card.
  working: HandLayout;
  // Whether the player has a saved arrangement (else the hand is automatic).
  arranged: boolean;
  // Cards the moment has seated ahead of the chosen ones (Escape, Stand up).
  urgent: HandCard[];
  displaced: HandUnit[];
  freshIds: Set<string>;
  onChange: (layout: HandLayout) => Promise<string | null>;
  onReset: () => Promise<string | null>;
  onDone: () => void;
}) {
  const [notice, setNotice] = useState("");
  const [moved, setMoved] = useState<{ id: string; seq: number } | null>(null);
  // The groups whose cards are listed for seating one on its own.
  const [openGroups, setOpenGroups] = useState<string[]>([]);
  const noticeRef = useRef<HTMLParagraphElement>(null);
  const byId = new Map<string, HandUnit>([...cards, ...units].map((unit) => [unit.id, unit]));
  const inHand = working.fan.map((id) => byId.get(id)).filter((unit): unit is HandUnit => Boolean(unit));
  const chosen = new Set(working.fan);
  const inMore = units.filter((unit) => !chosen.has(unit.id) && unit.id !== END_TURN_ID && !urgent.includes(unit as HandCard));
  const missing = missingFromHand(working, [...units, ...cards]).length;
  const isFresh = (unit: HandUnit) => (isGroup(unit) ? unit.cards.some((card) => freshIds.has(card.id)) : freshIds.has(unit.id));
  const used = working.fan.length;

  const refuse = (text: string) => {
    setNotice(text);
    replayAnimation(noticeRef.current, "shake-x var(--dur-beat) var(--ease-snap) both");
  };
  const apply = async (layout: HandLayout, id: string) => {
    setNotice("");
    setMoved((current) => ({ id, seq: (current?.seq ?? 0) + 1 }));
    const error = await onChange(layout);
    if (error) refuse(error);
  };

  const seatButton = (card: HandUnit, className = "") => (
    <button
      type="button"
      className={cn("hand-arrange-move motion-press", className)}
      data-full={used >= HAND_SEATS ? "true" : undefined}
      onClick={() => {
        const next = addToHand(working, card);
        if ("error" in next) {
          refuse(next.error);
          return;
        }
        void apply(next.layout, card.id);
      }}
    >
      To Hand
    </button>
  );

  // A group's cards, any one of which may take a seat of its own.
  const members = (group: HandGroup) => (
    <ul id={`arrange-${group.id}`} className="hand-arrange-members">
      {group.cards.map((card) => {
        const seat = working.fan.indexOf(card.id);
        return (
          <li key={card.id} className="hand-arrange-member">
            <span className="min-w-0 flex-1 truncate text-sm text-stone-200">{card.name}</span>
            <span className="hand-cost shrink-0" data-cost={card.cost}>{costLabel(card.cost)}</span>
            {seat >= 0 ? (
              <span className="shrink-0 text-[10px] uppercase tracking-wider text-amber-200">In Hand · seat {seat + 1}</span>
            ) : (
              seatButton(card)
            )}
          </li>
        );
      })}
    </ul>
  );

  const row = (card: HandUnit, index: number, place: "hand" | "more") => {
    const group = isGroup(card) ? card : null;
    const artwork = cardArtwork(group ? (group.icons[0] ?? { kind: "action", key: "use-object" }) : (card as HandCard).icon);
    const seat = place === "hand" ? working.fan.indexOf(card.id) : -1;
    const flash = moved?.id === card.id;
    const listed = group ? openGroups.includes(group.id) : false;
    return (
      <li
        key={`${card.id}:${flash ? moved?.seq : 0}`}
        className="hand-arrange-row"
        data-place={place}
        data-moved={flash ? "true" : undefined}
        style={{ "--i": index } as CSSProperties}
      >
        <div className="flex min-h-14 w-full flex-wrap items-center gap-2 rounded-xl border border-stone-700/60 bg-stone-900/50 px-2.5 py-2">
          <GameIcon icon={artwork} size={artwork.kind === "action" ? "h-9 w-[72px]" : "size-9"} />
          <span className="min-w-[120px] flex-1">
            <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span className="truncate font-display text-sm font-semibold text-stone-100">{card.name}</span>
              <span
                className={cn(
                  "hand-arrange-badge shrink-0 rounded-full border px-1.5 py-px text-[10px] uppercase tracking-wider",
                  place === "hand"
                    ? "border-amber-400/50 bg-amber-400/10 text-amber-200"
                    : "border-stone-600/70 bg-stone-800/60 text-stone-400",
                )}
              >
                {place === "hand" ? `In Hand · seat ${seat + 1}` : "In More"}
              </span>
              {isFresh(card) ? (
                <span className="shrink-0 rounded-full border border-emerald-400/50 bg-emerald-400/10 px-1.5 py-px text-[10px] uppercase tracking-wider text-emerald-200">
                  New
                </span>
              ) : null}
            </span>
            {group ? (
              <span className="block text-[11px] text-stone-400">{groupSummary(group)}</span>
            ) : (
              <span className="hand-cost mt-0.5" data-cost={(card as HandCard).cost}>{costLabel((card as HandCard).cost)}</span>
            )}
          </span>
          {place === "hand" ? (
            <span className="ml-auto flex shrink-0 items-center gap-1">
              <button
                type="button"
                className="hand-arrange-step motion-press"
                aria-label={`Move ${card.name} one seat left`}
                disabled={seat <= 0}
                onClick={() => void apply(moveInHand(working, card.id, -1), card.id)}
              >
                <ArrowUp className="size-4" />
              </button>
              <button
                type="button"
                className="hand-arrange-step motion-press"
                aria-label={`Move ${card.name} one seat right`}
                disabled={seat >= working.fan.length - 1}
                onClick={() => void apply(moveInHand(working, card.id, 1), card.id)}
              >
                <ArrowDown className="size-4" />
              </button>
              <button
                type="button"
                className="hand-arrange-move motion-press"
                onClick={() => void apply(removeFromHand(working, card.id), card.id)}
              >
                To More
              </button>
            </span>
          ) : (
            seatButton(card, "ml-auto")
          )}
          {group ? (
            <button
              type="button"
              className="hand-arrange-open motion-press"
              aria-expanded={listed}
              aria-controls={`arrange-${group.id}`}
              onClick={() =>
                setOpenGroups((current) => (listed ? current.filter((id) => id !== group.id) : [...current, group.id]))
              }
            >
              <ChevronDown aria-hidden="true" className={cn("chevron-turn size-3.5", listed && "rotate-180")} />
              Seat one of its {group.noun[1]} on its own
            </button>
          ) : null}
          {group && listed ? members(group) : null}
        </div>
      </li>
    );
  };

  return (
    <div className="flex min-h-0 flex-col">
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="hand-arrange-seats" aria-label={`${used} of ${HAND_SEATS} seats chosen`}>
          {Array.from({ length: HAND_SEATS }, (_, index) => (
            <span key={index} className="hand-arrange-seat" data-filled={index < used ? "true" : undefined} />
          ))}
        </span>
        <span className="text-xs text-stone-300">
          {used} of {HAND_SEATS} seats chosen. End turn keeps the ninth.
        </span>
      </div>
      {urgent.length ? (
        <p className="reveal mb-2 rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-xs text-amber-100/90">
          {urgent.map((card) => card.name).join(" and ")} {urgent.length === 1 ? "takes" : "take"} a seat first while{" "}
          {urgent.length === 1 ? "it matters" : "they matter"}
          {displaced.length
            ? `; ${displaced.map((card) => card.name).join(", ")} ${displaced.length === 1 ? "waits" : "wait"} in More until then`
            : ""}
          . Your arrangement stays as you set it.
        </p>
      ) : null}
      {missing ? (
        <p className="mb-2 text-xs text-stone-400">
          {missing === 1 ? "One card you chose is" : `${missing} cards you chose are`} not in this hand now (no longer
          prepared or carried), so {missing === 1 ? "its seat is" : "their seats are"} free.
        </p>
      ) : null}
      <p
        ref={noticeRef}
        role="alert"
        className={cn("mb-2 rounded-lg border border-red-500/30 bg-red-950/30 px-3 py-2 text-xs text-red-200", notice ? "" : "hidden")}
      >
        {notice}
      </p>
      <div className="-mx-1 min-h-0 overflow-y-auto px-1 pb-1">
        <h3 className="mb-1.5 font-display text-[11px] uppercase tracking-[0.2em] text-amber-200/90">In your hand</h3>
        {inHand.length ? (
          <ul className="flex flex-col gap-1.5">{inHand.map((card, index) => row(card, index, "hand"))}</ul>
        ) : (
          <p className="text-xs text-stone-500">No cards chosen: only End turn sits in the hand. Add some below.</p>
        )}
        <h3 className="mb-1.5 mt-4 font-display text-[11px] uppercase tracking-[0.2em] text-stone-400">In More</h3>
        {inMore.length ? (
          <ul className="flex flex-col gap-1.5">{inMore.map((card, index) => row(card, index + inHand.length, "more"))}</ul>
        ) : (
          <p className="text-xs text-stone-500">Every card has a seat.</p>
        )}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-stone-700/50 pt-3">
        <button type="button" onClick={onDone} className="hand-arrange-done motion-press">
          Done
        </button>
        {arranged ? (
          <button
            type="button"
            className="hand-arrange-move motion-press"
            onClick={async () => {
              setNotice("");
              const error = await onReset();
              if (error) refuse(error);
            }}
          >
            Back to automatic
          </button>
        ) : (
          <span className="text-xs text-stone-500">Automatic until you change a card.</span>
        )}
      </div>
    </div>
  );
}
