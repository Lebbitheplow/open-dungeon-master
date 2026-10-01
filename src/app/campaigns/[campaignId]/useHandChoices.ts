"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { HandAttackOptionId, HandCard } from "@/lib/battlemap/hand";
import { HAND_AIM_EVENT, toggleOption, type HandAimDetail, type HandChoices } from "@/lib/battlemap/hand-play";
import { HAND_AIM_ASK_EVENT, HAND_AREA_EVENT, type AreaPick, type HandAreaDetail } from "@/lib/battlemap/hand-area";

// What the raised card carries beyond its target: the class options chosen
// for the swing, Ready's trigger, a card's choice, and the squares an area
// spell is laid on, picked on the board (BoardAreaAim.tsx). Split from
// Hand.tsx, which raises the card and sends it.
export function useHandChoices(picked: HandCard | null) {
  const [optionIds, setOptionIds] = useState<HandAttackOptionId[]>([]);
  const [trigger, setTrigger] = useState("");
  const [choice, setChoice] = useState<string | null>(null);
  const [areaPick, setAreaPick] = useState<AreaPick>({});
  const choices = useMemo<HandChoices>(
    () => ({ options: optionIds, trigger, ...(choice !== null ? { choice } : {}), area: areaPick }),
    [optionIds, trigger, choice, areaPick],
  );
  const resetChoices = useCallback(() => {
    setOptionIds([]);
    setTrigger("");
    setChoice(null);
    setAreaPick({});
  }, []);

  // Tell a board that wants to know, and take a pick from one that sends it.
  // An area spell's shape and its squares so far go with it, so the board
  // takes the taps and draws the area (src/lib/battlemap/hand-area.ts).
  const aimingId = picked?.id ?? null;
  const aimingAt = picked?.target ?? null;
  const aimingArea = picked?.area ?? null;
  const announce = useCallback(() => {
    const detail: HandAimDetail = { active: aimingId !== null, cardId: aimingId, target: aimingAt, area: aimingArea, pick: areaPick };
    window.dispatchEvent(new CustomEvent(HAND_AIM_EVENT, { detail }));
  }, [aimingId, aimingAt, aimingArea, areaPick]);
  useEffect(() => announce(), [announce]);
  useEffect(() => {
    // A board opened after the card was raised asks for it again.
    window.addEventListener(HAND_AIM_ASK_EVENT, announce);
    return () => window.removeEventListener(HAND_AIM_ASK_EVENT, announce);
  }, [announce]);
  useEffect(() => {
    const onArea = (event: Event) => {
      const detail = (event as CustomEvent<HandAreaDetail>).detail;
      if (detail && detail.cardId === aimingId) setAreaPick(detail.pick);
    };
    window.addEventListener(HAND_AREA_EVENT, onArea);
    return () => window.removeEventListener(HAND_AREA_EVENT, onArea);
  }, [aimingId]);

  // The aim bar's half of it, for the raised card.
  const options = picked?.options ?? EMPTY_OPTIONS;
  const barProps = {
    options,
    chosen: optionIds,
    onToggleOption: (id: HandAttackOptionId) => setOptionIds((current) => toggleOption(options, current, id)),
    trigger: picked?.asks === "trigger" ? trigger : null,
    onTrigger: setTrigger,
    choice,
    onChoice: setChoice,
    areaPick,
    onClearArea: () => setAreaPick({}),
  };
  return { choices, resetChoices, barProps };
}

const EMPTY_OPTIONS: NonNullable<HandCard["options"]> = [];

// A card sent and not yet resolved: the cards of the same cost wait for the
// engine's count to move (or for this long, if the DM never resolves it), so
// one tap cannot post the same action twice. Nothing is marked spent here;
// the engine's projection is the count.
const PENDING_MS = 45_000;
export type HandPending = { cost: HandCard["cost"]; attack: boolean; name: string; signature: string };

export function useHandPending(signature: string) {
  const [pending, setPending] = useState<HandPending | null>(null);
  // A pending card stands only until the engine's count moves.
  const waiting = pending && pending.signature === signature ? pending : null;
  useEffect(() => {
    if (!pending) return;
    const timer = window.setTimeout(() => setPending(null), PENDING_MS);
    return () => window.clearTimeout(timer);
  }, [pending]);
  return { waiting, setPending };
}

// The card just sent is the DM's to resolve; the same cost waits for it.
export function holdPendingCards(all: HandCard[], waiting: HandPending | null): HandCard[] {
  if (!waiting) return all;
  const reason = `Sent. Waiting for the DM to resolve ${waiting.name}.`;
  return all.map((card) =>
    !card.disabled && (card.cost === waiting.cost || (waiting.attack && card.intent.card === "attack" && card.cost === "action"))
      ? { ...card, disabled: reason, spent: false }
      : card,
  );
}
